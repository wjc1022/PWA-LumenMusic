import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';

async function setup() {
  const songs = [], lyrics = new Map(), warnings = [], attached = [];
  let id = 0;
  const context = createContext({ setTimeout, clearTimeout, console: { warn() {} } });
  const dependencies = {
    '../database/db.js': { Songs: { add: async song => songs.push(song) }, Lyrics: { save: async (key, value) => lyrics.set(key, value) } },
    './metadataService.js': { extractMetadata: async file => ({ title: 'ID3 title differs from filename', artist: 'Test', duration: 1 }), blobToDataUrl: async () => '' },
    './coverService.js': { generatePlaceholderCover: () => '' },
    '../utils/id.js': { generateId: () => `song-${++id}` },
  };
  const module = new SourceTextModule(await readFile(new URL('../src/services/importService.js', import.meta.url), 'utf8'), { context });
  await module.link(name => new SyntheticModule(Object.keys(dependencies[name]), function () {
    for (const [key, value] of Object.entries(dependencies[name])) this.setExport(key, value);
  }, { context }));
  await module.evaluate();
  return { songs, lyrics, warnings, attached, api: module.namespace, options: {
    onLyricsWarning: name => warnings.push(name), onLyricsImported: song => attached.push(song.id),
  } };
}
const audio = (name, relative = '') => ({ name, type: 'audio/mpeg', size: 100, webkitRelativePath: relative });
const lrc = (name, text = '[00:01.250]test', relative = '') => ({ name, type: 'text/plain', webkitRelativePath: relative, text: async () => text });

test('same-name sidecars pair regardless of order, case, Unicode normalization or ID3 title', async () => {
  const h = await setup();
  await h.api.importFiles([lrc('CAFÉ.LRC'), audio('cafe\u0301.mp3'), audio('other.mp3')], undefined, h.options);
  assert.equal(h.songs.length, 2);
  assert.equal(h.lyrics.get('song-1').en, '[00:01.250]test');
  assert.equal(h.lyrics.has('song-2'), false);
  assert.equal(h.attached.length, 1);
});

test('matching uses relative folders and preserves the chosen language slot', async () => {
  const h = await setup();
  await h.api.importFiles([audio('song.mp3', 'a/song.mp3'), audio('song.mp3', 'b/song.mp3'), lrc('song.lrc', 'folder B', 'b/song.lrc')], undefined, { ...h.options, lyricsLanguage: 'fa' });
  assert.equal(h.lyrics.has('song-1'), false);
  assert.equal(h.lyrics.get('song-2').fa, 'folder B');
  assert.equal(h.lyrics.get('song-2').en, '');
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
