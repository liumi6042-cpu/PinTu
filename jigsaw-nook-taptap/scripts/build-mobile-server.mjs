import {build} from 'vite';
import {resolve} from 'node:path';
import {buildRoomRealtime} from './build-room-realtime.mjs';
await build({configFile:false,publicDir:false,build:{ssr:resolve('server/mobile-engine.entry.ts'),target:'node24',outDir:'outputs/mobile',emptyOutDir:false,minify:false,rolldownOptions:{platform:'node',output:{entryFileNames:'engine.mjs'}}}});
await buildRoomRealtime();
