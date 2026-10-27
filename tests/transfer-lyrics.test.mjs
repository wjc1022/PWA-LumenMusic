import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';

async function setup(lyrics, songs = []) {
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
  assert.equal(payload.formatVersion,2);assert.deepEqual(payload.lyrics,[{songId:'a',text},{songId:'b',text:''}]);
  await h.api.importLibrary(h.download());
  assert.deepEqual(JSON.parse(JSON.stringify(h.imported().lyrics)),payload.lyrics);
});
test('JSON paths omit unsupported records without migrating language fields',async()=>{
  const h=await setup([{songId:'old',en:'old',fa:'old'},{songId:'a',text:'new',en:'ignored'}]);
  await h.api.exportLibrary();
  assert.deepEqual(JSON.parse(await h.download().text()).lyrics,[{songId:'a',text:'new'}]);
  await h.api.importLibrary(new Blob([JSON.stringify({lyrics:[{songId:'old',en:'legacy'},{songId:'a',text:'replacement',fa:'ignored'}]})]));
  assert.deepEqual(JSON.parse(JSON.stringify(h.imported().lyrics)),[{songId:'a',text:'replacement'}]);
});

test('JSON retains video type and serializes both media and instrumental bytes',async()=>{
 const h=await setup([],[{id:'v',mediaType:'video',audioBlob:new Blob(['video'],{type:'video/mp4'})},{id:'a',audioBlob:new Blob(['audio']),instrumentalBlob:new Blob(['instrumental'])}]);
 await h.api.exportLibrary();await h.api.importLibrary(h.download());const songs=h.imported().songs;assert.equal(songs[0].mediaType,'video');assert.equal(await songs[0].audioBlob.text(),'video');assert.equal(await songs[1].instrumentalBlob.text(),'instrumental');
});
