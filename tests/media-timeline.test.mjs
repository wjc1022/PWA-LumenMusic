import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=path=>readFile(new URL(path,import.meta.url),'utf8');
test('write waits for commit and rejects abort after request success',async()=>{
 let transaction,request;
 const context=vm.createContext({Promise,DOMException,Error,indexedDB:{open(){const req={};queueMicrotask(()=>{req.result={transaction(){transaction={error:null,objectStore(){return {transaction,put(){request={result:'id'};return request;}}}};return transaction;}};req.onsuccess();});return req;}}});
 const trace=new vm.SyntheticModule(['traceRecord','operationId'],function(){this.setExport('traceRecord',()=>{});this.setExport('operationId',()=> 'op');},{context});
 const mod=new vm.SourceTextModule(await source('../src/database/db.js'),{context});await mod.link(()=>trace);await mod.evaluate();
 let settled=false;const first=mod.namespace.Songs.add({id:'a'}).then(()=>{settled=true;});
 await new Promise(setImmediate);request.onsuccess();await new Promise(setImmediate);assert.equal(settled,false);
 transaction.oncomplete();await first;assert.equal(settled,true);
 const second=mod.namespace.Songs.update({id:'a'});await new Promise(setImmediate);request.onsuccess();transaction.onabort();await assert.rejects(second,{name:'AbortError'});
});
test('timeline binds delayed results to original target and bounds storage; denial is harmless',async()=>{
 let saved='',denied=false,release;
 const context=vm.createContext({Blob,Date,Math,JSON,Promise,setTimeout,clearTimeout,localStorage:{getItem:()=>null,setItem:(key,value)=>{if(denied)throw Error('denied');saved=value;}}});
 const diagnostics=new vm.SourceTextModule(await source('../src/services/mediaDiagnostics.js'),{context});
 const db=new vm.SyntheticModule(['Songs'],function(){this.setExport('Songs',{});},{context});await diagnostics.link(()=>db);await diagnostics.evaluate();
 const mod=new vm.SourceTextModule(await source('../src/services/mediaTimeline.js'),{context});await mod.link(()=>diagnostics);await mod.evaluate();const d=mod.namespace;
 class Delayed extends Blob{slice(){return {arrayBuffer:()=>new Promise(resolve=>{release=()=>resolve(new ArrayBuffer(1));})};}}
 const record={id:'old',audioBlob:new Delayed(['x'])};d.traceRecord('before',record);record.id='new';await new Promise(setImmediate);release();await new Promise(setImmediate);release();await new Promise(setImmediate);
 assert.ok(d.timeline('old').length);assert.equal(d.timeline('new').length,0);
 class Broken extends Blob{slice(){throw new DOMException('missing','NotFoundError');}}
 d.traceRecord('success',{id:'a',audioBlob:new Blob(['data'])});await new Promise(setImmediate);
 d.traceRecord('failed',{id:'a',audioBlob:new Broken(['data'])});await new Promise(setImmediate);
 assert.equal(d.timeline('a').find(r=>r.operation==='success').head.readable,true);
 assert.equal(d.timeline('a').find(r=>r.operation==='failed').head.error.name,'NotFoundError');
 for(let i=0;i<100;i++){d.traceRecord('write',{id:'a',audioBlob:new Blob(['x'])});await new Promise(setImmediate);}
 assert.ok(JSON.parse(saved).length<=80);assert.ok(saved.length<=96000);assert.ok(!saved.includes('blob:'));
 for(let i=0;i<50;i++){d.traceRecord('large-'+'x'.repeat(1500),{id:'a'}, {error:Object.assign(new Error('y'.repeat(2000)),{name:'z'.repeat(2000)})});await new Promise(setImmediate);}
 assert.ok(JSON.parse(saved).length<80);assert.ok(saved.length<=96000);
 denied=true;d.traceRecord('denied',{id:'a'});await new Promise(setImmediate);
});
