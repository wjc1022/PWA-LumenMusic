import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SourceTextModule, createContext } from 'node:vm';
const module = new SourceTextModule(await readFile(new URL('../src/services/lyricFile.js', import.meta.url),'utf8'), {context:createContext({TextDecoder,Uint8Array})});
await module.link(()=>{});await module.evaluate();
const read = module.namespace.readLyricFile;
test('unrestricted picker content supports Chinese, Persian, plain text and UTF-16 BOM',async()=>{
  for(const text of ['中文歌词','متن آهنگ','[00:00.010]<00:00.010>Hello']) assert.equal(await read(new Blob([text])),text);
  const buffer=Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from('中文\n歌词','utf16le')]);
  assert.equal(await read(new Blob([buffer])),'中文\n歌词');
});
test('empty, binary, invalid encoding, oversized and unreadable inputs are rejected',async()=>{
  for(const file of [new Blob(['']),new Blob(['%PDF-1.4']),new Blob([new Uint8Array([0,1,2])]),new Blob([new Uint8Array([0xff,0xff,0xff])]),{size:6*1024*1024},{size:1,arrayBuffer:async()=>{throw Error('read failure');}}]) await assert.rejects(read(file));
});
