import {spawn} from 'node:child_process';import {resolve} from 'node:path';import {readFileSync,mkdirSync,openSync,closeSync} from 'node:fs';
import {createH5Gateway} from '../server/h5-gateway.mjs';
const web='http://127.0.0.1:3220';
mkdirSync('work/h5-http-test',{recursive:true});const log=openSync('work/h5-http-test/server.log','a');
const backend=spawn(process.execPath,['dist/standalone/server.js'],{cwd:process.cwd(),windowsHide:true,stdio:['ignore',log,log],env:{...process.env,HOST:'127.0.0.1',PORT:'3220',PUZZLE_PUBLIC_ORIGIN:web,PUZZLE_BOTS_ENABLED:'false',DATABASE_PATH:resolve('work/h5-http-test/puzzle.sqlite'),MIGRATIONS_DIR:resolve('drizzle')}});
const run=script=>new Promise((done,fail)=>{const child=spawn(process.execPath,[script],{cwd:process.cwd(),windowsHide:true,stdio:'inherit'});child.on('error',fail);child.on('exit',code=>code===0?done():fail(Error(script+' failed: '+code)));});
let gateway;
try{
 let ready=false;for(let i=0;i<100;i++){if(backend.exitCode!==null)throw Error('Isolated backend exited');try{const response=await fetch(web+'/api/health',{signal:AbortSignal.timeout(500)});if(response.ok){ready=true;break;}}catch{}await new Promise(done=>setTimeout(done,200));}
 if(!ready)throw Error('Isolated backend did not start');
 gateway=createH5Gateway({upstream:web,upstreamOrigin:web,allowedOrigins:['http://127.0.0.1:3211','https://h5-test.example'],databasePath:resolve('work/h5-http-test/h5-sessions.sqlite'),assetPaths:JSON.parse(readFileSync('h5/asset-manifest.json','utf8')),staticDir:resolve('outputs/h5')});
 await new Promise((done,fail)=>{gateway.once('error',fail);gateway.listen(3211,'127.0.0.1',done);});
 await run('tests/h5-room-http.mjs');await run('tests/h5-browser-smoke.mjs');
}finally{if(gateway?.listening)await new Promise(done=>gateway.close(done));backend.kill();closeSync(log);}
