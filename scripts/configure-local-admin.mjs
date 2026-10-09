import { DatabaseSync } from 'node:sqlite';
import { readdir,readFile,writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseEnv } from 'node:util';
const root=fileURLToPath(new URL('../',import.meta.url)),username=process.argv[2]?.trim().toLowerCase();
if(!username||!/^[a-z0-9_]{3,24}$/.test(username))throw new Error('Supply an existing username (3–24 letters, numbers or underscores).');
async function findDatabase(dir){for(const item of await readdir(dir,{withFileTypes:true})){if(item.isSymbolicLink())continue;const file=path.join(dir,item.name);if(item.isDirectory()){const found=await findDatabase(file);if(found)return found;}else if(item.name.endsWith('.sqlite')){const db=new DatabaseSync(file,{readOnly:true,timeout:5000});if(db.prepare("SELECT name FROM sqlite_master WHERE name='puzzle_users'").get())return db;db.close();}}}
const db=await findDatabase(path.join(root,'.wrangler/state/v3/d1'));if(!db)throw new Error('Start the local puzzle server once before assigning an administrator.');
let user;try{user=db.prepare('SELECT id FROM puzzle_users WHERE username=?').get(username);}finally{db.close();}
if(!user)throw new Error('The account does not exist. Register it on the local website first.');
const file=path.join(root,'.env.beta');let raw='';try{raw=await readFile(file,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
const ids=new Set((parseEnv(raw).PUZZLE_ADMIN_IDS||'').split(',').map(s=>s.trim()).filter(Boolean));
if(process.argv.includes('--remove'))ids.delete(user.id);else ids.add(user.id);
await writeFile(file,raw.replace(/^PUZZLE_ADMIN_IDS=.*(?:\r?\n|$)/gm,'').trimEnd()+'\nPUZZLE_ADMIN_IDS='+[...ids].join(',')+'\n');
console.log('Local administrator configuration updated. Restart the local server to apply it.');
