const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);

export function ensureAlbumRewardIds(album){
 album.milestones ||= [];
 for(const row of album.milestones)row.id ||= `milestone-${row.target}`;
 return album;
}

export function addAlbumReward(album){
 ensureAlbumRewardIds(album);
 if(album.milestones.length>=100)return false;
 const target=Math.max(0,...album.milestones.map(row=>Number(row.target)||0))+1;
 album.milestones.push({id:`milestone-${globalThis.crypto.randomUUID()}`,target,coins:0,decorationId:null});
 return true;
}

export function renderAlbumRewards(album,decorations=[]){
 const options=selected=>`<option value="">不赠送装饰</option>${decorations.map(item=>`<option value="${esc(item.id)}" ${selected===item.id?'selected':''}>${esc(item.title)}</option>`).join('')}`;
 const rows=album.milestones.map((row,index)=>`<div class="album-reward-row"><label class="field"><b>集齐图片张数</b><input type="number" min="1" max="10000" step="1" required value="${esc(row.target)}" data-settings-row="${index}" data-settings-key="target" aria-label="第 ${index+1} 档集齐图片张数"></label><label class="field"><b>奖励金币</b><input type="number" min="0" max="100000" step="1" required value="${esc(row.coins)}" data-settings-row="${index}" data-settings-key="coins" aria-label="第 ${index+1} 档奖励金币"></label><label class="field album-reward-decoration"><b>赠送装饰</b><select data-settings-row="${index}" data-settings-key="decorationId" aria-label="第 ${index+1} 档赠送装饰">${options(row.decorationId)}</select></label><button type="button" class="small danger" data-action="settings-remove-milestone" data-row="${index}" aria-label="删除第 ${index+1} 档奖励">删除</button></div>`).join('');
 return `<section class="album-rewards"><div class="section-heading"><h3>相册集齐奖励</h3><button type="button" class="small" data-action="settings-add-milestone" ${album.milestones.length>=100?'disabled':''}>增加一档奖励</button></div><p class="muted text-small">玩家在本相册集齐指定张数后获得金币和所选装饰。每档只发一次；修改同一档不会让已领取的玩家重复领奖。</p>${rows||'<p class="muted text-small">暂未设置奖励，点击“增加一档奖励”即可添加。</p>'}<p class="muted text-small">当前相册 ${album.imageIds.length} 张。门槛超过相册张数时，需继续添加图片才能达成。装饰的名称、外观和合成费用在“装饰与收集”中设置。</p></section>`;
}
