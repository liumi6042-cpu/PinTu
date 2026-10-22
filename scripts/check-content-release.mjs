import {lstatSync,realpathSync,readFileSync} from 'node:fs';
import {basename,dirname,resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {readManagedRelease,validContentReleaseId} from '../server/content-release.mjs';
import {validateMobileContentRelease} from '../server/mobile-managed-content.mjs';

/** SSH/local operator preflight. Imports no player service and writes nothing. */
export async function checkContentRelease(env=process.env){
 const directory=env.JIGSAW_CONTENT_RELEASE_DIR,id=env.JIGSAW_CONTENT_RELEASE_ID,expected=env.JIGSAW_CONTENT_MANIFEST_SHA256;
 if(!directory||!validContentReleaseId(id)||typeof expected!=='string'||!/^[a-f0-9]{64}$/.test(expected))throw Error('内容预检参数不完整或无效。');
 const absolute=resolve(directory),info=lstatSync(absolute);
 if(!info.isDirectory()||info.isSymbolicLink()||realpathSync(absolute)!==absolute||basename(absolute)!==id||basename(dirname(absolute))!=='releases')throw Error('内容预检目录不是指定的不可变发布目录。');
 const release=readManagedRelease(dirname(dirname(absolute)),{releaseId:id,strict:true});
 if(release.manifestSha256!==expected)throw Error('内容清单摘要与待发布版本不一致。');
 const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
 const engine=await import(pathToFileURL(resolve(root,'outputs/mobile/engine.mjs')).href);
 const snapshot=validateMobileContentRelease(release,{photos:engine.RESTORABLE_PHOTOS,assetDir:env.MOBILE_ASSET_DIR||resolve(root,'public'),assetPaths:JSON.parse(readFileSync(resolve(root,'h5/asset-manifest.json'),'utf8'))});
 return {ok:true,service:'jigsaw-mobile-v3',contentReleaseId:snapshot.releaseId,manifestSha256:snapshot.manifestSha256,configDigests:snapshot.configDigests,...snapshot.summary};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{console.log(JSON.stringify(await checkContentRelease()));}
 catch(error){console.error(JSON.stringify({ok:false,code:error.code||'CONTENT_PREFLIGHT_FAILED',error:error.code&&error.status?error.message:'内容预检失败，请核对配置、目录与素材交付。'}));process.exitCode=1;}
}
