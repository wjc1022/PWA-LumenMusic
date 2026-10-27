// Dependency-free Chromium smoke checks. Uses an isolated profile and synthetic audio.
// CHROME_PATH may point to a different installed Chromium executable.
import http from 'node:http';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'};
let finish;
let offline=false;
const completed = new Promise(resolve => {finish=resolve;});
const server=http.createServer(async(req,res)=>{
  if(req.url==='/__reference-audio' && process.env.LUMEN_TEST_AUDIO_PATH) {try{res.setHeader('Content-Type','audio/mpeg');res.end(await readFile(process.env.LUMEN_TEST_AUDIO_PATH));}catch{res.writeHead(404);res.end();}return;}
  if(req.url==='/__result') {let body='';for await(const chunk of req)body+=chunk;res.end('ok');finish(body);return;}
  if(req.url==='/__offline') {offline=true;res.end('ok');return;}
  if(offline) {res.writeHead(503);res.end('Offline test');return;}
  try {const path=resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));if(!path.startsWith(root))throw Error();res.setHeader('Content-Type',types[extname(path)]||'application/octet-stream');res.end(await readFile(path));}
  catch {res.writeHead(404);res.end();}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
if(process.argv.includes('--serve')) {
  console.log(`Preview: http://127.0.0.1:${server.address().port}/tests/browser.html?preview`);
  await new Promise(()=>{});
}
const referenceQuery=process.env.LUMEN_TEST_AUDIO_PATH?'?reference':'';
const testPage=process.argv.includes('--stable-audio')?'audio-position.browser.html':'browser.html';
const profile=await mkdtemp(join(tmpdir(),'lumen-browser-'));
const chrome=process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const motionFlags=process.argv.includes('--reduced-motion')?['--force-prefers-reduced-motion']:[];
const child=spawn(chrome,['--headless=new','--disable-gpu','--no-first-run','--autoplay-policy=no-user-gesture-required',...motionFlags,'--user-data-dir='+profile,'--window-size=1280,900',`http://127.0.0.1:${server.address().port}/tests/${testPage}${referenceQuery}`]);
let output='',errors='';child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>errors+=data);
const timeout=setTimeout(()=>finish('FAIL browser timed out\n'+errors),45000);
child.on('error',error=>finish('FAIL '+error));
child.on('exit',code=>finish('FAIL Chrome exited ('+code+')\n'+errors));
const result=await completed;clearTimeout(timeout);child.kill();server.close();
if(process.argv.includes('--stable-audio')) await writeFile(new URL(referenceQuery?'./audio-position-mp3-result.txt':'./audio-position-wav-result.txt',import.meta.url),result+'\n');
console.log(result);
process.exitCode=result.startsWith('PASS')?0:1;
