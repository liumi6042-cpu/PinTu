const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const time = value => value ? new Date(value).toLocaleString('zh-CN', {hour12:false,timeZone:'Asia/Shanghai'}) : '尚未提交';

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

export function renderReleasePreview(prepared, status) {
  const summary = prepared.summary ?? {};
  return `<p class="release-intro">把当前已保存的相册和数值一起提交。两端确认收到同一个版本后，才会显示提交成功。</p>
    <div class="release-summary"><div><strong>${esc(summary.albumCount ?? 0)}</strong><span>相册</span></div><div><strong>${esc(summary.playableImageCount ?? 0)}</strong><span>可进入游戏的图片</span></div><div><strong>4</strong><span>共用设置</span></div></div>
    <ul class="release-includes"><li>相册、购买设置与每个相册的奖励</li><li>每日图片与自动首发</li><li>任务的金币、经验与小程序体力奖励</li><li>成长、装饰与收集设置</li></ul>
    ${summary.pendingImageCount ? `<p class="notice">另有 ${esc(summary.pendingImageCount)} 张图片尚未交付到游戏，本次不会上架。它们在后台的相册归属会保留。</p>` : ''}
    ${renderReleaseTargets(null)}
    <p class="muted text-small">上次成功提交：${esc(time(status.lastPublish?.publishedAt))}。保存与提交分开，未保存的编辑不会包含在本次提交中。</p>
    ${!status.configured ? `<p class="notice">${esc(status.configurationMessage || '双端连接正在接入，当前可以查看提交内容。连接完成后即可确认提交。')}</p>` : ''}
    <details class="release-details"><summary>查看提交记录编号</summary><code>${esc(prepared.releaseId)}</code></details>
    <div class="modal-footer"><button type="button" data-release="close">返回编辑</button><button type="button" class="primary" data-release="confirm" ${status.configured ? '' : 'disabled'}>确认提交到 Web 和小程序</button></div>`;
}

export function createReleasePanel({api, hasUnsavedEdits}) {
  const dialog = document.createElement('dialog');
  dialog.className = 'release-dialog';
  dialog.setAttribute('aria-labelledby','release-title');
  document.body.append(dialog);
  let pending = false, prepared = null, status = null;
  function render(content, title = '提交到 Web 和小程序') {
    dialog.innerHTML = `<header class="modal-head"><h2 id="release-title">${title}</h2><button type="button" data-release="close" class="quiet" aria-label="关闭提交窗口" ${pending ? 'disabled' : ''}>×</button></header><div class="modal-body" aria-live="polite">${content}</div>`;
  }
  async function prepare() {
    if (pending) return;
    if (hasUnsavedEdits()) {
      render('<p class="notice">还有未保存的编辑。请先保存相册、任务奖励或成长与装饰的修改，再提交到两端。</p><div class="modal-footer"><button type="button" data-release="close" class="primary">返回保存</button></div>');
      if (!dialog.open) dialog.showModal();
      return;
    }
    pending = true; prepared = null;
    render('<p class="release-wait">正在检查已保存的相册和数值…</p>');
    if (!dialog.open) dialog.showModal();
    try {
      status = await api('/api/releases/status');
      prepared = await api('/api/releases/prepare', {method:'POST',body:{}});
      pending = false;
      render(renderReleasePreview(prepared,status));
    } catch (error) {
      pending = false;
      render(`<p class="notice" role="alert">${esc(error.message)}</p><div class="modal-footer"><button data-release="close">返回编辑</button><button data-release="prepare">重新检查</button></div>`);
    }
  }
  async function confirm() {
    if (pending || !prepared || !status?.configured) return;
    if (hasUnsavedEdits()) { await prepare(); return; }
    pending = true;
    render('<p class="release-wait">正在同步到两端，请稍候…</p><p class="muted">完成后会显示 Web 和小程序各自的结果。请保持本窗口打开。</p>');
    try {
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
  });
  dialog.addEventListener('cancel', event => {if (pending) event.preventDefault();});
  return {open:prepare};
}
