# off-04 服务端离线通关交付（2026-10-27）

已完成任务卡，未提交。修改仅位于 `work/offline-play`。

## 实现与兼容边界

- 新增 `POST /api/levels/offline-clears`，响应为 `{results, energy, levels, profile}`，已用真实 `syncOfflineClears` 调用验证。
- 新增 `offlineLevelClears` 能力键；开关沿用 soloLocalPlay 的 option/env 模式，web 恒为 false。关闭时返回 503（含已有请求回执的重试）。现有能力键及其值、旧路由实现和响应结构未改。
- 有效通关按配置中的章节/关卡顺序处理，每条重新读取进度；支持局部拒绝、延后、去重、跨章解锁、请求持久回放和冲突检查。只记录首通进度和体力，不更新 lastReward、XP、金币、任务、收藏或房间结算。
- 使用既有事务、进度表与事件模块；事件 room_id 可为 null。无数据库迁移，无新增服务端文件，无需扩展生产升级脚本路径白名单。
- 清单中的 13 个现存共享核心文件 hash 与 HEAD 一致；第 14 个 `lib/managed-decoration-art.ts` 在工作树和 HEAD 中均不存在，未创建。

## 准确修改位置

`server/mobile-service.mjs`：

- 第 77 行：新增开关常量。
- 第 82 行：仅在现有能力对象中追加 `offlineLevelClears` 键，其余内容原样保留。
- 第 348–380 行：新增路由，共 33 行，紧邻原 GET /api/levels。
- Git 计数：35 additions / 1 deletion；其中能力对象原行被替换，净增加 34 行。完整精确 diff 附后。

其他文件：

- `mobile/client.ts`：第 10 行增加可选能力类型，第 75 行按 soloLocalPlay 规则解析新能力。
- `tests/mobile-offline-clears.test.mjs`：新增 16 项测试，含旧能力对象值断言、真实在线通关/重玩、重启回放、输入边界、回滚和客户端同步集成。
- `package.json`：只把新测试加入 test:mobile 第一阶段。
- 本交付记录。

## 验证

- `npm.cmd run test:mobile`：194/194 pass = 59 + 118 + 17；对比基线 178 新增 16；0 fail / 0 skipped。
- `node --import ./tests/ts-register.mjs --test tests/mobile-levels.test.mjs tests/mobile-level-rooms.test.mjs tests/mobile-level-completion.test.mjs`：37/37 pass；这些既有测试文件未修改。
- `node --check server/mobile-service.mjs`：退出码 0。
- `npx.cmd tsc --noEmit -p .`：退出码 1，仅既有 `vite.config.ts(5,27)` TS2307，找不到 `./.openai/hosting.json`；无新增错误。
- `npm.cmd run check:images`：通过，82 张已发布图片、813 个旧哈希衍生图。
- `git diff --check`：通过。

## 任务卡差异

无功能或协议偏离。额外保存本记录；测试覆盖补充了真实客户端同步、重启、账户隔离、事务回滚和 20 条批次上界。未新增服务端模块，未改 mobile-levels.mjs，未改任何旧测试或共享核心文件，未提交或部署。

## server/mobile-service.mjs 精确 diff

