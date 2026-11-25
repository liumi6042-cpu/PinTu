import type {MobileLevelClear} from '../h5/mobile-api';

export type CompletionPhase='idle'|'transition'|'popup'|'closed';
export type CompletionPhaseEvent={phase:CompletionPhase;previous:CompletionPhase;roomId:string;level:boolean;levelId:string|null};
export type CompletionContext={roomId:string;level:boolean;levelId:string|null;levelClear:MobileLevelClear|null};
export type CompletionAction={label:string;tone?:string;action:()=>void};
export class CompletionFlow{
 private current:CompletionPhase='idle';private listeners=new Set<{fn:(event:CompletionPhaseEvent)=>void}>();private providers=new Set<{fn:(context:CompletionContext)=>CompletionAction|null}>();
 get phase():CompletionPhase{return this.current;}
 set(phase:CompletionPhase,context:CompletionContext){if(phase===this.current)return;const previous=this.current;this.current=phase;const event:CompletionPhaseEvent={phase,previous,roomId:context.roomId,level:context.level,levelId:context.levelId};for(const listener of [...this.listeners])if(this.listeners.has(listener))try{listener.fn(event);}catch{}}
 subscribe(fn:(event:CompletionPhaseEvent)=>void):()=>void{const listener={fn};this.listeners.add(listener);return()=>{this.listeners.delete(listener);};}
 register(fn:(context:CompletionContext)=>CompletionAction|null):()=>void{const provider={fn};this.providers.add(provider);return()=>{this.providers.delete(provider);};}
 action(context:CompletionContext):CompletionAction|null{for(const provider of [...this.providers])if(this.providers.has(provider))try{const action=provider.fn(context);if(action&&action.label.trim())return action;}catch{}return null;}
}
