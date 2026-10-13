const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
const ART_OPTIONS=[['star','星光'],['bow','蝴蝶结'],['butterfly','蝴蝶'],['feather','羽毛'],['moon','月牙'],['lantern','灯笼'],['leaf','叶子']];
const SOURCE_LABELS={default:'默认赠送',craft:'碎片合成',album:'相册奖励'};
const number=(name,label,value,{min=0,max=100000,step=1,hint='',disabled=false}={})=>`<label class="field"><b>${esc(label)}</b><input name="${esc(name)}" type="number" min="${min}" max="${max}" step="${step}" required ${disabled?'disabled':''} value="${esc(value)}" aria-label="${esc(label)}">${hint?`<small>${esc(hint)}</small>`:''}</label>`;
const text=(name,label,value,{multiline=false,max=120,required=true}={})=>`<label class="field"><b>${esc(label)}</b>${multiline?`<textarea name="${esc(name)}" maxlength="${max}" ${required?'required':''} aria-label="${esc(label)}">${esc(value)}</textarea>`:`<input name="${esc(name)}" maxlength="${max}" ${required?'required':''} value="${esc(value)}" aria-label="${esc(label)}">`}</label>`;
const toggle=(name,label,value,hint='')=>`<label class="game-switch"><span><b>${esc(label)}</b>${hint?`<small>${esc(hint)}</small>`:''}</span><input type="checkbox" name="${esc(name)}" aria-label="${esc(label)}" ${value?'checked':''}></label>`;
const card=(title,description,content,classes='')=>`<section class="game-settings-card ${classes}"><div class="section-heading"><div><h2>${esc(title)}</h2>${description?`<p class="muted text-small">${esc(description)}</p>`:''}</div></div>${content}</section>`;

