/** Node's env reader cannot be imported by shared browser guidance. Inject the
 * delivered registry only in Vinext's server environments, before compilation;
 * the client keeps the original module and bundled guidance unchanged. */
export function deliveredGuidancePlugin(){
 return {
  name:'delivered-server-guidance',
  enforce:'pre',
  transform(source,id,options){
   if(!options?.ssr&&!['rsc','ssr'].includes(this.environment?.name))return;
   if(!id.replaceAll('\\','/').endsWith('/lib/play-guidance.ts'))return;
   const declaration='const records: Record<string, PhotoGuidance> = guidance;';
   if(!source.includes(declaration))throw new Error('Server guidance injection point missing');
   return {code:"import {managedPhotos as deliveredPhotos} from '../server/managed-content.node.mjs';\nimport {mergeDeliveredGuidance} from '../server/delivered-guidance.mjs';\n"+source.replace(declaration,'const records: Record<string, PhotoGuidance> = mergeDeliveredGuidance(guidance, deliveredPhotos);'),map:null};
  },
 };
}
