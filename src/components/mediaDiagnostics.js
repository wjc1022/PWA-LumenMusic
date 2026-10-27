import { el } from '../utils/dom.js';
import { t } from '../services/i18nService.js';
import { Songs } from '../database/db.js';
import { timeline } from '../services/mediaTimeline.js';
import { audioEl,getCurrentSong,getLastMediaFailure,clearMediaFailure,getPlaybackDiagnostics } from '../services/audioEngine.js';
import { inspectRecord,probeMetadata,mediaState,formatReport,copyReport,latestOnly,exception } from '../services/mediaDiagnostics.js';
export function buildMediaDiagnostics() {
 const panel=el('details',{class:'panel glass media-diagnostics',id:'mediaDiagnostics'});
 const select=el('select',{'aria-label':t('diagnostics.target')});
 const variant=el('select',{'aria-label':t('diagnostics.resource')},[
  el('option',{value:'audioBlob'},t('diagnostics.main')),el('option',{value:'instrumentalBlob'},t('diagnostics.instrumental'))]);
 const target=el('p',{}),liveView=el('pre',{'aria-live':'polite'}),lastView=el('pre',{}),historyView=el('pre',{});
 const report=el('textarea',{readonly:true,rows:16,'aria-label':t('diagnostics.report')});
 report.style.cssText='width:100%;box-sizing:border-box;direction:ltr';
 for(const pre of [liveView,lastView,historyView])pre.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;direction:ltr';
 const status=el('p',{'aria-live':'polite'}),gate=latestOnly();let live=null,load=null,controller=null;
 const environment={origin:location.origin,browser:navigator.userAgent};
 const update=()=>{
  target.textContent=t('diagnostics.target')+': '+(select.selectedOptions[0]?.textContent||'—');
  liveView.textContent=live?JSON.stringify(live,null,2):t('diagnostics.notChecked');
  const last=getLastMediaFailure();lastView.textContent=last?JSON.stringify({belongsToSelected:last.songId===select.value,...last},null,2):t('diagnostics.noFailure');
  const history=timeline(select.value);
  historyView.textContent=JSON.stringify(history,null,2);
  report.value=formatReport({live,last,selectedId:select.value,load,history,environment:{...environment,playback:getPlaybackDiagnostics()}});
  if(JSON.stringify(live).includes('NotFoundError')) status.textContent=t('diagnostics.unreadable');
 };
 const invalidate=()=>{gate.next();controller?.abort();live=null;load=null;status.textContent='';update();};
 select.addEventListener('change',invalidate);variant.addEventListener('change',invalidate);
 const check=el('button',{class:'btn ghost'},t('diagnostics.check'));
 check.addEventListener('click',async()=>{
  const revision=gate.next(),id=select.value;controller?.abort();load=null;status.textContent='';
  const result=await inspectRecord(id);
  if(!gate.current(revision)||!panel.isConnected)return;
  live={...result,player:{songId:getCurrentSong()?.id,belongsToSelected:getCurrentSong()?.id===id,...mediaState(audioEl)}};update();
 });
 const probe=el('button',{class:'btn ghost'},t('diagnostics.load'));
 probe.addEventListener('click',async()=>{
  const revision=gate.next(),id=select.value,key=variant.value;controller?.abort();controller=new AbortController();
  const signal=controller.signal;load={status:'checking',resource:key};update();
  try {
   const record=await Songs.withMedia(id);
   if(!gate.current(revision)||!panel.isConnected)return;
   const result=record?await probeMetadata(record[key],record.mediaType,{signal}):{status:'missing-record'};
   if(!gate.current(revision)||!panel.isConnected)return;
   load={time:new Date().toISOString(),...result,songId:id,resource:key,optional:key==='instrumentalBlob'};
  }catch(error){if(!gate.current(revision)||!panel.isConnected)return;load={time:new Date().toISOString(),songId:id,resource:key,status:'database-error',error:exception(error)};}
  update();
 });
 const copy=el('button',{class:'btn ghost'},t('diagnostics.copy'));
 copy.addEventListener('click',async()=>{update();const ok=await copyReport(report.value);status.textContent=t(ok?'diagnostics.copied':'diagnostics.manual');if(!ok){report.focus();report.select();}});
 const clear=el('button',{class:'btn ghost'},t('diagnostics.clear'));
 clear.addEventListener('click',()=>{clearMediaFailure();update();});
 panel.append(el('summary',{class:'panel-title'},t('diagnostics.title')));
 panel.append(el('div',{class:'media-diagnostics-content'},[
 el('p',{class:'panel-hint'},t('diagnostics.hint')),
 select,target,variant,el('div',{class:'data-actions'},[check,probe,copy,clear]),
 el('h3',{},t('diagnostics.live')),liveView,el('h3',{},t('diagnostics.last')),lastView,
 el('h3',{},t('diagnostics.history')),historyView,
 el('p',{},t('diagnostics.caution')),el('p',{},t('diagnostics.metadataCaution')),report,status]));
 Songs.all().then(songs=>{
  if(!panel.isConnected)return;
  const current=getCurrentSong();if(current&&!songs.some(song=>song.id===current.id))songs.unshift(current);
  for(const song of songs)select.append(el('option',{value:song.id},`${song.title||'—'} (${song.id})`));
  if(current)select.value=current.id;check.disabled=probe.disabled=!songs.length;update();
 }).catch(error=>{live={databaseError:exception(error)};check.disabled=probe.disabled=true;update();});
 update();return panel;
}
