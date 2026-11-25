const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const time = value => value ? new Date(value).toLocaleString('zh-CN', {hour12:false,timeZone:'Asia/Shanghai'}) : '尚未提交';
const mb = bytes => (Number(bytes || 0) / 1048576).toFixed(1);

export function renderReleaseTargets(receipt) {
  const rolledBack = receipt?.rollback?.attempted === true;
  const targets = rolledBack ? receipt.rollback.targets ?? [] : Array.isArray(receipt) ? receipt : receipt?.targets ?? [];
  return `<div class="release-targets">${[['web','Web 网页','共用相册、任务与奖励，不使用体力'],['mobile','小程序','共用内容，保留体力奖励']].map(([id,name,description])=>{
    const target = targets.find(item => item.id === id);
    const preflight = receipt?.phase === 'preflight';
    const label = rolledBack ? target?.ok ? '已恢复原版本' : '恢复待确认' : target ? preflight ? target.ok ? '预检通过，尚未发布' : '预检未通过' : target.ok && target.contentReleaseId ? '已确认生效' : '未确认生效' : '等待本次提交';
    return `<div class="release-target ${target?.ok && !preflight && !rolledBack ? 'is-ready' : ''}"><strong>${name}</strong><span>${label}</span><small>${description}</small></div>`;
  }).join('')}</div>`;
}

function pendingAssets(assets) {
  if (!assets || assets.reachable !== true) return 0;
  return (assets.missing?.length ?? 0) + (assets.catalogChanged || assets.guidanceChanged ? 1 : 0);
}

export function renderReleaseAssets(assets) {
  if (!assets) return '';
  if (assets.reachable !== true) {
    return `<div class="release-assets is-blocked"><strong>图片上传暂不可用</strong><span>${esc(assets.reason || '无法连接正式服')}。本次只能提交运营设置，新图片不会上传。</span></div>`;
  }
  const missing = assets.missing?.length ?? 0;
  const changed = assets.catalogChanged || assets.guidanceChanged;
  if (!missing && !changed) {
    return `<div class="release-assets is-ready"><strong>图片资源已就绪</strong><span>${esc(assets.totalFiles)} 个图片文件与服务器一致，无需重复上传。</span></div>`;
  }
  const detail = missing ? `${missing} 个图片文件未上传（约 ${mb(assets.missingBytes)} MB）` : '图库索引或尺寸记录有更新';
  return `<div class="release-assets"><strong>需要上传图片</strong><span>${esc(detail)}。上传后 Web 与小程序才认识这些图片；确认提交时会自动先上传。</span><button type="button" data-release="upload-assets">立即上传</button></div>`;
}

/**
 * Pictures that arrived with another tool's encoder settings are re-encoded
 * during preparation; the panel says so, because it changes the image files.
 */
function renderHealing(healing) {
  if (!healing || !healing.healed?.length) return '';
  const rows = healing.healed.slice(0, 8).map(item => `<li>${esc(item.id)} — ${esc((item.problems || []).join('、'))}</li>`).join('');
  const more = healing.healed.length > 8 ? `<li>…另有 ${healing.healed.length - 8} 张</li>` : '';
  return `<div class="release-assets"><strong>已自动压缩 ${esc(healing.healed.length)} 张图片</strong><span>这些图片原来是别的编码参数，提交前统一成 Q70；总像素不超过 6,553,600 的图片保留原尺寸，超出后按比例缩小。原图保留。</span><ul class="release-healed">${rows}${more}</ul></div>`;
}

export function renderReleasePreview(prepared, status, assets) {
  const summary = prepared.summary ?? {};
  const ready = pendingAssets(assets) === 0;
  return `<p class="release-intro">本次发布全部已保存的运营设置，包括其他页面之前保存的修改。两端确认收到同一个版本后，才会显示提交成功。</p>
    <div class="release-summary"><div><strong>${esc(summary.albumCount ?? 0)}</strong><span>相册</span></div><div><strong>${esc(summary.playableImageCount ?? 0)}</strong><span>可进入游戏的图片</span></div><div><strong>4</strong><span>共用设置</span></div></div>
    <ul class="release-includes"><li>相册、购买设置与每个相册的奖励</li><li>每日图片与自动首发</li><li>任务的金币、经验与小程序体力奖励</li><li>成长、装饰与收集设置</li></ul>
    ${renderReleaseAssets(assets)}
    ${renderHealing(prepared.healing)}
    <p class="notice">提交不会上传程序代码、界面改动或特效；玩家账号、拼图进度和已有奖励不会被替换。${ready ? '' : '图片文件会随本次提交一起上传到两端。'}</p>
    ${summary.pendingImageCount ? `<p class="notice">另有 ${esc(summary.pendingImageCount)} 张图片尚未入库交付到游戏，本次不会上架。它们在后台的相册归属会保留。</p>` : ''}
    ${renderReleaseTargets(null)}
    <p class="muted text-small">上次成功提交：${esc(time(status.lastPublish?.publishedAt))}。日常操作：修改 → 保存 → 提交到双端 → 检查范围 → 确认提交。未保存的编辑不会包含在本次提交中。</p>
    ${!status.configured ? `<p class="notice">${esc(status.configurationMessage || '双端连接正在接入，当前可以查看提交内容。连接完成后即可确认提交。')}</p>` : ''}
    <details class="release-details"><summary>查看提交记录编号</summary><code>${esc(prepared.releaseId)}</code></details>
    <div class="modal-footer"><button type="button" data-release="close">返回编辑</button><button type="button" class="primary" data-release="confirm" ${status.configured ? '' : 'disabled'}>确认提交到 Web 和小程序</button></div>`;
}

