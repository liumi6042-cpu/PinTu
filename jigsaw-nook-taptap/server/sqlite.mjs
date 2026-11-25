import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync,mkdirSync,chmodSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';

// Implements the prepared statement and atomic batch operations used by this application.
// One synchronous SQLite connection prevents JavaScript tasks interleaving inside a transaction.
class Statement {
  constructor(owner,query,values=[]){this.owner=owner;this.query=query;this.values=values;}
  bind(...values){return new Statement(this.owner,this.query,values);}
  async first(column){const row=this.owner.sql.prepare(this.query).get(...this.values);return row?(column===undefined?{...row}:row[column]):null;}
  execute(){
    const started=performance.now(),native=this.owner.sql.prepare(this.query);
    let results=[],changes=0,lastId=0;
    if(native.columns().length){
      results=native.all(...this.values).map(row=>({...row}));
      if(/^\s*(?:INSERT|UPDATE|DELETE|REPLACE)\b/i.test(this.query)){
        const changed=this.owner.sql.prepare('SELECT changes() AS changes,last_insert_rowid() AS lastId').get();
        changes=Number(changed.changes);lastId=Number(changed.lastId);
      }
    }
    else{const result=native.run(...this.values);changes=Number(result.changes);lastId=Number(result.lastInsertRowid);}
    return {success:true,results,meta:{changes,last_row_id:lastId,duration:performance.now()-started}};
  }
  async all(){return this.execute();}
  async run(){return this.execute();}
}

export class SqliteD1 {
  constructor(filename,migrations){
    if(filename!==':memory:')mkdirSync(dirname(resolve(filename)),{recursive:true,mode:0o700});
    this.sql=new DatabaseSync(filename,{enableForeignKeyConstraints:true,enableDoubleQuotedStringLiterals:false});
    try{
      this.sql.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
      if(filename!==':memory:')chmodSync(filename,0o600);
      this.sql.exec('CREATE TABLE IF NOT EXISTS app_migrations(name TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at INTEGER NOT NULL)');
      for(const name of readdirSync(migrations).filter(name=>/^\d+_[a-zA-Z0-9_]+\.sql$/.test(name)).sort()){
        const source=readFileSync(resolve(migrations,name),'utf8');
        const hash=createHash('sha256').update(source).digest('hex');
        const previous=this.sql.prepare('SELECT sha256 FROM app_migrations WHERE name=?').get(name);
        if(previous){if(previous.sha256!==hash)throw new Error('Applied migration has changed');continue;}
        this.sql.exec('BEGIN IMMEDIATE');
        try{
          this.sql.exec(source);
          this.sql.prepare('INSERT INTO app_migrations VALUES(?,?,?)').run(name,hash,Date.now());
          this.sql.exec('COMMIT');
        }catch(error){this.sql.exec('ROLLBACK');throw error;}
      }
      this.sql.exec('PRAGMA optimize');
    }catch(error){this.sql.close();throw error;}
  }
  prepare(query){return new Statement(this,query);}
  withSession(){return this;}
  async batch(statements){
    if(statements.some(statement=>!(statement instanceof Statement)||statement.owner!==this))throw new Error('Statement database mismatch');
    this.sql.exec('BEGIN IMMEDIATE');
    try{const results=statements.map(statement=>statement.execute());this.sql.exec('COMMIT');return results;}
    catch(error){this.sql.exec('ROLLBACK');throw error;}
  }
  close(){this.sql.close();}
}
