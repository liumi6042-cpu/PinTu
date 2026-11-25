import {DatabaseSync} from 'node:sqlite';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'../..'),baseline=resolve(import.meta.dirname,'settings-before.json');
const db=new DatabaseSync(resolve(root,'content-admin/work/admin.sqlite'),{readOnly:true});
let settings;try{settings=Object.fromEntries(['content_drafts','game_settings','task_reward_settings'].map(table=>[table,db.prepare('SELECT id,revision,document FROM '+table+' ORDER BY id').all().map(({document,...row})=>({...row,sha256:createHash('sha256').update(document).digest('hex')}))]));}finally{db.close();}
if(!existsSync(baseline)){writeFileSync(baseline,JSON.stringify(settings,null,2)+'\n');console.log('Read-only settings baseline saved');}
else{assert.deepEqual(settings,JSON.parse(readFileSync(baseline,'utf8')));writeFileSync(resolve(import.meta.dirname,'settings-preservation.json'),JSON.stringify({settingsPreserved:true,settings},null,2)+'\n');console.log('Settings revisions and SHA256 unchanged');}
