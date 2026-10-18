const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const mb = bytes => (Number(bytes || 0) / 1048576).toFixed(2);

/**
 * Import panel: drop original PNGs, they are compressed to the delivery spec on
 * the server (Q70 / longest side 2560 plus a 384 thumbnail) and registered in the
 * private catalogue. Nothing reaches the game until 「提交到双端」.
 */
export function renderImport(state) {
  const recent = state.importReceipts || [];
  const queue = state.importQueue || [];
  // A finished batch shows what each picture became, so the operator can judge it.
  const last = recent[0];
  return `<div class="page-heading"><div><div class="eyebrow">IMPORT · CONTENT WORKSPACE</div><h1>导入图片</h1><p>本地只留原图。这里把原图压缩成服务器需要的文件，再登记进图库；之后按原来的「保存 → 提交到双端」上线。</p></div></div>
  <section class="import-panel">
    <label class="import-drop" data-import-drop>
      <input type="file" accept="image/png,image/jpeg,image/webp" multiple data-import-files hidden>
      <span class="import-drop-icon">＋</span>
      <strong>选择或拖入图片</strong>
      <small>PNG 原图优先，单张最大 40MB。自动压成 Q70 / 长边 2560，并生成 384 缩略图。</small>
    </label>
    ${queue.length ? `<div class="import-queue">${queue.map((item, index) => `<div class="import-row">
      <span class="import-name">${esc(item.file.name)}<small>${mb(item.file.size)} MB</small></span>
      <label class="field"><b>标题</b><input data-import-key="title" data-row="${index}" value="${esc(item.title)}" maxlength="180" placeholder="图片名称"></label>
      <label class="field"><b>画风</b><select data-import-key="styleGroupId" data-row="${index}">${(state.importStyles || []).map(style => `<option value="${esc(style.id)}" ${item.styleGroupId === style.id ? 'selected' : ''}>${esc(style.name)}</option>`).join('')}</select></label>
      <label class="field"><b>题材标签</b><input data-import-key="subjectTags" data-row="${index}" value="${esc(item.subjectTags)}" placeholder="用逗号分隔"></label>
      <button type="button" class="small quiet" data-action="import-remove" data-row="${index}" aria-label="移出这一张">移除</button>
    </div>`).join('')}
    <div class="import-actions"><button type="button" class="primary" data-action="import-run" ${state.importBusy ? 'disabled' : ''}>${state.importBusy ? `正在处理 ${state.importProgress || 0} / ${queue.length}…` : `导入这 ${queue.length} 张`}</button><button type="button" data-action="import-clear" ${state.importBusy ? 'disabled' : ''}>清空</button></div></div>` : ''}
    ${state.importError ? `<p class="notice" role="alert">${esc(state.importError)}</p>` : ''}
    ${last ? `<div class="import-result"><h2>上一批：${esc(last.imported.length)} 张已入库</h2>
      <div class="import-result-rows">${last.imported.map(row => `<div class="import-result-row"><strong>${esc(row.title)}</strong><span>${row.width}×${row.height} · ${mb(row.sourceBytes)} MB → ${(row.optimizedBytes / 1024).toFixed(0)} KB</span><code>${esc(row.id)}</code></div>`).join('')}</div>
      ${last.failures?.length ? `<p class="notice">${last.failures.map(f => `${esc(f.name)}：${esc(f.reason)}`).join('；')}</p>` : ''}
      <p class="muted text-small">这些图片现在在「全部图片」里，可以拖进相册。要让玩家看到，还需要保存并「提交到双端」。</p></div>` : ''}
    ${recent.length > 1 ? `<details class="import-history"><summary>以前的导入 · ${recent.length - 1} 批</summary>${recent.slice(1, 12).map(batch => `<div class="audit-row">${esc(batch.at)} · ${esc(batch.imported.length)} 张<span>${esc(batch.batch)}</span></div>`).join('')}</details>` : ''}
  </section>`;
}
