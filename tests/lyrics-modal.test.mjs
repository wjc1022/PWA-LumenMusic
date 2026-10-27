import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

// The inline lyrics renderer shares the player sheet's visibility lifecycle.
// This DOM verifies synchronization, not browser layout.
class Element {
  constructor(tag = 'div') {
    this.tagName = tag; this.children = []; this.attributes = {}; this.dataset = {};
    this.style = {}; this.listeners = new Map(); this.scrollTop = 0;
    this.clientHeight = 400; this.offsetHeight = 40; this._text = '';
    const classes = new Set();
    this.classList = {
      add: (...items) => items.forEach(item => classes.add(item)),
      remove: (...items) => items.forEach(item => classes.delete(item)),
      contains: item => classes.has(item),
      toggle: (item, force = !classes.has(item)) => { force ? classes.add(item) : classes.delete(item); return force; },
    };
  }
  set className(value) { String(value).split(/\s+/).filter(Boolean).forEach(item => this.classList.add(item)); }
  set textContent(value) { this.children = []; this._text = String(value); }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  get firstChild() { return this.children[0]; }
  append(...items) { this.children.push(...items); }
  appendChild(item) { this.append(item); return item; }
  removeChild(item) { this.children.splice(this.children.indexOf(item), 1); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  removeAttribute(key) { delete this.attributes[key]; }
  addEventListener(name, handler) { const handlers = this.listeners.get(name) || []; handlers.push(handler); this.listeners.set(name, handlers); }
  dispatch(name, event = {}) { for (const handler of this.listeners.get(name) || []) handler(event); }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [ ...(child.classList?.contains(selector.slice(1)) ? [child] : []), ...(child.querySelectorAll?.(selector) || []) ]);
  }
  getBoundingClientRect() { return { top: 0 }; }
  scrollTo(options) { this.scrollTop = options.top; }
  focus() {}
}

const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

async function setup(getRecord) {
  const ids = ['playerSheetModal', 'lyricsBody'];
  const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
  const document = new Element();
  const audio = new Element('audio'); Object.assign(audio, { currentTime: 0, paused: false, ended: false, seeking: false });
  const events = new Map(); const frames = new Map(); let nextFrame = 0;
  const context = vm.createContext({ console, document, window: { matchMedia: () => ({ matches: false }), alert() {} },
    requestAnimationFrame: callback => { frames.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame: id => frames.delete(id),
  });
  const moduleFor = values => new vm.SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context });
  const dom = moduleFor({
    $: selector => elements[selector.slice(1)],
    el: (tag, attrs = {}, children = []) => {
      const node = new Element(tag);
      for (const [key, value] of Object.entries(attrs)) key === 'class' ? node.className = value : node.setAttribute(key, value);
      for (const child of Array.isArray(children) ? children : [children]) {
        if (child instanceof Element) node.append(child); else { const text = new Element(); text.textContent = child; node.append(text); }
      }
      return node;
    },
    clearNode: node => { node.children = []; node._text = ''; },
  });
  const modules = {
    '../utils/dom.js': dom,
    '../database/db.js': moduleFor({ Lyrics: { get: getRecord, save: async () => {} } }),
    '../services/i18nService.js': moduleFor({ t: key => key }),
    '../services/audioEngine.js': moduleFor({ audioEl: audio, on: (name, callback) => events.set(name, callback), togglePlay() {}, playNext() {}, playPrev() {} }),
    '../lyrics/lrc.mjs': new vm.SourceTextModule(await readFile(new URL('../src/lyrics/lrc.mjs', import.meta.url), 'utf8'), { context }),
  };
  const modalModule = new vm.SourceTextModule(await readFile(new URL('../src/components/playerLyrics.js', import.meta.url), 'utf8'), { context });
  await modalModule.link(specifier => { assert.ok(modules[specifier], `Unexpected import ${specifier}`); return modules[specifier]; });
  await modalModule.evaluate();
  const modal = modalModule.namespace.initPlayerLyrics();
  return { modal, audio, elements, frames, emit: (name, value) => events.get(name)?.(value), lines: () => elements.lyricsBody.querySelectorAll('.lyric-line') };
}

test('opening uses current audio position and backwards seeking resets line and word highlights', async () => {
  const state = await setup(async () => ({ text: '[00:01]<00:01>one <00:02>two\n[00:04]<00:04>three <00:05>four' }));
  state.audio.currentTime = 5.5;
  state.modal.open({ id: 'a', title: 'A' }); await flush();
  const lines = state.lines();
  assert.equal(lines[1].classList.contains('current'), true);
  assert.equal(lines[1].querySelectorAll('.lyric-word')[1].classList.contains('active'), true);
  state.audio.currentTime = 1.5; state.audio.seeking = true; state.audio.dispatch('seeking');
  assert.equal(lines[0].classList.contains('current'), true);
  assert.equal(lines[1].classList.contains('current'), false);
  assert.ok(lines[1].querySelectorAll('.lyric-word').every(word => !word.classList.contains('sung') && !word.classList.contains('active')));
  const words = lines[0].querySelectorAll('.lyric-word');
  assert.equal(words[0].classList.contains('active'), true);
  assert.equal(words[1].classList.contains('sung'), false);
  state.audio.currentTime = 0; state.audio.dispatch('seeked');
  assert.ok(lines.every(line => !line.classList.contains('current')));
});

