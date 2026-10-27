import type {MobileChapter,MobileLevel} from '../h5/mobile-api';
import story from './story-comics-ch1.json';

/** Old servers supply no story metadata; the bundled chapter follows level order. */
export function timeLabelFor(chapter:Pick<MobileChapter,'id'|'albumId'>,index:number,level:Pick<MobileLevel,'timeLabel'>):string|null{
 if(typeof level.timeLabel==='string'&&level.timeLabel.trim())return level.timeLabel;
 if(chapter.albumId===story.chapter||chapter.id==='ch1')return story.levels[index]?.timeLabel||null;
 return null;
}

export function nodeState(level:Pick<MobileLevel,'id'|'status'>,current:Pick<MobileLevel,'id'>|null|undefined):'cleared'|'current'|'locked'{
 if(level.status==='cleared')return 'cleared';
 return level.status==='unlocked'&&level.id===current?.id?'current':'locked';
}