```diff
diff --git a/server/mobile-service.mjs b/server/mobile-service.mjs
index 96a8751..7e06932 100644
--- a/server/mobile-service.mjs
+++ b/server/mobile-service.mjs
@@ -74,11 +74,12 @@ export function createMobileService(options={}){
  // The host chooses this profile. No request body/header may disable stamina.
  const web=options.runtimeProfile==='web',guestNames=options.guestNames??true,energyEnabled=!web,shareRewards=options.shareRewards??!web,adsEnabled=!web&&options.adEnabled===true;
  const soloLocalPlay=!web&&(options.soloLocalPlay??process.env.MOBILE_SOLO_LOCAL_PLAY!=='false')===true;
+ const offlineLevelClears=!web&&(options.offlineLevelClears??process.env.MOBILE_OFFLINE_LEVEL_CLEARS!=='false')===true;
  // Only a trusted host option can re-enable free text. Local/development hosts
  // use the same safe mobile default as a public-test package.
  const customNames=options.publicTestPolicy?.customNames??web,privateMessages=options.publicTestPolicy?.privateMessages??web;
  if(typeof customNames!=='boolean'||typeof privateMessages!=='boolean')throw new TypeError('publicTestPolicy values must be booleans');
- const capabilities=Object.freeze({energy:energyEnabled,ads:adsEnabled,shareRewards:!web&&shareRewards,tapMultiplayer:tapMultiplayerEnabled,soloLocalPlay,albumTarget:web?'pc':options.albumTarget??'mobile-shared',createTickets:!web,customNames,cheers:true,privacyRequests:true,roomActionRevisionBody:!web,social:Object.freeze({friends:true,privateMessages,privateMessageHistory:true,roomInvites:true,reports:true,blocking:true,search:true,presence:true,codeFormat:'digits9'})});
+ const capabilities=Object.freeze({energy:energyEnabled,ads:adsEnabled,shareRewards:!web&&shareRewards,tapMultiplayer:tapMultiplayerEnabled,soloLocalPlay,offlineLevelClears,albumTarget:web?'pc':options.albumTarget??'mobile-shared',createTickets:!web,customNames,cheers:true,privacyRequests:true,roomActionRevisionBody:!web,social:Object.freeze({friends:true,privateMessages,privateMessageHistory:true,roomInvites:true,reports:true,blocking:true,search:true,presence:true,codeFormat:'digits9'})});
  const managedContent=options.managedContent??(options.contentDirectory?createMobileManagedContent({directory:options.contentDirectory,photos:engine.RESTORABLE_PHOTOS,assetDir:options.assetDir}):null);
  let operationRelease=managedContent?.read()??null,requestRelease;
  const taskRewardConfiguration=options.taskRewardSettings??createTaskRewardSettings({configurationPath:options.taskRewardConfigurationPath});
@@ -344,6 +345,39 @@ export function createMobileService(options={}){
   if(path==='/api/daily'&&method==='GET'){const photo=displayPhoto(dailyContent?.select(now)??engine.dailyPuzzle(now),request);return {date:engine.dailyPuzzleDate(now),photo:{id:photo.id,title:photo.title,src:photo.src,thumbSrc:photo.thumbSrc,width:photo.width,height:photo.height},serverTime:now};}
   if(path==='/api/mobile/gallery'&&method==='GET'){const photos=galleryPhotos(now);return {imageIds:photos.map(photo=>photo.id),freeImageIds:collection.freeImageIds(now),packedImageIds:collection.packedImageIds(now),...(request.artworkSnapshot===true?{photos:photos.map(photo=>displayPhoto(photo,request)),daily:displayPhoto(dailyContent?.select(now)??engine.dailyPuzzle(now),request)}:{}),serverTime:now};}
   if(path==='/api/levels'&&method==='GET')return levels.view(p.id,now);
+  if(path==='/api/levels/offline-clears'&&method==='POST'){
+   if(!offlineLevelClears)fail(503,'OFFLINE_CLEARS_UNAVAILABLE','离线通关同步暂不可用');
+   return replay(p,'level-offline-clears',input,now,()=>{
+    if(!Array.isArray(input.clears)||input.clears.length<1||input.clears.length>20)fail(400,'INVALID_OFFLINE_CLEARS','离线通关数据无效');
+    const ordered=levelConfiguration.chapters.flatMap(chapter=>chapter.pieces.map((_,index)=>chapter.id+'-'+(index+1))),order=new Map(ordered.map((id,index)=>[id,index]));
+    const clearIds=new Set(),levelIds=new Set(),entries=[],results=[];let totalEnergy=0;
+    for(const entry of input.clears){
+     const clearId=typeof entry?.clearId==='string'?entry.clearId:null,levelId=typeof entry?.levelId==='string'?entry.levelId:null;
+     if(clearId!==null&&clearIds.has(clearId)||levelId!==null&&levelIds.has(levelId))continue;
+     if(clearId!==null)clearIds.add(clearId);if(levelId!==null)levelIds.add(levelId);
+     if(!entry||typeof entry!=='object'||Array.isArray(entry)||!requestKey(clearId)||levelId===null||levelId.length>100||!Number.isSafeInteger(entry.completedAt)||!Number.isSafeInteger(entry.elapsedMs)||entry.elapsedMs<0||!Number.isSafeInteger(entry.pieces)||entry.pieces<=0){results.push({clearId,levelId,status:'rejected',energy:0,code:'INVALID'});continue;}
+     entries.push(entry);
+    }
+    entries.sort((a,b)=>(order.get(a.levelId)??Infinity)-(order.get(b.levelId)??Infinity));
+    for(const {clearId,levelId,completedAt,elapsedMs,pieces}of entries){
+     const level=levels.view(p.id,now).chapters.flatMap(chapter=>chapter.levels).find(level=>level.id===levelId);
+     let status='rejected',energy=0,code;
+     if(!level)code='INVALID_LEVEL';
+     else if(pieces!==level.pieces)code='PIECES_MISMATCH';
+     else if(elapsedMs<pieces*200)code='TOO_FAST';
+     else if(level.status==='cleared')status='duplicate';
+     else if(level.status==='locked'||level.status==='unavailable')status='deferred';
+     else{
+      const configuredEnergy=energyEnabled?levelConfiguration.firstClearEnergy:0;
+      const firstClear=levels.recordClear(p.id,levelId,'offline:'+clearId,Math.min(Math.max(completedAt,0),now),configuredEnergy);
+      status=firstClear?'accepted':'duplicate';energy=firstClear?configuredEnergy:0;p.energy+=energy;
+      events.record(p.id,'level-clear',null,{levelId,firstClear,energy,offline:true,clearId,elapsedMs},now);
+     }
+     totalEnergy+=energy;results.push({clearId,levelId,status,energy,...(code?{code}:{})});
+    }
+    saveProfile(p);return {results,energy:totalEnergy,levels:levels.view(p.id,now),profile:profileView(p,now)};
+   });
+  }
   if(path==='/api/mobile/profile'){
    if(method==='PATCH'){
     if(input.name!==undefined&&!customNames)fail(403,'CUSTOM_NAMES_UNAVAILABLE','公开测试暂不开放自定义昵称');
```
