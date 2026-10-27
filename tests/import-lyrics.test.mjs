import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';

async function setup({ videoError = false, storageError = false, metadataOnly = false } = {}) {
  const songs = [], lyrics = new Map(), warnings = [], attached = [];
  let id = 0;
  const released=[];
  const context = createContext({ setTimeout, clearTimeout, console: { warn() {} },
    URL:{createObjectURL:()=> 'blob:probe',revokeObjectURL:url=>released.push(url)},
    document:{createElement:()=>({duration:7,removeAttribute(){},load(){},set src(value){queueMicrotask(()=>videoError?this.onerror():metadataOnly?this.onloadedmetadata():this.onloadeddata());}})},
  });
  const dependencies = {
    '../database/db.js': { Songs: { add: async song => { if(storageError) throw Error("Quota exceeded"); songs.push(song); } }, Lyrics: { save: async (key, value) => lyrics.set(key, value) } },
    './metadataService.js': { extractMetadata: async file => ({ title: 'ID3 title differs from filename', artist: 'Test', duration: 1 }), blobToDataUrl: async () => '' },
    './coverService.js': { generatePlaceholderCover: () => '' },
    '../utils/id.js': { generateId: () => `song-${++id}` },
  };
  const module = new SourceTextModule(await readFile(new URL('../src/services/importService.js', import.meta.url), 'utf8'), { context });
  await module.link(name => new SyntheticModule(Object.keys(dependencies[name]), function () {
    for (const [key, value] of Object.entries(dependencies[name])) this.setExport(key, value);
  }, { context }));
  await module.evaluate();
  return { songs, lyrics, warnings, attached, released, api: module.namespace, options: {
    onLyricsWarning: name => warnings.push(name), onLyricsImported: song => attached.push(song.id),
  } };
}
const audio = (name, relative = '') => ({ name, type: 'audio/mpeg', size: 100, webkitRelativePath: relative });
const lrc = (name, text = '[00:01.250]test', relative = '') => ({ name, type: 'text/plain', webkitRelativePath: relative, text: async () => text });

test('same-name sidecars pair regardless of order, case, Unicode normalization or ID3 title', async () => {
  const h = await setup();
  await h.api.importFiles([lrc('CAFÉ.LRC'), audio('cafe\u0301.mp3'), audio('other.mp3')], undefined, h.options);
  assert.equal(h.songs.length, 2);
  assert.equal(h.lyrics.get('song-1'), '[00:01.250]test');
  assert.equal(h.lyrics.has('song-2'), false);
  assert.equal(h.attached.length, 1);
});

test('matching uses relative folders and stores one raw lyrics text', async () => {
  const h = await setup();
  await h.api.importFiles([audio('song.mp3', 'a/song.mp3'), audio('song.mp3', 'b/song.mp3'), lrc('song.lrc', 'folder B', 'b/song.lrc')], undefined, h.options);
  assert.equal(h.lyrics.has('song-1'), false);
  assert.equal(h.lyrics.get('song-2'), 'folder B');
});

test('ambiguous and unreadable sidecars do not discard playable audio', async () => {
  const h = await setup();
  const broken = lrc('broken.lrc'); broken.text = async () => { throw Error('read failed'); };
  await h.api.importFiles([audio('dup.mp3'), lrc('dup.lrc'), lrc('DUP.LRC'), audio('broken.mp3'), broken], undefined, h.options);
  assert.equal(h.songs.length, 2);
  assert.equal(h.lyrics.size, 0);
  assert.equal(h.warnings.length, 2);
});

test('unmatched LRC files are not imported as songs and existing audio-only calls work', async () => {
  const h = await setup();
  assert.equal(h.api.isAudioFile({ name: 'lyrics.lrc', type: 'audio/mpeg' }), false);
  assert.equal((await h.api.importFiles([lrc('orphan.lrc')])).length, 0);
  assert.equal((await h.api.importFiles([audio('solo.mp3')])).length, 1);
  assert.equal(h.lyrics.size, 0);
});

test('video classification remains separate from instrumental audio and cancellation writes nothing',async()=>{
 const h=await setup();for(const file of [{name:'movie.mp4',type:''},{name:'movie.bin',type:'video/webm'},{name:'movie.mov',type:'audio/mp4'}]){assert.equal(h.api.isMediaFile(file),true);assert.equal(h.api.isAudioFile(file),false);await assert.rejects(h.api.attachInstrumental({id:'a'},file));}
 assert.equal((await h.api.importFiles([])).length,0);assert.equal(h.songs.length,0);
});

test('video probe cleans URL and import persists a distinct record with sidecar',async()=>{
 const h=await setup();const video={name:'local.webm',type:'video/webm',size:20};
 const result=await h.api.importFiles([video,lrc('local.lrc','[00:00]video')]);
 assert.equal(result[0].mediaType,'video');assert.equal(result[0].audioBlob,video);assert.equal(result[0].duration,7);assert.equal(h.lyrics.get(result[0].id),'[00:00]video');assert.deepEqual(h.released,['blob:probe']);
});
test('decode and storage failures never persist video records or sidecars and release probe URLs',async()=>{
 for(const options of [{videoError:true},{storageError:true}]){const h=await setup(options);const result=await h.api.importFiles([{name:'bad.mp4',type:'video/mp4',size:10},lrc('bad.lrc')]);assert.equal(result.length,0);assert.equal(h.songs.length,0);assert.equal(h.lyrics.size,0);assert.deepEqual(h.released,['blob:probe']);}
});

test('metadata-only preload imports without waiting for a decoded frame',async()=>{
 const h=await setup({metadataOnly:true});const result=await h.api.importFiles([{name:'safari.mp4',type:'video/mp4',size:12}]);assert.equal(result.length,1);assert.equal(result[0].duration,7);assert.deepEqual(h.released,['blob:probe']);
});
test('import failures identify reading versus saving',async()=>{
 for(const [options,expected] of [[{videoError:true},'videoReadFailed'],[{storageError:true},'storageFailed']]){const h=await setup(options),failures=[];await h.api.importFiles([{name:'failed.mp4',type:'video/mp4',size:12}],null,{onError:e=>failures.push(e)});assert.equal(failures[0].code,expected);assert.equal(failures[0].fileName,'failed.mp4');assert.equal(h.songs.length,0);}
});
