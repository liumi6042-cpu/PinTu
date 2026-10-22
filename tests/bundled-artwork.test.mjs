import test from 'node:test';
import assert from 'node:assert/strict';
import {GameClient} from '../mobile/client.ts';
import {createWebPlatform} from '../mobile/platform-web.ts';
const picture='/puzzles/test-picture-optimized-0123456789ab.webp',thumb='/puzzles/test-picture-thumbnail-abcdef012345.webp';
const base={id:'taptap',gameName:'test',apiBase:'https://game.test/h5-mobile-v3',assetBase:'https://cdn.test/assets',bundledArtwork:{[picture]:'assets'+picture,[thumb]:'assets'+thumb}};
const client=(config=base)=>new GameClient({config,request:()=>{throw Error('Resolving artwork cannot perform a server request');}});
test('bundled thumbnails and game images stay package-relative even through configured origin URLs',()=>{
 const c=client();for(const path of [picture,picture.slice(1),'https://cdn.test/assets'+picture,'https://game.test/h5-mobile-v3/assets'+picture,'https://game.test'+picture])assert.equal(c.asset(path),'assets'+picture);
 assert.equal(c.asset(thumb),'assets'+thumb);assert.equal(c.asset(c.asset(thumb)),'assets'+thumb);
});
test('changed image hashes, private routes, unrelated hosts and desktop keep their original delivery route',()=>{
 const c=client(),changed=picture.replace('0123456789ab','1123456789ab');
 assert.equal(c.asset(changed),'https://cdn.test/assets'+changed);
 assert.equal(c.asset('https://other.test'+picture),'https://other.test'+picture);
 assert.equal(c.asset('/api/user-images/custom-'+'a'.repeat(32)),'https://game.test/h5-mobile-v3/api/user-images/custom-'+'a'.repeat(32));
 assert.throws(()=>c.asset('//evil.test'+picture));
 assert.equal(client({...base,id:'web'}).asset(picture),'https://cdn.test/assets'+picture);
 assert.equal(client({...base,bundledArtwork:{[picture]:'../private.png'}}).asset(picture),'https://cdn.test/assets'+picture);
});

test('TapTap wrapper loads bundled puzzles beside game.js without imposing server-artwork CORS on package files',t=>{
 const globals={document:{baseURI:'https://wrapper.test/boot/',scripts:[{src:'https://package.test/game/game.js'}],hidden:false},window:{},location:{origin:'https://wrapper.test',href:'https://wrapper.test/boot/'}};
 for(const [key,value] of Object.entries(globals)){const old=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});t.after(()=>old?Object.defineProperty(globalThis,key,old):delete globalThis[key]);}
 const p=createWebPlatform(base,{style:{}}),c=new GameClient(p),image={crossOrigin:'anonymous',removeAttribute(){this.crossOrigin='';}};
 p.setImageSource(image,c.asset(thumb));assert.equal(image.src,'https://package.test/game/assets'+thumb);assert.notEqual(image.crossOrigin,'anonymous');
 p.setImageSource(image,'https://game.test'+thumb);assert.equal(image.crossOrigin,'anonymous','Actual remote puzzle images retain their CORS handling');p.audio.dispose();
});
