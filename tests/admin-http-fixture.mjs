import { randomBytes } from 'node:crypto';
import { readFile,writeFile,mkdir,unlink } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { testDatabase } from './server-fixture-db.mjs';
import { passwordHash,randomSecret } from '../lib/account-crypto.ts';
const config=new URL('../.env.beta',import.meta.url),file=new URL('../work/admin-http-fixture.json',import.meta.url);
const db=await testDatabase();
try{
 if(process.argv[2]==='prepare'){
  try{await readFile(file);throw new Error('Existing fixture must be cleaned first');}catch(e){if(e.code!=='ENOENT')throw e;}
  let original;try{original=await readFile(config,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;original='PUZZLE_BETA_CAPACITY=24\n';await writeFile(config,original);}
  const id=randomBytes(16).toString('hex'),username='admin_test_'+id.slice(0,8),password=randomSecret(),salt=randomSecret();
  db.prepare('INSERT INTO puzzle_users VALUES (?,?,?,?,?,?)').run(id,username,'临时验收管理员',await passwordHash(password,salt),salt,Date.now());
  const ids=parseEnv(original).PUZZLE_ADMIN_IDS||'',applied=original.replace(/^PUZZLE_ADMIN_IDS=.*$/gm,'')+'\nPUZZLE_ADMIN_IDS='+[ids,id].filter(Boolean).join(',')+'\n';
  await mkdir(new URL('../work/',import.meta.url),{recursive:true});await writeFile(file,JSON.stringify({id,username,password,original,applied}));await writeFile(config,applied);console.log('Temporary local administrator fixture prepared.');
 }else if(process.argv[2]==='cleanup'){
  const fixture=JSON.parse(await readFile(file,'utf8'));
  if(await readFile(config,'utf8')!==fixture.applied)throw new Error('Configuration changed; inspect before restoring fixture');
  await writeFile(config,fixture.original);
  db.prepare('DELETE FROM puzzle_admin_audit WHERE actor_id=?').run(fixture.id);
  db.prepare('DELETE FROM puzzle_sessions WHERE user_id=?').run(fixture.id);
  db.prepare('DELETE FROM puzzle_account_security WHERE user_id=?').run(fixture.id);
  db.prepare('DELETE FROM puzzle_users WHERE id=?').run(fixture.id);
  db.prepare('DELETE FROM puzzle_request_limits WHERE key=?').run('password-check:'+await (await import('../lib/account-crypto.ts')).tokenHash(fixture.id));
  await unlink(file);console.log('Temporary administrator removed; prior configuration restored.');
 }else throw new Error('Use prepare or cleanup');
}finally{db.close();}
