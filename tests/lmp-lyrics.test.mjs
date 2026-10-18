// Run: node --experimental-vm-modules --test tests/lmp-lyrics.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';

async function harness(originalLyrics) {
  const songs = [];
  const savedLyrics = new Map();
  let downloaded;
  const song = {
    id: 'song-test', title: 'Timing test', artist: 'Singer',
    mimeType: 'audio/mpeg', audioBlob: new Blob(['audio fixture']),
    cover: 'data:image/png;base64,AQID',
  };
  const db = {
    Songs: { get: async () => undefined, add: async value => songs.push(value) },
    Lyrics: { get: async () => originalLyrics, save: async (id, value) => savedLyrics.set(id, value) },
    Playlists: { add: async () => {} }, Recents: { record: async () => {} },
    exportAllRaw: async () => ({ songs: [song], playlists: [], settings: [] }),
  };
  class TestFileReader {
    async readAsDataURL(blob) {
      this.result = `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`;
      this.onload();
    }
  }
  const context = createContext({
    Blob, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, DataView,
    fetch, FileReader: TestFileReader,
    URL: { createObjectURL: blob => { downloaded = blob; return 'blob:test'; }, revokeObjectURL() {} },
    document: { createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {} } },
  });
  const modules = new Map();
  async function load(url) {
    const key = url.href;
    if (modules.has(key)) return modules.get(key);
    let module;
    if (key.endsWith('/database/db.js')) {
      module = new SyntheticModule(Object.keys(db), function () {
        for (const [name, value] of Object.entries(db)) this.setExport(name, value);
      }, { context, identifier: key });
    } else {
      module = new SourceTextModule(await readFile(url, 'utf8'), { context, identifier: key });
    }
    modules.set(key, module);
    await module.link((specifier, parent) => load(new URL(specifier, parent.identifier)));
    return module;
  }
  const service = await load(new URL('../src/services/lmpService.js', import.meta.url));
  await service.evaluate();
  const zip = modules.get(new URL('../src/utils/zip.js', import.meta.url).href).namespace;
  return { service: service.namespace, zip, songs, savedLyrics, download: () => downloaded };
}

test('actual .lmp ZIP export/import preserves original enhanced LRC and offsets exactly', async () => {
  const original = {
    en: '\uFEFF[ar:Singer]\r\n[00:10.125][00:20.125]Oh <00:10.375>hello <00:11.001>world\r\n[00:25.999]\r\n[offset:+375]',
    fa: '[00:03.007]ترانه\n[offset:-125]',
  };
  const h = await harness(original);
  await h.service.exportPackage({ packageName: 'LRC test' });
  const archive = h.download();
  assert.ok(archive instanceof Blob);
  const entries = h.zip.readZip(await archive.arrayBuffer());
  const payload = JSON.parse(new TextDecoder().decode(entries.get('lyrics/song-test.json')));
  assert.deepEqual(payload.rawLrc, original);
  assert.equal(payload.languages.en[0].time, 9.75);
  assert.equal(payload.languages.en[1].time, 19.75);
  const result = await h.service.importPackage(archive);
  assert.equal(result.songCount, 1);
  assert.equal(result.warnings.length, 0);
  assert.equal(h.savedLyrics.get('song-test').en, original.en);
  assert.equal(h.savedLyrics.get('song-test').fa, original.fa);
  assert.equal(await h.songs[0].audioBlob.text(), 'audio fixture');
});

test('legacy language arrays import millisecond time and startTime through real ZIP path', async () => {
  const h = await harness({ en: '[00:01]seed', fa: '' });
  await h.service.exportPackage();
  const entries = h.zip.readZip(await h.download().arrayBuffer());
  entries.set('lyrics/song-test.json', new TextEncoder().encode(JSON.stringify({
    id: 'song-test', languages: {
      en: [{ time: 1.125, text: 'first' }, { startTime: 62.007, text: 'second' }, 'plain'],
      fa: [{ time: 0.001, text: 'ترانه' }],
    },
  })));
  const legacy = h.zip.createZip([...entries].map(([name, data]) => ({ name, data })));
  await h.service.importPackage(legacy);
  assert.equal(h.savedLyrics.get('song-test').en, '[0:01.125] first\n[1:02.007] second\nplain');
  assert.equal(h.savedLyrics.get('song-test').fa, '[0:00.001] ترانه');
});
