import {readFileSync,writeFileSync,mkdirSync,renameSync,existsSync,readdirSync} from 'node:fs';
import {resolve,join,relative,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {mkdtempSync,rmSync} from 'node:fs';
import {planTapTapArtwork} from './bundle-taptap-artwork.mjs';
import {buildMobileShared} from './build-mobile-shared.mjs';
import {TAR} from './release-files.mjs';

// Builds the TapTap H5 upload zip: production shared-web build with bundled artwork, under a
// single jigsaw-nook/ folder. Albums must be the live managed albums (what the server serves),
// not a local guess, so bundled hashes match what clients will request.
// Usage: node scripts/package-taptap.mjs YYYYMMDD-name --albums <live-albums.json> [--catalog <catalog.json>] [--revisions <artwork-revisions.json>]
const root=resolve(import.meta.dirname,'..');
const name=process.argv[2],arg=key=>{const i=process.argv.indexOf(key);return i>0?process.argv[i+1]:undefined;};
if(!/^\d{8}-[a-z0-9-]{2,40}$/.test(name||''))throw Error('Usage: node scripts/package-taptap.mjs YYYYMMDD-name --albums <live-albums.json>');
const albumsPath=arg('--albums');if(!albumsPath)throw Error('--albums <live-albums.json> is required');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const readJson=path=>JSON.parse(readFileSync(resolve(root,path),'utf8'));
const albumsInput=readJson(albumsPath),albums=Array.isArray(albumsInput)?albumsInput:albumsInput.albums;
if(!Array.isArray(albums))throw Error('Albums file must be an array or {albums:[...]}');
const catalog=readJson(arg('--catalog')??'content/puzzle-catalog.json');
const revisions=readJson(arg('--revisions')??'content/artwork-revisions.json');
// Clients load the active artwork version, so bundle that one rather than the catalog's base build.
const effective=catalog.map(photo=>{
 const active=revisions.active?.[photo.id];if(!active)return photo;
 const version=revisions.versions?.[photo.id]?.find(item=>item.revision===active);
 if(!version)throw Error('Missing active artwork version: '+photo.id);
 return {...photo,thumbSrc:version.thumbSrc,optimizedSrc:version.src,playSrc:version.src};
});
const plan=await planTapTapArtwork({root,catalog:effective,albums});
const work=resolve(root,'work/taptap-package-'+name);
if(existsSync(work))throw Error('Work directory exists; choose a fresh name: '+work);
const [record]=await buildMobileShared({outputRoot:relative(root,work),production:true,platforms:['taptap'],bundledArtwork:plan});
const packageDir=join(work,'jigsaw-nook');renameSync(record.directory,packageDir);
mkdirSync(resolve(root,'releases'),{recursive:true});
const archive=resolve(root,'releases/jigsaw-nook-taptap-'+name+'.zip');
if(existsSync(archive))throw Error('Archive exists: '+archive);
const packed=spawnSync(TAR,['-a','-cf',archive,'-C',work,'jigsaw-nook'],{stdio:'inherit',windowsHide:true});
if(packed.status!==0||packed.error)throw Error('Zip failed');
// Verify by unpacking into a fresh temp folder and comparing every file with the build record.
const check=mkdtempSync(join(tmpdir(),'taptap-zip-check-'));
try{
 const unpacked=spawnSync(TAR,['-xf',archive,'-C',check],{stdio:'inherit',windowsHide:true});
 if(unpacked.status!==0||unpacked.error)throw Error('Zip verification unpack failed');
 const seen=[];const walk=(dir,prefix='')=>{for(const item of readdirSync(dir,{withFileTypes:true})){const path=join(dir,item.name);if(item.isDirectory())walk(path,prefix+item.name+'/');else seen.push(prefix+item.name);}};
 walk(join(check,'jigsaw-nook'));
 if(readdirSync(check).join()!=='jigsaw-nook')throw Error('Zip must contain only jigsaw-nook/');
 if(seen.length!==record.files.length)throw Error('Zip file count differs from build record');
 for(const file of record.files){const bytes=readFileSync(join(check,'jigsaw-nook',...file.path.split('/')));if(bytes.length!==file.bytes||sha(bytes)!==file.sha256)throw Error('Zip entry differs: '+file.path);}
}finally{rmSync(check,{recursive:true,force:true});}
const bytes=readFileSync(archive);
const report={archive,bytes:bytes.length,sha256:sha(bytes),files:record.files.length,bundledArtwork:plan.files.length,thumbnails:plan.thumbnailCount,puzzleImages:plan.files.filter(f=>f.kind==='puzzle').length,albums:plan.albums.map(a=>a.id),config:{...record.config,bundledArtwork:Object.keys(record.config.bundledArtwork??{}).length}};
writeFileSync(archive+'.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
