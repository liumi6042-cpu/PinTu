import type {MobileChapter} from '../h5/mobile-api';
import ch1 from './story-comics-ch1.json';
import ch2 from './story-comics-ch2.json';
import ch3 from './story-comics-ch3.json';
import ch4 from './story-comics-ch4.json';

const stories=new Map([['ch1',ch1],['ch2',ch2],['ch3',ch3],['ch4',ch4]]);
/** Chapter IDs take precedence; album matching also supports renamed chapter IDs. */
export function bundledStory(chapter:Pick<MobileChapter,'id'|'albumId'>){
 return stories.get(chapter.id)??[...stories.values()].find(story=>story.chapter===chapter.albumId);
}