test('trackchange replaces the visible song and synchronizes its lyrics', async () => {
  const state = await setup(async id => ({ text: `[00:00]${id}` }));
  state.modal.open({ id: 'a', title: 'A' }); await flush();
  state.emit('trackchange', { id: 'b', title: 'B', artist: 'Artist' }); await flush();


  assert.equal(state.lines()[0].textContent, 'b');
  assert.equal(state.lines()[0].classList.contains('current'), true);
});

test('stale database results cannot overwrite a newer song or reload', async () => {
  const requests = [];
  const state = await setup(id => { const request = deferred(); requests.push({ id, ...request }); return request.promise; });
  state.modal.open({ id: 'a', title: 'A' });
  state.emit('trackchange', { id: 'b', title: 'B' });
  state.modal.open({ id: 'b', title: 'B' });
  assert.deepEqual(requests.map(request => request.id), ['a', 'b', 'b']);
  requests[2].resolve({ text: '[00:00]Bilingual B' }); await flush();
  assert.equal(state.lines()[0].textContent, 'Bilingual B');
  requests[1].resolve({ text: '[00:00]stale reload' });
  requests[0].resolve({ text: '[00:00]stale song' }); await flush();
  assert.equal(state.lines()[0].textContent, 'Bilingual B');
});

test('close cancels animation and invalidates pending lyrics loading', async () => {
  const pending = deferred(); let calls = 0;
  const state = await setup(() => ++calls === 1 ? Promise.resolve({ text: '[00:00]ready' }) : pending.promise);
  state.modal.open({ id: 'a', title: 'A' }); await flush();
  assert.equal(state.frames.size, 1);
  state.modal.close();
  assert.equal(state.frames.size, 0);
  assert.equal(state.elements.playerSheetModal.classList.contains('open'), false);
  state.modal.open({ id: 'b', title: 'B' });
  state.modal.close(); pending.resolve({ text: '[00:00]late' }); await flush();
  assert.equal(state.lines().length, 0);
  assert.equal(state.frames.size, 0);
});

test('preview skips timed blanks and untimed text; seeking resets past and next states', async () => {
  const state = await setup(async () => ({ text: '[00:01]first\n[00:03]   \n[00:04]\n[00:06]<00:06>next\n[00:09]last\nplain text' }));
  state.modal.open({ id: 'a' }); await flush();
  const lines = state.lines();
  assert.equal(lines[0].classList.contains('next'), true);
  state.audio.currentTime = 2; state.audio.dispatch('seeked');
  assert.equal(lines[0].classList.contains('current'), true);
  assert.equal(lines[3].classList.contains('next'), true);
  state.audio.currentTime = 4.5; state.audio.dispatch('seeked');
  assert.equal(lines[2].classList.contains('current'), true);
  assert.equal(lines[0].classList.contains('past'), true);
  assert.equal(lines[3].classList.contains('next'), true);
  assert.ok(lines.slice(1, 3).every(line => !line.classList.contains('next')));
  state.audio.currentTime = 10; state.audio.dispatch('seeked');
  assert.ok(lines.every(line => !line.classList.contains('next')));
  assert.ok(['current', 'next', 'past'].every(name => !lines[5].classList.contains(name)));
  state.audio.currentTime = 0; state.audio.dispatch('seeked');
  assert.equal(lines[0].classList.contains('next'), true);
  assert.ok(lines.every(line => !line.classList.contains('past')));
});

test('plain text stays uniform and reloading or switching clears old visual states', async () => {
  let raw = '[00:01]first\n[00:02]second';
  const state = await setup(async () => ({ text: raw }));
  state.audio.currentTime = 1.5;state.modal.open({ id: 'a' });await flush();
  const previous = state.lines();
  assert.equal(previous[1].classList.contains('next'), true);
  raw = '中文歌词\nplain text';
  state.emit('trackchange', { id: 'b' });await flush();
  assert.ok(state.lines().every(line => line.classList.contains('untimed') && ['current','past','next'].every(name => !line.classList.contains(name))));
  state.audio.currentTime = 50;state.audio.dispatch('seeked');
  assert.ok(state.lines().every(line => ['current','past','next'].every(name => !line.classList.contains(name))));
  raw = '[00:01]reloaded\n[00:05]preview';
  state.audio.currentTime = 2;state.modal.open({ id: 'b' });await flush();
  assert.equal(state.lines()[0].classList.contains('current'), true);
  assert.equal(state.lines()[1].classList.contains('next'), true);
  assert.ok(state.lines().every(line => !previous.includes(line)));
});

test('same-line seek recenters from layout even if animated rectangles are displaced',async()=>{
 const h=await setup(async()=>({text:'[00:00]first\n[00:04]second'}));
 h.modal.open({id:'a'});await flush();const body=h.elements.lyricsBody,node=h.lines()[1];
 node.offsetTop=700;node.offsetHeight=120;node.getBoundingClientRect=()=>({top:-999});
 h.audio.currentTime=5;h.audio.dispatch('seeked');assert.equal(body.scrollTop,560);
 body.scrollTop=123;h.audio.currentTime=6;h.audio.dispatch('seeked');assert.equal(body.scrollTop,560);
});
