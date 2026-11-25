import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { hash } from './release-files.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));process.chdir(root);
const args=process.argv.slice(2),host=args[args.indexOf('--host')+1];
if(!args.includes('--host')||!host||!/^([a-zA-Z0-9_-]+@)?[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(host))throw new Error('Usage: npm run release:upload -- --host SSH_ALIAS [--dry-run]');
const report=JSON.parse(readFileSync('releases/latest.json','utf8')),archive=readFileSync('releases/latest.tar.gz');
if(report.app!=='jigsaw-nook'||report.file!=='latest.tar.gz'||report.dirty||report.verified!==true||report.bytes!==archive.length||report.sha256!==hash(archive))throw new Error('Release is uncommitted, unverified, invalid or changed. Rebuild it first.');
const head=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true});
const status=spawnSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8',windowsHide:true});
if(head.status!==0||status.status!==0||head.stdout.trim()!==report.gitCommit||status.stdout.trim())throw new Error('Source has changed since the release. Commit and rebuild before uploading.');
const remote=`/tmp/jigsaw-nook-${report.sha256.slice(0,16)}.tar.gz`;
console.log(JSON.stringify({host,remote,bytes:report.bytes,gitCommit:report.gitCommit,sha256:report.sha256,dryRun:args.includes('--dry-run')},null,2));
if(!args.includes('--dry-run')){
  const result=spawnSync('scp',['-o','BatchMode=yes','releases/latest.tar.gz',host+':'+remote],{cwd:root,stdio:'inherit',windowsHide:true});
  if(result.error||result.status!==0)throw new Error('Release upload failed');
  console.log('Uploaded runtime archive only. No deployment, cleanup, service restart or database operation was performed.');
}
