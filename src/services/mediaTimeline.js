// Bounded evidence only. Probes never gate a database operation or playback.
import { inspectBlob, exception, sanitize } from './mediaDiagnostics.js';
const KEY='lumen.mediaTimeline', MAX=80, CAP=96000;
export const sessionId=Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10);
let sequence=0, pending=0, rows=[];
try { const raw=localStorage.getItem(KEY); const saved=raw?.length<=CAP?JSON.parse(raw):null; if(Array.isArray(saved)) rows=saved.filter(row=>row && typeof row.time==='string' && typeof row.songId==='string').slice(-MAX); } catch {}
export const operationId=()=>sessionId+':'+(++sequence);
export function timeline(id) { return rows.filter(row=>!id || row.songId===id).map(row=>({...row})).sort((a,b)=>a.time.localeCompare(b.time)); }
function append(row) {
 try {
  rows.push(JSON.parse(JSON.stringify(row,(key,value)=>typeof value==='string'?sanitize(value):value))); rows=rows.slice(-MAX);
  while(JSON.stringify(rows).length>CAP && rows.length) rows.shift();
  localStorage.setItem(KEY,JSON.stringify(rows));
 } catch {} // Storage denial/quota cannot affect the product.
}
export function traceRecord(operation, record, {id=record?.id,op=operationId(),error}={}) {
 const time=new Date().toISOString();
 // Also bound in-flight probes when a broken platform leaves reads pending.
 if(pending>=12)return;
 pending++;
 const captured=['audioBlob','instrumentalBlob'].map(field=>[field,record?.[field]]);
 void (async()=>{
  const probes=[];
  try {
   for(const [field,blob] of captured) {
    let timer;
    const probe=inspectBlob(blob,field==='instrumentalBlob');probes.push(probe);
    const result=await Promise.race([probe,new Promise(resolve=>{timer=setTimeout(()=>resolve({probeTimeout:true}),3000);})]).finally(()=>clearTimeout(timer));
    append({time,completedAt:new Date().toISOString(),sessionId,operation,songId:id,op,recordExists:!!record,field,blobClass:typeof File!=='undefined' && blob instanceof File?'File':blob instanceof Blob?'Blob':null,...result,...(error?{error:exception(error)}:{})});
   }
  } catch {} finally {await Promise.allSettled(probes);pending--;}
 })();
}
