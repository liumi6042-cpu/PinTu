import {build} from 'esbuild';
import {copyFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';

/** Add the real HTTP entry and a portable bundle to a fresh standalone output. */
export async function prepareNodeRealtime(output,{root=resolve(import.meta.dirname,'..')}={}){
 if(!existsSync(join(output,'server.js')))throw Error('Expected generated standalone server before realtime preparation');
 mkdirSync(join(output,'server'),{recursive:true});
 await build({absWorkingDir:root,entryPoints:['server/room-realtime.node.mjs'],outfile:join(output,'server/room-realtime.node.mjs'),bundle:true,platform:'node',target:'node24',format:'esm',external:['bufferutil','utf-8-validate'],banner:{js:'import {createRequire as __realtimeRequire} from "node:module";const require=__realtimeRequire(import.meta.url);'},legalComments:'eof'});
 copyFileSync(join(root,'server/node-entry.mjs'),join(output,'server.js'));
 copyFileSync(join(root,'server/room-realtime.LICENSE.txt'),join(output,'server/room-realtime.LICENSE.txt'));
}
