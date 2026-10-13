const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
const TASKS=[['cooperation-10','伙伴初遇','有效合作拼合 10 次'],['cooperation-30','伙伴默契','有效合作拼合 30 次'],['cooperation-60','伙伴同心','有效合作拼合 60 次'],['friend-10','好友相伴','和好友有效拼合 10 次'],['friend-30','好友默契','和好友有效拼合 30 次']];
const number=(name,label,value,{min=0,max=10000}={})=>`<label class="field"><b>${esc(label)}</b><input name="${name}" type="number" min="${min}" max="${max}" step="1" required value="${esc(value)}" aria-label="${esc(label)}"></label>`;

export function renderTaskRewards({document,dirty=false,updatedAt='',conflict=false}={}){
 if(!document)return '<div class="empty">正在载入任务奖励…</div>';
 const share=document.invitationShare,friend=document.invitationFriend,ten=document.tenGrid;
 const tasks=new Map(document.tasks.map(task=>[task.id,task]));
 return `<form id="task-rewards-form" class="task-rewards-form"><div class="page-heading"><div><div class="eyebrow">游戏运营 · REWARDS</div><h1>任务奖励</h1><p>网页与小程序共用金币和经验奖励，体力只在小程序使用。保存后可在本地预览，确认提交到双端后用于正式奖励。</p></div><div class="actions"><button type="button" data-action="reload-task-rewards">重新载入奖励</button><button type="submit" class="primary" id="task-rewards-save" ${dirty?'':'disabled'}>保存任务奖励</button></div></div><div class="task-save-line"><span id="task-rewards-state" class="${dirty?'dirty':'saved'}">${dirty?'任务奖励有未保存修改':'任务奖励已保存'}</span>${updatedAt?`<small>上次保存 ${esc(updatedAt)}</small>`:''}</div><div class="notice task-rewards-note">已发出的礼包保留原奖励，已领取的任务不会重复发放。这里单独保存，不影响尚未保存的相册整理。</div>${conflict?'<p class="notice danger-note">其他窗口已更新奖励，当前输入已保留。重新载入最新奖励后再调整需要修改的数值。</p>':''}<div class="task-reward-sections"><section class="section task-daily-section"><div class="section-heading"><h2>合作与好友任务</h2><small>每天各领取一次，任务目标保持现有规则。</small></div><div class="task-reward-rows">${TASKS.map(([id,title,condition])=>{const reward=tasks.get(id);return `<div class="task-reward-row"><div><strong>${title}</strong><p class="muted text-small">${condition}</p></div>${number(id+'-energy',title+'体力',reward.energy)}${number(id+'-coins',title+'金币',reward.coins??0,{max:100000})}${number(id+'-xp',title+'经验',reward.xp)}</div>`;}).join('')}</div></section><section class="section"><h2>分享邀请</h2><p class="muted text-small">每次符合条件的分享直接发放奖励，达到当天次数上限后不再重复发放。</p><div class="task-number-grid">${number('share-energy','分享邀请体力',share.energy)}${number('share-coins','分享邀请金币',share.coins??0,{max:100000})}${number('share-xp','分享邀请经验',share.xp)}${number('share-daily-limit','每天奖励次数',share.dailyLimit,{min:1,max:20})}</div></section><section class="section"><h2>邀请好友加入</h2><p class="muted text-small">好友完成 3 次有效拼合后，赠送一份礼包，每天最多 3 份。打开礼包发放金币和经验，小程序同时补满当前等级的体力。</p><div class="task-number-grid"><div class="task-fixed-reward"><b>小程序体力奖励</b><span>补满当前体力</span><small>网页只发放下面设置的金币和经验。</small></div>${number('friend-coins','好友加入礼包金币',friend.coins??0,{max:100000})}${number('friend-xp','好友加入礼包经验',friend.xp)}</div></section><section class="section"><h2>十格小礼</h2><p class="muted text-small">每 10 次有效拼合存入一份小礼。金币和经验固定发放，小程序另按下列范围随机发放体力。</p><div class="task-number-grid">${number('ten-energy-min','最低体力',ten.energyMin,{min:1,max:1000})}${number('ten-coins','每份小礼金币',ten.coins??0,{max:100000})}${number('ten-xp','每份小礼经验',ten.xp)}</div><div class="task-tier-grid">${['0～19 级最高体力','20～49 级最高体力','50 级及以上最高体力'].map((label,index)=>number('ten-max-'+index,label,ten.energyMaxByTier[index],{min:1,max:1000})).join('')}</div><small>每档最高体力应不小于最低体力。</small></section></div></form>`;
}

export function readTaskRewardForm(form){
 const values=new FormData(form);
 const integer=name=>{const value=String(values.get(name)??'').trim();if(!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value)))throw new Error('奖励数值需要填写非负整数。');return Number(value);};
 return {schema:'jigsaw-task-rewards/v1',tasks:TASKS.map(([id])=>({id,energy:integer(id+'-energy'),coins:integer(id+'-coins'),xp:integer(id+'-xp')})),invitationShare:{energy:integer('share-energy'),coins:integer('share-coins'),xp:integer('share-xp'),dailyLimit:integer('share-daily-limit')},invitationFriend:{effect:'full-energy',coins:integer('friend-coins'),xp:integer('friend-xp')},tenGrid:{energyMin:integer('ten-energy-min'),energyMaxByTier:[0,1,2].map(index=>integer('ten-max-'+index)),coins:integer('ten-coins'),xp:integer('ten-xp')}};
}

export function updateTaskRewardInput(document,name,value){
 const numeric=value===''?'':Number(value),task=document.tasks.find(item=>['energy','coins','xp'].some(field=>name===item.id+'-'+field));
 if(task){task[name.slice(task.id.length+1)]=numeric;return;}
 const share={'share-energy':'energy','share-coins':'coins','share-xp':'xp','share-daily-limit':'dailyLimit'};
 if(share[name])document.invitationShare[share[name]]=numeric;
 else if(name==='friend-xp')document.invitationFriend.xp=numeric;
 else if(name==='friend-coins')document.invitationFriend.coins=numeric;
 else if(name==='ten-energy-min')document.tenGrid.energyMin=numeric;
 else if(name==='ten-xp')document.tenGrid.xp=numeric;
 else if(name==='ten-coins')document.tenGrid.coins=numeric;
 else if(/^ten-max-[012]$/.test(name))document.tenGrid.energyMaxByTier[Number(name.slice(-1))]=numeric;
}
