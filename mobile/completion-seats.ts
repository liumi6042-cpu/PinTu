export type CompletionMember={id:string;code?:string|null;name:string;contribution?:number;lastSeen?:number};
export type CompletionRank={code?:string|null;name:string;contribution:number;mine?:boolean};
export type CompletionSeat={playerId:string;code:string;name:string;contribution:number;present:boolean;me:boolean;crown:boolean;column:'left'|'right';row:number};

/** Snapshot order is join order. Ranking supplies counts, never presence. */
export function completionSeats(members:readonly CompletionMember[],ranking:readonly CompletionRank[]|null|undefined,playerId:string,code?:string|null):CompletionSeat[]{
 const seats:CompletionSeat[]=members.map(member=>({playerId:member.id,code:member.code??'',name:member.name,contribution:ranking?.find(rank=>!!member.code&&rank.code===member.code)?.contribution??member.contribution??0,present:(member.lastSeen??0)>0,me:member.id===playerId||!!code&&member.code===code,crown:false,column:'left',row:0}));
 // The server omits departed members from snapshots, but retains their completion rank.
 for(const rank of ranking??[])if(!members.some(member=>!!rank.code&&member.code===rank.code||rank.mine===true&&member.id===playerId||!rank.code&&member.name===rank.name))seats.push({playerId:'departed:'+(rank.code??rank.name),code:rank.code??'',name:rank.name,contribution:rank.contribution,present:false,me:rank.mine===true||!!code&&rank.code===code,crown:false,column:'left',row:0});
 if(seats.length<=1)return [];
 const top=Math.max(...seats.map(seat=>seat.contribution));
 if(top>0&&seats.filter(seat=>seat.contribution===top).length===1)seats.find(seat=>seat.contribution===top)!.crown=true;
 // Select the bounded table by presence/count first, then restore join order (me first).
 const selected=seats.length>8?[...seats].sort((a,b)=>Number(b.present)-Number(a.present)||b.contribution-a.contribution).slice(0,8):seats;
 return seats.filter(seat=>selected.includes(seat)).sort((a,b)=>Number(b.me)-Number(a.me)).map((seat,i)=>({...seat,column:i%2?'right':'left',row:Math.floor(i/2)}));
}
