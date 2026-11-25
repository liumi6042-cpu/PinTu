import { MobileArt, type MobileArtKind } from './mobile-icons';
import './mobile-task-icons.css';

export type TaskArtKind='ten'|'cooperation-10'|'cooperation-30'|'cooperation-60'|'friend-10'|'friend-30'|'refill'|'task-book'|'invitation'|'gold-gift'|'xp-chest'|'pouch';
const art:Record<TaskArtKind,{main:MobileArtKind;accent?:MobileArtKind}>={
 ten:{main:'pouch'}, 'cooperation-10':{main:'cooperationArt'}, 'cooperation-30':{main:'cooperationArt'}, 'cooperation-60':{main:'cooperationArt'},
 'friend-10':{main:'friendArt'}, 'friend-30':{main:'friendArt'}, refill:{main:'refillGift'}, 'task-book':{main:'book'}, invitation:{main:'invitationArt'},
 'gold-gift':{main:'goldGift'}, 'xp-chest':{main:'xpChest'}, pouch:{main:'pouch'},
};

/** Dedicated illustrations reproduce the approved task concept; no substitute icon collages. */
export function TaskArt({kind,className=''}:{kind:TaskArtKind;className?:string}){
 const visual=art[kind];
 return <span className={'mobile-task-art mobile-task-art-'+kind+(className?' '+className:'')} data-task-art={kind} aria-hidden="true"><MobileArt kind={visual.main}/>{visual.accent&&<MobileArt kind={visual.accent} className="mobile-task-art-accent"/>}</span>;
}
export function giftArtKind(kind:string):TaskArtKind{
 if(kind==='invite-refill')return 'refill';
 if(kind==='invite-friend')return 'refill';
 if(kind==='share-invitation')return 'pouch';
 if(kind.startsWith('cooperation'))return kind==='cooperation-30'?'xp-chest':'gold-gift';
 if(kind.startsWith('friend'))return 'gold-gift';
 if(Object.hasOwn(art,kind))return kind as TaskArtKind;
 return 'ten';
}

