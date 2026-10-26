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

test('actual .lmp ZIP preserves one raw multilingual lyrics text exactly', async () => {
  const original = '\uFEFF[ar:Singer]\r\n[00:10.125][00:20.125]Oh <00:10.375>hello <00:11.001>world / \u4e2d\u6587\r\n[00:25.999]\r\n[offset:+375]\n\u0645\u062a\u0646';
  const h = await harness({text:original});
  await h.service.exportPackage({packageName:'LRC test'});
  const archive=h.download();
  const entries=h.zip.readZip(await archive.arrayBuffer());
  const payload=JSON.parse(new TextDecoder().decode(entries.get('lyrics/song-test.json')));
  assert.deepEqual(payload,{id:'song-test',text:original});
  assert.equal(JSON.parse(new TextDecoder().decode(entries.get('manifest.json'))).packageFormatVersion,2);
  const result=await h.service.importPackage(archive);
  assert.equal(result.songCount,1);assert.equal(result.warnings.length,0);
  assert.equal(h.savedLyrics.get('song-test'),original);
  assert.equal(await h.songs[0].audioBlob.text(),'audio fixture');
});

test('plain and empty text round-trip without language conversion',async()=>{
  for(const text of ['\u4e2d\u6587 / English\n\u0645\u062a\u0646','']) {
    const h=await harness({text});await h.service.exportPackage();
    await h.service.importPackage(h.download());assert.equal(h.savedLyrics.get('song-test'),text);
  }
});

test('unsupported lyrics shapes are skipped without migrating or discarding audio',async()=>{
  for(const payload of [{id:'song-test',languages:{en:['legacy'],fa:['old']}},{id:'song-test',text:42}]) {
    const h=await harness({text:'seed'});await h.service.exportPackage();
    const entries=h.zip.readZip(await h.download().arrayBuffer());
    entries.set('lyrics/song-test.json',new TextEncoder().encode(JSON.stringify(payload)));
    const archive=h.zip.createZip([...entries].map(([name,data])=>({name,data})));
    const result=await h.service.importPackage(archive);
    assert.equal(result.songCount,1);assert.equal(result.warnings.length,1);assert.equal(h.savedLyrics.size,0);
  }
});
