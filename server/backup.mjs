import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, chmodSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve, isAbsolute } from 'node:path';

const filename=process.env.DATABASE_PATH;
if(!filename||!isAbsolute(filename))throw new Error('DATABASE_PATH must be absolute');
const directory=resolve(dirname(filename),'backups');
mkdirSync(directory,{recursive:true,mode:0o700});
const target=resolve(directory,'jigsaw-'+new Date().toISOString().replaceAll(':','-')+'.sqlite');
const source=new DatabaseSync(filename,{readOnly:true});
try { await backup(source,target); } finally { source.close(); }
chmodSync(target,0o600);
const copy=new DatabaseSync(target,{readOnly:true});
try { if(Object.values(copy.prepare('PRAGMA integrity_check').get())[0]!=='ok')throw new Error('Backup integrity failed'); }
finally { copy.close(); }
const sha256=createHash('sha256').update(readFileSync(target)).digest('hex');
writeFileSync(target+'.json',JSON.stringify({file:target.split(/[\\/]/).pop(),sha256,integrity:'ok',createdAt:new Date().toISOString()}),{mode:0o600});
const names=readdirSync(directory).filter(name=>/^jigsaw-\d{4}-\d\d-\d\dT[\d-]+\.\d{3}Z\.sqlite$/.test(name)).sort().reverse();
for(const name of names.slice(14)){
  const file=resolve(directory,name),record=JSON.parse(readFileSync(file+'.json','utf8'));
  if(record.file===name&&record.integrity==='ok'&&record.sha256===createHash('sha256').update(readFileSync(file)).digest('hex')){
    unlinkSync(file);unlinkSync(file+'.json');
  }
}
console.log('Puzzle online backup completed; integrity and SHA-256 recorded.');
