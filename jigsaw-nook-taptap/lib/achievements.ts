export const ACHIEVEMENTS = [
  // The first rung of every ladder is close to the first completion on purpose: a
  // player who has just finished one picture should meet another badge soon after,
  // not five pictures later. Observed before this change: 50 players earned
  // 「第一幅风景」 and only 6 reached 「小小收藏家」.
  {id:'first',name:'第一幅风景',description:'完成第一张拼图',icon:'puzzle',group:'收藏',goal:1,metric:'pictures'},
  {id:'collection-2',name:'再来一幅',description:'完成 2 张不同图片',icon:'book',group:'收藏',goal:2,metric:'pictures'},
  {id:'collection-3',name:'渐入佳境',description:'完成 3 张不同图片',icon:'book',group:'收藏',goal:3,metric:'pictures'},
  {id:'collection-5',name:'小小收藏家',description:'完成 5 张不同图片',icon:'book',group:'收藏',goal:5,metric:'pictures'},
  {id:'collection-10',name:'满页好时光',description:'完成 10 张不同图片',icon:'book',group:'收藏',goal:10,metric:'pictures'},
  {id:'challenge-500',name:'从容五百片',description:'单人完成一局至少 500 片拼图',icon:'mountain',group:'挑战',goal:500,metric:'soloPieces'},
  {id:'challenge-1000',name:'千片耐心',description:'单人完成一局至少 1000 片拼图',icon:'mountain',group:'挑战',goal:1000,metric:'soloPieces'},
  {id:'challenge-2000',name:'两千片星光',description:'单人完成一局至少 2000 片拼图',icon:'sparkles',group:'挑战',goal:2000,metric:'soloPieces'},
  {id:'nature-5',name:'自然漫游',description:'完成 5 张不同的风景图片',icon:'leaf',group:'收藏',goal:5,metric:'nature'},
  {id:'team-first',name:'一起完成',description:'有有效拼接贡献，与另一位有贡献的玩家共同完成',icon:'hands',group:'同行',goal:1,metric:'teamPictures'},
  {id:'team-2',name:'结伴再拼',description:'有有效拼接贡献，与另一位有贡献的玩家共同完成 2 张不同图片',icon:'hands',group:'同行',goal:2,metric:'teamPictures'},
  {id:'team-3',name:'常拼常新',description:'有有效拼接贡献，共同完成 3 张不同图片',icon:'hands',group:'同行',goal:3,metric:'teamPictures'},
  {id:'team-5',name:'默契伙伴',description:'有有效贡献，共同完成 5 张不同图片',icon:'hands',group:'同行',goal:5,metric:'teamPictures'},
  // 「常来坐坐」 stays at seven days as the long-term goal, but it had been the only
  // badge in this group and nobody had reached it, so the group gave no feedback at
  // all. The two lower rungs make it a ladder rather than a cliff.
  {id:'days-2',name:'第二天见',description:'在 2 个不同日期完成有效拼接，无需连续签到',icon:'sun',group:'日常',goal:2,metric:'days'},
  {id:'days-3',name:'三天小约',description:'在 3 个不同日期完成有效拼接，无需连续签到',icon:'sun',group:'日常',goal:3,metric:'days'},
  {id:'days-7',name:'常来坐坐',description:'在 7 个不同日期完成有效拼接，无需连续签到',icon:'sun',group:'日常',goal:7,metric:'days'},
] as const;
export type AchievementId=typeof ACHIEVEMENTS[number]['id'];
export type AchievementFact={partners?:string[];key:string;imageId:string;pieces:number;mode:'solo'|'team'|'shared';completedAt:number;category:string};
export type AchievementBook={facts:AchievementFact[];days:string[];earned:Partial<Record<AchievementId,number>>;equipped:AchievementId|null};
export const emptyBook=():AchievementBook=>({facts:[],days:[],earned:{},equipped:null});
export const achievementById=(id:unknown)=>ACHIEVEMENTS.find(b=>b.id===id);
// The server and local play both use the same calendar, independent of device timezone.
export function achievementDay(now:number){return new Date(now+8*3600000).toISOString().slice(0,10);}
export function achievementProgress(book:Pick<AchievementBook,'facts'|'days'>){return {
  pictures:new Set(book.facts.map(f=>f.imageId)).size,
  nature:new Set(book.facts.filter(f=>f.category==='风景').map(f=>f.imageId)).size,
  teamPictures:new Set(book.facts.filter(f=>f.mode==='team').map(f=>f.imageId)).size,
  soloPieces:Math.max(0,...book.facts.filter(f=>f.mode==='solo').map(f=>f.pieces)),
  days:new Set(book.days).size,
};}
export function awardAchievements(book:AchievementBook,now:number){
  const progress=achievementProgress(book),added:AchievementId[]=[];
  for(const badge of ACHIEVEMENTS)if(progress[badge.metric]>=badge.goal&&!book.earned[badge.id]){book.earned[badge.id]=now;added.push(badge.id);}
  return added;
}
