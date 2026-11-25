import type {MobileChapter,MobileLevel} from '../h5/mobile-api';
import {bundledStory} from './bundled-story';

/** Old servers supply no story metadata; the bundled chapter follows level order. */
export function timeLabelFor(chapter:Pick<MobileChapter,'id'|'albumId'>,index:number,level:Pick<MobileLevel,'timeLabel'>):string|null{
 if(typeof level.timeLabel==='string'&&level.timeLabel.trim())return level.timeLabel;
 return bundledStory(chapter)?.levels[index]?.timeLabel||null;
}

export function nodeState(level:Pick<MobileLevel,'id'|'status'>,current:Pick<MobileLevel,'id'>|null|undefined):'cleared'|'current'|'locked'{
 if(level.status==='cleared')return 'cleared';
 return level.status==='unlocked'&&level.id===current?.id?'current':'locked';
}
