import {existsSync,realpathSync} from 'node:fs';
import {basename,dirname,isAbsolute,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readManagedRelease} from '../server/content-release.mjs';
import {validateWebContentRelease} from '../server/managed-content.node.mjs';
import {resolveMediaDir} from './media-paths.mjs';

/** CMS preflight is deliberately read-only, including daily content. */
export function checkContentRelease(environment=process.env){
 const directory=environment.JIGSAW_CONTENT_RELEASE_DIR,releaseId=environment.JIGSAW_CONTENT_RELEASE_ID,digest=environment.JIGSAW_CONTENT_MANIFEST_SHA256;
 if(typeof directory!=='string'||!isAbsolute(directory)||typeof releaseId!=='string'||typeof digest!=='string'||!/^[a-f0-9]{64}$/.test(digest))throw new Error('缺少有效的待验收版本参数。');
 const target=realpathSync(directory);
 if(basename(target)!==releaseId||basename(dirname(target))!=='releases')throw new Error('待验收目录与版本标识不一致。');
 const release=readManagedRelease(dirname(dirname(target)),{releaseId,strict:true});
 if(release.releaseDir!==target||release.manifestSha256!==digest)throw new Error('待验收版本与清单摘要不一致。');
 const root=fileURLToPath(new URL('..',import.meta.url)),packaged=resolve(root,'dist/client');
 const assetDir=existsSync(resolve(packaged,'puzzles'))?packaged:existsSync(resolve(root,'public/puzzles'))?resolve(root,'public'):dirname(resolveMediaDir(root,'puzzles'));
 const snapshot=validateWebContentRelease(release,{assetDir});
 return {ok:true,contentReleaseId:snapshot.releaseId,...snapshot.summary};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(checkContentRelease()));}
 catch{console.error('内容发布只读预检失败，请检查版本、公开配置和已交付素材。');process.exitCode=1;}
}
