// Run with Node 24+: node server-ops/performance-20261017/remaining/evidence-mobile-writes.mjs
// Loads the two bounded baseline source copies against unchanged project dependencies.
// Every database here is a disposable fixture under the mobile project's work directory.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const project=fileURLToPath(new URL('../../../jigsaw-nook-taptap/',import.meta.url));
const baseline=new URL('./baseline/server/',import.meta.url);
const dataModule=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const originalSocial=dataModule(readFileSync(new URL('mobile-social.mjs',baseline),'utf8'));
const originalService=readFileSync(new URL('mobile-service.mjs',baseline),'utf8').replace(/from (['"])(\.[^'"]+)\1/g,(_all,_quote,specifier)=>'from '+JSON.stringify(specifier==='./mobile-social.mjs'?originalSocial:pathToFileURL(resolve(project,'server',specifier)).href));
const modes={before:(await import(dataModule(originalService))).createMobileService,after:(await import(pathToFileURL(resolve(project,'server/mobile-service.mjs')).href)).createMobileService};
const result={requestCount:60,intervalMs:1000,scope:'mobile_profiles and mobile_social_players row INSERT/UPDATE triggers; transaction acquisition is retained',scenarios:{}};
mkdirSync(resolve(project,'work'),{recursive:true});
for(const scenario of ['mobile-full','mobile-not-due','web']){
 const rows={};
 for(const [version,createMobileService] of Object.entries(modes)){
  const dir=mkdtempSync(resolve(project,'work/mobile-write-evidence-')),databasePath=resolve(dir,'fixture.sqlite');
  let now=1800000000000;
  const service=createMobileService({databasePath,now:()=>now,...(scenario==='web'?{runtimeProfile:'web'}:{})}),db=new DatabaseSync(databasePath);
  const call=()=>service.handle({identity:'a'.repeat(64),method:'GET',url:'/api/mobile/profile'});
  try{
   db.exec(`CREATE TABLE write_audit(target TEXT NOT NULL,operation TEXT NOT NULL);
   CREATE TRIGGER profile_insert AFTER INSERT ON mobile_profiles BEGIN INSERT INTO write_audit VALUES('profile','insert'); END;
   CREATE TRIGGER profile_update AFTER UPDATE ON mobile_profiles BEGIN INSERT INTO write_audit VALUES('profile','update'); END;
   CREATE TRIGGER presence_insert AFTER INSERT ON mobile_social_players BEGIN INSERT INTO write_audit VALUES('presence','insert'); END;
   CREATE TRIGGER presence_update AFTER UPDATE ON mobile_social_players BEGIN INSERT INTO write_audit VALUES('presence','update'); END;`);
   assert.equal(call().status,200);
   const counts=()=>Object.fromEntries(['profile','presence'].map(target=>[target,Object.fromEntries(['insert','update'].map(operation=>[operation,Number(db.prepare('SELECT COUNT(*) n FROM write_audit WHERE target=? AND operation=?').get(target,operation).n)]))]));
   const initialization=counts();
   if(scenario==='mobile-not-due'){
    const profile=JSON.parse(db.prepare('SELECT data FROM mobile_profiles').get().data);profile.energy=20;
    db.prepare('UPDATE mobile_profiles SET data=? WHERE id=?').run(JSON.stringify(profile),profile.id);
   }
   db.exec('DELETE FROM write_audit');
   for(let i=0;i<result.requestCount;i++){now+=result.intervalMs;assert.equal(call().status,200);}
   rows[version]={initialization,polling:counts()};
  }finally{db.close();service.close();assert.ok(dir.startsWith(resolve(project,'work')+'\\'));rmSync(dir,{recursive:true,force:true});}
 }
 result.scenarios[scenario]=rows;
}
writeFileSync(new URL('./mobile-write-counts.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
