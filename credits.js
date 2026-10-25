/**
 * credits.js — 影像出處與授權（地圖頁、集章卡共用；需要先載入 csv.js）
 * ============================================================
 * 資料在 images.csv，一張圖一列：
 *   編號, 類型, 檔案, 年代, 出處, 授權, 連結, 拍攝日期, 拍攝者
 *
 *   類型：過去 / 現在 / 劇情（劇情用的其他圖片）
 *   檔案：留空 = 依編號自動對應（過去 → images/編號1.jpeg，現在 → images/編號2.jpeg）
 *   過去照片填：年代、出處、授權、連結
 *   現在照片填：拍攝日期、拍攝者（授權可填 CC BY 4.0 等）
 *
 * 用法：creditFor('images/1011.jpeg') → { text, link } 或 null
 * ============================================================
 */

const IMAGE_CREDITS = {};
let _creditsReady;
const creditsReady = new Promise(r => { _creditsReady = r; });
const SHOW_MISSING_CREDIT = new URLSearchParams(location.search).has('debug');

function normImgPath(p) {
  return String(p || '').trim().replace(/^\.?\//, '').split('?')[0];
}

function defaultImagePath(id, kind) {
  if (kind === '過去') return `images/${id}1.jpeg`;
  if (kind === '現在') return `images/${id}2.jpeg`;
  return '';
}

function buildCreditText(c) {
  const parts = [];
  if (c.kind === '現在') {
    if (c.by) parts.push('攝影：' + c.by);
    if (c.date) parts.push(c.date);
  } else {
    if (c.year) parts.push(c.year);
    if (c.source) parts.push('出處：' + c.source);
  }
  if (c.license) parts.push(c.license);
  return parts.join('｜');
}

fetchCSVText('images.csv')
  .then(text => {
    for (const r of csvToObjects(text)) {
      const kind = r['類型'] || '';
      const file = normImgPath(r['檔案'] || defaultImagePath(r['編號'], kind));
      if (!file) continue;
      const c = {
        id: r['編號'], kind, file,
        year: r['年代'], source: r['出處'], license: r['授權'], link: r['連結'],
        date: r['拍攝日期'], by: r['拍攝者'],
      };
      c.text = buildCreditText(c);
      if (c.text) IMAGE_CREDITS[file] = c;
    }
  })
  .catch(e => console.warn('[影像出處] 讀不到 images.csv，照片不會顯示出處', e))
  .finally(() => _creditsReady(IMAGE_CREDITS));

function creditFor(path) {
  return IMAGE_CREDITS[normImgPath(path)] || null;
}

/**
 * 把出處寫進某個元素。沒有資料時清空（?debug=1 時顯示「出處待補」方便檢查）
 */
function renderCredit(el, path) {
  if (!el) return;
  const c = creditFor(path);
  el.innerHTML = '';
  el.classList.toggle('credit-missing', !c);
  if (!c) {
    el.textContent = SHOW_MISSING_CREDIT && path ? '⚠ 出處待補：' + normImgPath(path) : '';
    return;
  }
  el.append('📷 ' + c.text);
  if (c.link && /^https?:\/\//.test(c.link)) {
    const a = document.createElement('a');
    a.href = c.link;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = '來源 ↗';
    el.append(' ', a);
  }
}
