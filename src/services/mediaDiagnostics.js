import { Songs } from '../database/db.js';
export const APP_CACHE = 'lumen-shell-v26';
export const sanitize = value => String(value ?? '').replace(/blob:[^\s"<>]+|file:[^\s"<>]+|[A-Za-z]:[\\/][^\s"<>]+|\/(?:private|var|Users|home|Volumes|storage)\/[^\s"<>]+/g, '[redacted]').slice(0, 1000);
export const exception = error => ({ name: sanitize(error?.name), message: sanitize(error?.message) });
export function mediaState(media) {
 return { blobURL: String(media.currentSrc || media.src || '').startsWith('blob:'), readyState:media.readyState, networkState:media.networkState,
 error: media.error ? {code:media.error.code,message:sanitize(media.error.message)} : null };
}
export async function inspectBlob(blob, optional = false) {
 const result={exists:blob!=null,validBlob:blob instanceof Blob,optional,size:null,type:null};
 if(!result.validBlob) return result;
 result.size=blob.size;result.type=sanitize(blob.type);result.nonEmpty=blob.size>0;
 if(!blob.size) return result;
 for(const [key,start,end] of [['head',0,Math.min(64,blob.size)],['tail',Math.max(0,blob.size-64),blob.size]]) {
  try {const bytes=await blob.slice(start,end).arrayBuffer();result[key]={readable:true,bytesRead:bytes.byteLength};}
  catch(error){result[key]={readable:false,error:exception(error)};}
 }
 return result;
}
export async function inspectRecord(id, get = Songs.get) {
 const result={time:new Date().toISOString(),songId:id};
 try {
  const record=await get(id, 'user-check');result.recordExists=!!record;
  if(record) {result.mediaType=record.mediaType||'audio';result.savedMIME=sanitize(record.mimeType);result.savedInstrumentalMIME=sanitize(record.instrumentalMimeType);
   result.audioBlob=await inspectBlob(record.audioBlob);
   result.instrumentalBlob=await inspectBlob(record.instrumentalBlob,true);
  }
 }catch(error){result.databaseError=exception(error);}
 return result;
}
// Independent metadata probe. It never invokes play or touches the player.
export function probeMetadata(blob, mediaType, {signal,timeout=10000,create=()=>document.createElement(mediaType==='video'?'video':'audio'),urls=URL}={}) {
 if(!(blob instanceof Blob)||blob.size===0) return Promise.resolve({status:'invalid-blob'});
 if(signal?.aborted) return Promise.resolve({status:'cancelled'});
 return new Promise(resolve=>{
  let media,url,timer,done=false;
  const finish=(status,error)=>{
   if(done)return;done=true;clearTimeout(timer);
   signal?.removeEventListener('abort',abort);
   const state=media?mediaState(media):null;
   if(media){media.removeEventListener('loadedmetadata',loaded);media.removeEventListener('error',failed);
    try{media.removeAttribute('src');media.load();media.remove();}catch{}}
   if(url)urls.revokeObjectURL(url);
   resolve({status,time:new Date().toISOString(),state,...(error?{exception:exception(error)}:{})});
  };
  const loaded=()=>finish('metadata-loaded'),failed=()=>finish('media-error'),abort=()=>finish('cancelled');
  try {
   media=create();media.muted=true;media.preload='metadata';media.playsInline=true;
   media.addEventListener('loadedmetadata',loaded);media.addEventListener('error',failed);
   signal?.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>finish('timeout'),timeout);
   url=urls.createObjectURL(blob);media.src=url;media.load();
  }catch(error){finish('exception',error);}
 });
}
export function latestOnly() {let revision=0;return {next:()=>++revision,current:value=>value===revision};}
export async function copyReport(text,clipboard=globalThis.navigator?.clipboard) {
 try{if(!clipboard?.writeText)return false;await clipboard.writeText(text);return true;}catch{return false;}
}
export function formatReport({live,last,selectedId,load,history=[],environment={}}) {
 return JSON.stringify({appCache:APP_CACHE,...environment,selectedId,live,load,history,
 lastFailure:last?{belongsToSelected:last.songId===selectedId,...last}:null},(key,value)=>typeof value==='string'?sanitize(value):value,2);
}