export function createReleasePanel({api, hasUnsavedEdits}) {
  const dialog = document.createElement('dialog');
  dialog.className = 'release-dialog';
  dialog.setAttribute('aria-labelledby','release-title');
  document.body.append(dialog);
  let pending = false, prepared = null, status = null, assets = null;
  function render(content, title = '提交到 Web 和小程序') {
    dialog.innerHTML = `<header class="modal-head"><h2 id="release-title">${title}</h2><button type="button" data-release="close" class="quiet" aria-label="关闭提交窗口" ${pending ? 'disabled' : ''}>×</button></header><div class="modal-body" aria-live="polite">${content}</div>`;
  }
  async function readAssets() {
    try { return await api('/api/assets/status'); }
    catch (error) { return {reachable:false, reason:error.message, missing:[], totalFiles:0}; }
  }
  async function prepare() {
    if (pending) return;
    if (hasUnsavedEdits()) {
      render('<p class="notice">还有未保存的编辑。请先保存相册、任务奖励或成长与装饰的修改，再提交到两端。</p><div class="modal-footer"><button type="button" data-release="close" class="primary">返回保存</button></div>');
      if (!dialog.open) dialog.showModal();
      return;
    }
    pending = true; prepared = null;
    render('<p class="release-wait">正在检查已保存的相册、数值和图片…</p>');
    if (!dialog.open) dialog.showModal();
    try {
      status = await api('/api/releases/status');
      assets = await readAssets();
      prepared = await api('/api/releases/prepare', {method:'POST',body:{}});
      pending = false;
      render(renderReleasePreview(prepared,status,assets));
    } catch (error) {
      pending = false;
      render(`<p class="notice" role="alert">${esc(error.message)}</p><div class="modal-footer"><button data-release="close">返回编辑</button><button data-release="prepare">重新检查</button></div>`);
    }
  }
  async function uploadAssets() {
    if (pending) return;
    pending = true;
    render(`<p class="release-wait">正在上传图片，请保持窗口打开…</p><p class="muted">大图较多时需要几分钟，上传完成后会自动校验服务器上的文件。</p>`);
    try {
      await api('/api/assets/deliver', {method:'POST',body:{}});
      assets = await readAssets();
      pending = false;
      if (prepared) render(renderReleasePreview(prepared,status,assets), '图片已上传');
      else render(`<p class="release-success">图片已上传到两端。</p><div class="modal-footer"><button class="primary" data-release="prepare">继续提交设置</button><button data-release="close">关闭</button></div>`, '图片已上传');
    } catch (error) {
      pending = false;
      render(`<p class="notice" role="alert">${esc(error.message)}</p><p class="muted text-small">服务器上已上传的文件会保留，重新上传只会补传缺失部分。</p><div class="modal-footer"><button data-release="close">返回编辑</button><button data-release="prepare">重新检查</button><button class="primary" data-release="upload-assets">重试上传</button></div>`, '图片上传尚未完成');
    }
  }
  async function confirm() {
    if (pending || !prepared || !status?.configured) return;
    if (hasUnsavedEdits()) { await prepare(); return; }
    pending = true;
    const needsAssets = pendingAssets(assets) > 0;
    render(needsAssets ? '<p class="release-wait">正在上传图片…</p><p class="muted">图片完成后会继续同步设置，请保持本窗口打开。</p>' : '<p class="release-wait">正在同步到两端，请稍候…</p><p class="muted">完成后会显示 Web 和小程序各自的结果。请保持本窗口打开。</p>');
    try {
      if (needsAssets) {
        await api('/api/assets/deliver', {method:'POST',body:{}});
        render('<p class="release-wait">图片已上传，正在同步运营设置…</p>');
      }
      const result = await api('/api/releases/confirm', {method:'POST',body:{releaseId:prepared.releaseId,manifestSha256:prepared.manifestSha256}});
      pending = false;
      render(`<p class="release-success">已提交，两端现已使用同一份内容。</p>${renderReleaseTargets(result.targets)}<p class="muted text-small">提交时间：${esc(time(result.publishedAt))}。已打开的游戏页面在下次读取内容时更新。</p><div class="modal-footer"><button class="primary" data-release="close">完成</button></div>`, '提交成功');
    } catch (error) {
      pending = false;
      const rollback = error.receipt?.rollback?.attempted ? error.receipt.rollback : null;
      render(`<p class="notice" role="alert">${esc(error.message)}</p>${error.receipt ? renderReleaseTargets(error.receipt) : ''}${rollback ? `<p class="muted">${rollback.ok ? '两端已确认恢复到提交前的内容。' : '恢复状态尚未确认，请检查两端运行状态后再提交。'}</p>` : ''}<p class="muted text-small">后台已保存的相册与数值仍然保留。</p><div class="modal-footer"><button data-release="close">返回编辑</button><button data-release="prepare">重新检查提交内容</button></div>`, '提交尚未完成');
    }
  }
  dialog.addEventListener('click', event => {
    const action = event.target.closest('[data-release]')?.dataset.release;
    if (action === 'close' && !pending) dialog.close();
    else if (action === 'prepare') void prepare();
    else if (action === 'confirm') void confirm();
    else if (action === 'upload-assets') void uploadAssets();
  });
  dialog.addEventListener('cancel', event => {if (pending) event.preventDefault();});
  return {open:prepare};
}
