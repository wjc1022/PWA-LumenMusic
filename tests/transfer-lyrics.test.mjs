import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';

async function setup(lyrics, songs = []) {
  if(!songs.length) songs=lyrics.filter(l=>typeof l.text==='string').map(l=>({id:l.songId,audioBlob:new Blob(['audio'])}));
  let downloaded, imported;
  const context=createContext({Blob,fetch,Date,JSON, FileReader: class { async readAsDataURL(blob) {this.result=`data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString("base64")}`;this.onload();} },
    URL:{createObjectURL(blob){downloaded=blob;return 'blob:test';},revokeObjectURL(){}},
    document:{createElement:()=>({click(){},remove(){}}),body:{appendChild(){}}},
  });
  const db=new SyntheticModule(['exportAllRaw','importAllRaw'],function(){
    this.setExport('exportAllRaw',async()=>({songs,playlists:[],recents:[],settings:[],lyrics}));
    this.setExport('importAllRaw',async raw=>{imported=raw;});
  },{context});
  const module=new SourceTextModule(await readFile(new URL('../src/services/transferService.js',import.meta.url),'utf8'),{context});
  await module.link(()=>db);await module.evaluate();
  return {api:module.namespace,download:()=>downloaded,imported:()=>imported};
}
test('JSON backup round-trips raw mixed-language text using only songId and text',async()=>{
  const text='\uFEFF[00:01.001]<00:01.002>中文 / English\r\nمتن\n[offset:+125]';
  const h=await setup([{songId:'a',text},{songId:'b',text:''}]);await h.api.exportLibrary();
  const payload=JSON.parse(await h.download().text());
  assert.equal(payload.formatVersion,3);assert.deepEqual(payload.lyrics,[{songId:'a',text},{songId:'b',text:''}]);
  await h.api.importLibrary(h.download());
  assert.deepEqual(JSON.parse(JSON.stringify(h.imported().lyrics)),payload.lyrics);
});
test('old and invalid JSON formats are rejected before writes',async()=>{
 const h=await setup([]);
 await assert.rejects(h.api.importLibrary(new Blob([JSON.stringify({formatVersion:2,songs:[]})])),/Unsupported/);
 await assert.rejects(h.api.importLibrary(new Blob([JSON.stringify({formatVersion:3,songs:[],playlists:[],recents:[],settings:[],lyrics:[{songId:'missing',text:'x'}]})])),/relationships/);
 assert.equal(h.imported(),undefined);
});
test('JSON retains video type and serializes both media and instrumental bytes',async()=>{
 const h=await setup([],[{id:'v',mediaType:'video',audioBlob:new Blob(['video'],{type:'video/mp4'})},{id:'a',audioBlob:new Blob(['audio']),instrumentalBlob:new Blob(['instrumental'])}]);
 await h.api.exportLibrary();await h.api.importLibrary(h.download());const songs=h.imported().songs;assert.equal(songs[0].mediaType,'video');assert.equal(await songs[0].audioBlob.text(),'video');assert.equal(await songs[1].instrumentalBlob.text(),'instrumental');
});
