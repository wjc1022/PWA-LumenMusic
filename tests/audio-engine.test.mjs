import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

async function setup(settings = { playbackRate: 1.75, repeatMode: 'all' }) {
  const timers = new Map(), urls = new Map(), records = new Map();
  let nextTimer = 0, nextUrl = 0;
  class CustomEvent extends Event { constructor(type, init) { super(type); this.detail = init.detail; } }
  class Audio extends EventTarget {
    paused = true; currentTime = 0; duration = 60; playbackRate = 1;
    plans = []; waits = new Map(); loads = 0;
    addEventListener(type, callback, options) {
      super.addEventListener(type, callback, options);
      if (!this.waits.has(type)) this.waits.set(type, new Set());
      this.waits.get(type).add(callback);
    }
    removeEventListener(type, callback) { super.removeEventListener(type, callback); this.waits.get(type)?.delete(callback); }
    load() {
      this.loads++;this.currentTime = 0;this.pause();
      const plan = this.plans.shift();
      if (plan === 'throw') throw Error('load failed synchronously');
      if (plan) queueMicrotask(() => this.dispatchEvent(new Event(plan)));
    }
    async play() { this.paused = false; this.dispatchEvent(new Event('play')); }
    pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
    removeAttribute(name) { if (name === 'src') this.src = ''; }
  }
  const context = vm.createContext({ Audio, EventTarget, CustomEvent, console,
    URL: { createObjectURL(blob) { const url = 'blob:'+(++nextUrl);urls.set(url,blob);return url; }, revokeObjectURL() {} },
    setTimeout(callback) { timers.set(++nextTimer,callback);return nextTimer; },
    clearTimeout(id) { timers.delete(id); },
  });
  const db = new vm.SyntheticModule(['Songs','Settings','Recents'], function() {
    this.setExport('Songs',{
      incrementPlayCount: async id => ({...records.get(id)}),
      setFavorite: async(id,favorite) => ({...records.get(id),favorite}),
    });
    this.setExport('Settings',{get:async(key,fallback)=>settings[key]??fallback,set:async(key,value)=>{settings[key]=value;}});
    this.setExport('Recents',{record:async()=>{}});
  }, {context});
  const module = new vm.SourceTextModule(await readFile(new URL('../src/services/audioEngine.js',import.meta.url),'utf8'),{context});
  await module.link(()=>db);await module.evaluate();
  const api=module.namespace, audio=api.audioEl, errors=[], states=[];
  api.on('playbackerror',key=>errors.push(key));api.on('playstate',value=>states.push(value));
  const a={id:'a',audioBlob:{name:'original'},instrumentalBlob:{name:'instrumental'}}, b={id:'b',audioBlob:{name:'B'}};
  records.set(a.id,a);records.set(b.id,b);
  await api.selectSong(a,[a,b]);
  const clean=()=>{assert.equal(timers.size,0);assert.equal(audio.waits.get('loadedmetadata')?.size||0,1);assert.equal(audio.waits.get('error')?.size||0,0);assert.equal(audio.waits.get('pause')?.size,1);assert.equal(api.getVariantStatus().pending,false);};
  const expire=()=>{assert.equal(timers.size,1);[...timers.values()][0]();};
  return {api,audio,a,b,errors,states,timers,settings,clean,expire,source:()=>urls.get(audio.src)};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('old and imported speed preferences cannot alter playback; repeat and data remain',async()=>{
  const h=await setup();
  await h.api.restorePlaybackPreferences();
  assert.equal(h.audio.playbackRate,1);assert.equal(h.api.getRepeatMode(),'all');assert.equal(h.settings.playbackRate,1.75);
  h.settings.playbackRate=0.5;h.settings.repeatMode='one';
  await h.api.restorePlaybackPreferences();assert.equal(h.api.getRepeatMode(),'one');
  h.audio.playbackRate=2;h.audio.dispatchEvent(new Event('ratechange'));assert.equal(h.audio.playbackRate,1);
  h.settings.repeatMode='off';await h.api.restorePlaybackPreferences();
  h.audio.dispatchEvent(new Event('ended'));await flush();
  assert.equal(h.api.getCurrentSong().id,'b');assert.equal(h.audio.playbackRate,1);
  h.api.playPrev();await flush();h.audio.plans.push('loadedmetadata');
  await h.api.switchVariant('instrumental');assert.equal(h.audio.playbackRate,1);h.clean();
});
test('load error restores source, committed version, playing position, and permits retry',async()=>{
  const h=await setup();h.audio.currentTime=12;h.audio.plans.push('error','loadedmetadata');
  const pending=h.api.switchVariant('instrumental');assert.equal(h.api.getCurrentVariant(),'vocals');
  const result=await pending;
  assert.equal(result.restored,true);assert.equal(h.api.getCurrentVariant(),'vocals');assert.equal(h.source(),h.a.audioBlob);
  assert.equal(h.audio.currentTime,12);assert.equal(h.audio.paused,false);assert.deepEqual(h.errors,['player.variantFailed']);h.clean();
  h.audio.plans.push('loadedmetadata');assert.equal((await h.api.switchVariant('instrumental')).ok,true);
  assert.equal(h.api.getCurrentVariant(),'instrumental');assert.equal(h.source(),h.a.instrumentalBlob);h.clean();
});
test('timeout rolls back paused position and cleans up the failed wait',async()=>{
  const h=await setup();h.audio.pause();h.audio.currentTime=9;
  const pending=h.api.switchVariant('instrumental');h.audio.plans.push('loadedmetadata');h.expire();
  const result=await pending;assert.equal(result.reason,'timeout');assert.equal(result.restored,true);
  assert.equal(h.audio.currentTime,9);assert.equal(h.audio.paused,true);h.clean();
});
test('user pause during a successful switch is respected',async()=>{
  const h=await setup();h.audio.currentTime=7;
  const pending=h.api.switchVariant('instrumental');h.api.togglePlay();
  h.audio.dispatchEvent(new Event('loadedmetadata'));await pending;
  assert.equal(h.audio.paused,true);assert.equal(h.audio.currentTime,7);h.clean();
});
test('user resume during a failed switch survives rollback',async()=>{
  const h=await setup();h.audio.pause();h.audio.currentTime=8;
  const pending=h.api.switchVariant('instrumental');h.api.togglePlay();
  h.audio.plans.push('loadedmetadata');h.audio.dispatchEvent(new Event('error'));
  assert.equal((await pending).restored,true);assert.equal(h.audio.paused,false);assert.equal(h.audio.currentTime,8);h.clean();
});
test('user pause during rollback is respected',async()=>{
  const h=await setup();h.audio.currentTime=11;
  const pending=h.api.switchVariant('instrumental');h.audio.dispatchEvent(new Event('error'));await flush();
  h.api.togglePlay();h.audio.dispatchEvent(new Event('loadedmetadata'));await pending;
  assert.equal(h.audio.paused,true);assert.equal(h.audio.currentTime,11);h.clean();
});
test('switch failure followed by a new selection never rolls back over the new song',async()=>{
  const h=await setup();const pending=h.api.switchVariant('instrumental');
  h.audio.dispatchEvent(new Event('error'));
  await h.api.selectSong(h.b,[h.a,h.b]);assert.equal((await pending).reason,'superseded');
  assert.equal(h.api.getCurrentSong().id,'b');assert.equal(h.source(),h.b.audioBlob);assert.equal(h.audio.currentTime,0);
  assert.deepEqual(h.errors,[]);h.clean();
});
test('new selection cancels an already running rollback',async()=>{
  const h=await setup();const pending=h.api.switchVariant('instrumental');
  h.audio.dispatchEvent(new Event('error'));await flush();
  await h.api.selectSong(h.b,[h.a,h.b]);assert.equal((await pending).reason,'superseded');
  assert.equal(h.source(),h.b.audioBlob);assert.deepEqual(h.errors,[]);h.clean();
});
test('rapid reverse switch cancels the first request while preserving intent and time',async()=>{
  const h=await setup();h.audio.currentTime=13;
  const first=h.api.switchVariant('instrumental');h.audio.plans.push('loadedmetadata');
  const second=h.api.switchVariant('vocals');
  assert.equal((await first).reason,'superseded');assert.equal((await second).ok,true);
  assert.equal(h.api.getCurrentVariant(),'vocals');assert.equal(h.audio.currentTime,13);assert.equal(h.audio.paused,false);h.clean();
});
test('failed target and failed original stop after exactly one rollback',async()=>{
  const h=await setup();h.audio.plans.push('error','error');
  const result=await h.api.switchVariant('instrumental');
  assert.equal(result.reason,'restore-failed');assert.equal(h.audio.paused,true);assert.equal(h.audio.src,'');
  assert.equal(h.audio.loads,3);assert.deepEqual(h.errors,['player.variantRestoreFailed']);h.clean();
  h.audio.plans.push('loadedmetadata');assert.equal((await h.api.switchVariant('vocals')).ok,true);h.clean();
});
test('rollback timeout also stops without retrying',async()=>{
  const h=await setup();h.audio.plans.push('error');const pending=h.api.switchVariant('instrumental');await flush();
  h.expire();assert.equal((await pending).reason,'restore-failed');assert.equal(h.audio.paused,true);h.clean();
});
test('resource reload rollback keeps the actual old instrumental Blob',async()=>{
  const h=await setup();h.audio.plans.push('loadedmetadata');await h.api.switchVariant('instrumental');
  h.audio.currentTime=6;h.audio.plans.push('error','loadedmetadata');
  h.api.refreshCurrentSong({...h.a,instrumentalBlob:{name:'replacement'}});await flush();
  assert.equal(h.source(),h.a.instrumentalBlob);assert.equal(h.api.getCurrentVariant(),'instrumental');assert.equal(h.audio.currentTime,6);h.clean();
  h.audio.plans.push('loadedmetadata');assert.equal((await h.api.switchVariant('instrumental')).ok,true);
  assert.equal(h.source().name,'replacement');h.clean();
});

test('stalled playback after metadata is bounded and rolls back',async()=>{
  const h=await setup();h.audio.currentTime=4;
  const normalPlay=h.audio.play.bind(h.audio);let attempts=0;
  h.audio.play=()=>++attempts===1?new Promise(()=>{}):normalPlay();
  h.audio.plans.push('loadedmetadata');const pending=h.api.switchVariant('instrumental');await flush();
  h.audio.plans.push('loadedmetadata');h.expire();
  assert.equal((await pending).restored,true);assert.equal(h.source(),h.a.audioBlob);assert.equal(h.audio.currentTime,4);h.clean();
});
test('user pause interrupts a pending play promise without a false rollback',async()=>{
  const h=await setup();h.audio.play=()=>new Promise(()=>{});
  h.audio.plans.push('loadedmetadata');const pending=h.api.switchVariant('instrumental');await flush();
  h.api.togglePlay();assert.equal((await pending).ok,true);
  assert.equal(h.audio.paused,true);assert.equal(h.api.getCurrentVariant(),'instrumental');assert.deepEqual(h.errors,[]);h.clean();
});
test('synchronous loader exceptions still stop and report a failed rollback',async()=>{
  const h=await setup();h.audio.plans.push('throw','throw','throw');
  assert.equal((await h.api.switchVariant('instrumental')).reason,'restore-failed');
  assert.equal(h.audio.paused,true);assert.deepEqual(h.errors,['player.variantRestoreFailed']);h.clean();
});

test('latest seek survives loading and rollback', async () => {
  const h=await setup();h.audio.currentTime=8;
  const pending=h.api.switchVariant('instrumental');h.api.seekTo(.5);
  h.audio.dispatchEvent(new Event('error'));await flush();h.api.seekTo(.75);
  h.audio.dispatchEvent(new Event('loadedmetadata'));await pending;
  assert.equal(h.audio.currentTime,45);h.clean();
});

test('seek before metadata keeps latest ratio and new selection clears it',async()=>{
 const h=await setup();h.audio.duration=NaN;h.api.seekTo(.2);h.api.seekTo(.7);
 h.audio.duration=60;h.audio.dispatchEvent(new Event('loadedmetadata'));assert.equal(h.audio.currentTime,42);
 h.audio.duration=NaN;h.api.seekTo(.9);await h.api.selectSong(h.b);h.audio.duration=60;
 h.audio.dispatchEvent(new Event('loadedmetadata'));assert.equal(h.audio.currentTime,42);
});
test('unknown target duration and superseding switch preserve latest seek',async()=>{
 const h=await setup();h.audio.currentTime=8;const first=h.api.switchVariant('instrumental');
 h.audio.duration=NaN;h.api.seekTo(.5);const second=h.api.switchVariant('vocals');
 h.audio.duration=60;h.audio.dispatchEvent(new Event('loadedmetadata'));
 assert.equal((await first).reason,'superseded');assert.equal((await second).ok,true);
 assert.equal(h.audio.currentTime,30);h.clean();
});
