import {build} from 'vite';
import {resolve} from 'node:path';

// Bundle the already installed ws runtime; production archives contain no node_modules.
export async function buildRoomRealtime(outDir='outputs/mobile'){
 await build({configFile:false,publicDir:false,ssr:{noExternal:['ws']},build:{ssr:resolve('server/room-realtime.mjs'),target:'node24',outDir:resolve(outDir),emptyOutDir:false,minify:false,rolldownOptions:{platform:'node',output:{entryFileNames:'room-realtime.mjs'}}}});
}