export function renderGameLevelPreview(document){
 const {progression,energy}=document;
 let total=0;
 const finite=value=>Number.isFinite(Number(value))&&String(value)!==''?Number(value):null;
 const rows=Array.from({length:20},(_,index)=>{
  const level=index+1,early=finite(progression.earlyXp[9]),step=finite(progression.laterXpStep),maximum=finite(progression.laterXpMaximum);
  const required=level<=10?finite(progression.earlyXp[index]):[early,step,maximum].includes(null)?null:Math.min(maximum,early+step*(level-10));
  total=total===null||required===null?null:total+required;
  const base=finite(energy.baseCap),increment=finite(energy.capPerLevel),capMaximum=finite(energy.maximumCap);
  const cap=[base,increment,capMaximum].includes(null)?null:Math.min(capMaximum,base+increment*level);
  return `<tr><td>${level} 级</td><td>${required??'—'}</td><td>${total??'—'}</td><td>${cap??'—'}</td></tr>`;
 }).join('');
 return `<div class="table-wrap game-level-table"><table><caption class="sr-only">前 20 级升级经验和体力上限预览</caption><thead><tr><th>升到等级</th><th>本级所需经验</th><th>从新号累计经验</th><th>体力上限</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

export function renderGameDecorationPreview(item){
 const color=/^#[a-f\d]{6}$/i.test(item.color??'')?item.color:'#8aab89';
 const shapes={
  star:'<path d="m32 5 8 17 19 3-14 14 3 19-16-9-16 9 3-19L5 25l19-3z"/>',
  bow:'<path d="M29 26C12 10 5 15 8 32c-3 17 5 22 21 7v-13Zm6 0c17-16 24-11 21 6 3 17-5 22-21 7V26Z"/><rect x="25" y="23" width="14" height="19" rx="5"/><path d="m28 39-8 19 12-5 5 5-2-19"/>',
  butterfly:'<path d="M30 29C14 8 4 13 8 29c-10 15 4 31 21 13l3-9 3 9c17 18 31 2 21-13C60 13 50 8 34 29Z"/><path d="m29 17 3 9 3-9M32 24v24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>',
  feather:'<path d="M51 7C33 3 15 21 17 42l6 5C44 49 62 25 51 7Z"/><path d="m13 56 34-36M24 42l-4-10M30 35l12 1M37 27l-3-10" fill="none" stroke="#fffefa" stroke-width="2.4" stroke-linecap="round"/>',
  moon:'<path d="M42 7A25 25 0 1 0 56 44 25 25 0 0 1 42 7Z"/>',
  lantern:'<path d="M24 9h16v5H24zM23 47h18v6H23z"/><rect x="12" y="15" width="40" height="32" rx="15"/><path d="M26 17v27M38 17v27M32 53v7" fill="none" stroke="#fffefa" stroke-width="2.3"/><path d="m28 60 4-3 4 3" fill="none" stroke="currentColor" stroke-width="2.3"/>',
  leaf:'<path d="M52 7C27 5 10 18 12 35c1 16 17 24 31 12C55 36 50 18 52 7Z"/><path d="m10 56 34-35M24 42l-4-11M30 35l13 1" fill="none" stroke="#fffefa" stroke-width="2.3" stroke-linecap="round"/>'
 };
 return `<svg viewBox="0 0 64 64" role="img" aria-label="${esc(item.title)}图案预览" fill="${color}" style="color:${color}">${shapes[item.artKey]??shapes.star}</svg>`;
}

function growth(document){
 const p=document.progression,e=document.energy;
 return `<div class="game-settings-grid">${card('升级所需经验','从 0 级开始。每次升级扣除本级所需经验，剩余经验继续计入下一等级。',`<div class="game-early-grid">${p.earlyXp.map((xp,index)=>number('progression.earlyXp.'+index,'升到 '+(index+1)+' 级',xp,{min:1,max:1000000})).join('')}</div><div class="game-number-grid game-space-top">${number('progression.laterXpStep','11 级起，每级增加经验',p.laterXpStep,{max:1000000,hint:'以升到 10 级的经验为基准，每升一级增加此数值。'})}${number('progression.laterXpMaximum','每级所需经验的最高值',p.laterXpMaximum,{min:p.earlyXp[9],max:1000000,hint:'后续每级所需经验达到此值后，不再增加。'})}</div>`,'game-span-all')}${card('新号与体力上限','体力上限 = 基础上限 + 等级 × 每级增加体力，最多达到最高上限。',`<div class="game-number-grid">${number('energy.initial','新号初始体力',e.initial,{max:e.baseCap})}${number('energy.baseCap','0 级基础体力上限',e.baseCap,{min:1})}${number('energy.capPerLevel','每级增加体力上限',e.capPerLevel)}${number('energy.maximumCap','最高体力上限',e.maximumCap,{min:e.baseCap})}</div>${toggle('energy.firstRoomFree','新手首局拼合免体力',e.firstRoomFree,'开启后，新号第一局的有效拼合不扣体力。')}`)}${card('拼合与自然恢复','有效拼合才扣体力、增加经验。自然恢复只补到当前等级的体力上限。',`<div class="game-number-grid">${number('energy.contributionCost','每次拼合消耗体力',e.contributionCost,{hint:'填 0 表示拼合不消耗体力。'})}${number('energy.contributionXp','每次拼合获得经验',e.contributionXp)}${number('energy.naturalRecoveryMinutes','每恢复 1 点体力的分钟数',e.naturalRecoveryMinutes,{max:10080,step:0.01,hint:'填 0 关闭自然恢复。'})}</div>`)}${card('升级时补充体力','一次获得大量经验可能连续升级，每次升级都按此规则处理。',`<div class="game-number-grid"><label class="field"><b>升级补体力方式</b><select name="energy.upgradeRefill" aria-label="升级补体力方式">${[['full','补满当前等级体力'],['fixed','每级增加固定体力'],['none','升级不补体力']].map(([value,label])=>`<option value="${value}" ${e.upgradeRefill===value?'selected':''}>${label}</option>`).join('')}</select><small>补满不会减少已超过上限的奖励体力。</small></label>${number('energy.upgradeEnergy','每级增加的固定体力',e.upgradeEnergy,{disabled:e.upgradeRefill!=='fixed',hint:'仅“每级增加固定体力”时使用。'})}</div>`)}${card('整局完成的体力奖励','填 0 关闭；多人按贡献分配，开启时每人至少获得 1 点体力。',`<div class="game-number-grid">${[48,108,300,500].map(count=>number('energy.completionPools.'+count,count+' 片整局奖励总量',e.completionPools[count])).join('')}</div>`)}${card('前 20 级预览','输入数值时自动更新，可直接查看经验增长与体力上限。',`<div id="game-level-preview">${renderGameLevelPreview(document)}</div>`,'game-span-all')}</div>`;
}

function decorations(document){
 const c=document.collection;
 const cards=document.decorations.map((item,index)=>{
  const prefix='decorations.'+index+'.';
  return `<section class="game-settings-card game-decoration-card"><div class="game-decoration-heading"><div class="game-decoration-preview" data-decoration-preview="${index}">${renderGameDecorationPreview(item)}</div><div><h2>${esc(item.title)}</h2><span class="chip">${esc(SOURCE_LABELS[item.source]??'装饰')}</span></div></div><div class="game-number-grid">${text(prefix+'title','装饰名称',item.title,{max:40})}<label class="field"><b>装饰图案</b><select name="${prefix}artKey" aria-label="${esc(item.title)}装饰图案">${ART_OPTIONS.map(([key,label])=>`<option value="${key}" ${item.artKey===key?'selected':''}>${label}</option>`).join('')}</select></label><label class="field"><b>装饰颜色</b><input name="${prefix}color" type="color" value="${esc(item.color)}" aria-label="${esc(item.title)}装饰颜色"></label>${item.source==='craft'?number(prefix+'cost','合成所需碎片',item.cost):`<div class="field game-fixed-field"><b>获得方式</b><span>${item.source==='album'?'相册收集奖励':'默认赠送'}</span><small>${item.source==='album'?'在对应相册的设置中选择赠送装饰和集齐张数。':'默认装饰无需合成。'}</small></div>`}</div><div class="game-space-top">${text(prefix+'description','装饰说明',item.description,{multiline:true,max:300,required:false})}</div>${toggle(prefix+'enabled','在装饰商店显示',item.enabled,'关闭后停止新合成，已获得装饰继续可用；图鉴奖励照常发放。')}</section>`;
 }).join('');
 return `<div class="game-settings-grid">${card('金币获取','拼合金币与完图金币分别发放。金币可用于已有的图包购买。',`<div class="game-number-grid">${number('collection.contributionCoins','每次有效拼合获得金币',c.contributionCoins)}${number('collection.completionCoinRatio','完图金币与个人贡献的比例',c.completionCoinRatio,{max:1000,step:0.01,hint:'个人贡献次数 × 此比例，向上取整。填 0 关闭完图金币。'})}</div>`)}${card('碎片与图鉴收录','碎片用于合成装饰；图鉴收录要求玩家在该局完成足够的有效拼合。',`<div class="game-number-grid">${number('collection.fragmentContributionStep','完图时每多少次贡献兑换 1 碎片',c.fragmentContributionStep,{min:1})}${number('collection.completionFragmentMinimum','每局最低碎片奖励',c.completionFragmentMinimum)}${number('collection.completionFragmentMaximum','每局最高碎片奖励',c.completionFragmentMaximum,{hint:'填 0 可关闭完图碎片，最低值也需设为 0。'})}${number('collection.catalogMinimumContributions','收录图鉴的最低贡献次数',c.catalogMinimumContributions,{min:1})}</div>`)}<div class="game-section-title game-span-all"><h2>装饰管理</h2><p class="muted text-small">调整现有装饰的名称、图案、颜色、说明与合成费用。每个相册赠送哪件装饰，在该相册的设置中选择。</p></div>${cards}</div>`;
}

export function renderGameSettings({document,dirty=false,conflict=false,updatedAt='',section='growth'}={}){
 if(!document)return '<div class="empty">正在载入游戏设置…</div>';
 const isDecorations=section==='decorations',title=isDecorations?'装饰与收集':'成长与体力';
 return `<form id="game-settings-form" class="game-settings-form" data-section="${isDecorations?'decorations':'growth'}"><div class="page-heading"><div><div class="eyebrow">游戏运营</div><h1>${title}</h1><p>${isDecorations?'管理金币、碎片和现有装饰；赠送规则在相册设置中管理。':'调整升级经验、体力消耗、自然恢复与完图奖励。'}</p></div><div class="actions"><button type="button" data-action="reload-game-settings">重新载入游戏设置</button><button type="submit" class="primary" id="game-settings-save" ${dirty?'':'disabled'}>保存游戏设置</button></div></div><div class="game-save-line"><span id="game-settings-state" class="${dirty?'dirty':'saved'}">${dirty?'游戏设置有未保存修改':'游戏设置已保存'}</span>${updatedAt?`<small>上次保存 ${esc(updatedAt)}</small>`:''}</div><div class="notice">“成长与体力”和“装饰与收集”共用一次保存，会一起保存这两个页面的修改。相册和任务奖励各自单独保存。</div>${conflict?'<p class="notice danger-note">其他窗口已更新游戏设置，当前输入已保留。重新载入最新设置后再调整需要修改的数值。</p>':''}${isDecorations?decorations(document):growth(document)}</form>`;
}

const ROOTS_BY_SECTION={growth:new Set(['progression','energy']),decorations:new Set(['collection','decorations'])};
const NUMBER_PATH=/^(?:progression\.(?:earlyXp\.[0-9]|laterXpStep|laterXpMaximum)|energy\.(?:initial|baseCap|capPerLevel|maximumCap|contributionCost|contributionXp|naturalRecoveryMinutes|upgradeEnergy|completionPools\.(?:48|108|300|500))|collection\.(?:contributionCoins|completionCoinRatio|fragmentContributionStep|completionFragmentMinimum|completionFragmentMaximum|catalogMinimumContributions)|milestones\.\d+\.(?:target|coins)|decorations\.\d+\.cost)$/;
const BOOLEAN_PATH=/^(?:energy\.firstRoomFree|milestones\.\d+\.albumDecoration|decorations\.\d+\.enabled)$/;
const STRING_PATH=/^(?:energy\.upgradeRefill|decorations\.\d+\.(?:title|description|artKey|color))$/;

function allowedPath(name){return NUMBER_PATH.test(name)||BOOLEAN_PATH.test(name)||STRING_PATH.test(name);}
function setValue(document,name,value){
 const path=name.split('.');let object=document;
 for(const key of path.slice(0,-1)){if(!object||!Object.hasOwn(object,key))return false;object=object[key];}
 if(!object||(!Object.hasOwn(object,path.at(-1))&&!BOOLEAN_PATH.test(name)))return false;
 object[path.at(-1)]=value;return true;
}

export function updateGameSettingInput(document,name,value,type=''){
 if(!allowedPath(name))return false;
 let parsed=value;
 if(BOOLEAN_PATH.test(name))parsed=type==='checkbox'||typeof value==='boolean'?Boolean(value):value==='true'||value==='on';
 else if(NUMBER_PATH.test(name))parsed=String(value).trim()===''?'':Number(value);
 else parsed=String(value);
 return setValue(document,name,parsed);
}

export function readGameSettingsForm(form,document){
 const copy=structuredClone(document),section=form.dataset.section==='decorations'?'decorations':'growth',roots=ROOTS_BY_SECTION[section];
 for(const element of form.elements){
  const {name}=element;if(!name||element.disabled||!allowedPath(name)||!roots.has(name.split('.')[0]))continue;
  const value=element.type==='checkbox'?element.checked:element.value;
  if(NUMBER_PATH.test(name)){
   const decimal=['collection.completionCoinRatio','energy.naturalRecoveryMinutes'].includes(name),raw=String(value).trim(),numeric=Number(raw);
   if(raw===''||!Number.isFinite(numeric)||numeric<0||(!decimal&&!Number.isSafeInteger(numeric)))throw new Error(decimal?'比例和恢复时间需要填写非负数。':'游戏数值需要填写非负整数。');
  }
  updateGameSettingInput(copy,name,value,element.type);
 }
 return copy;
}

export function addGameMilestone(document){
 if(document.milestones.length>=20)return false;
 const target=Math.max(0,...document.milestones.map(item=>Number(item.target)||0))+1;
 const id='milestone-'+globalThis.crypto.randomUUID();
 document.milestones.push({id,target,coins:0,albumDecoration:false});
 return document.milestones.length-1;
}

export function removeGameMilestone(document,index){
 if(!Number.isInteger(index)||index<0||index>=document.milestones.length)return false;
 document.milestones.splice(index,1);return true;
}
