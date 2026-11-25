import {DatabaseSync} from 'node:sqlite';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'../..');
const before=JSON.parse(readFileSync(resolve(root,'server-ops/migration-check-20261016/settings-preservation.json'),'utf8')).settings;
const db=new DatabaseSync(resolve(root,'content-admin/work/admin.sqlite'),{readOnly:true});
let settings;try{settings=Object.fromEntries(Object.keys(before).map(table=>[table,db.prepare('SELECT id,revision,document FROM '+table+' ORDER BY id').all().map(({document,...row})=>({...row,sha256:createHash('sha256').update(document).digest('hex')}))]));}finally{db.close();}
assert.deepEqual(settings,before,'Saved administrator configuration changed from migration baseline');
const result={settingsPreserved:true,settings};
writeFileSync(resolve(import.meta.dirname,'settings-preservation.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({settingsPreserved:result.settingsPreserved,tables:Object.fromEntries(Object.entries(settings).map(([table,rows])=>[table,rows.map(({revision})=>revision)]))}));
