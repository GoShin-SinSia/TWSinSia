/**
 * app.js — 集章圖鑑主程式（Firebase 版）
 * 功能：分類篩選、過去/現在圖片、GPS 打卡、尋路雷達、
 *       互動劇情（選擇／問答／現場關卡／道具）、行囊、徽章、AI 劇情
 *
 * 網址參數（測試用）：
 *   ?date=2026-10-25   假裝是那一天
 *   ?debug=1           在神社詳情出現「模擬在此打卡」，現場關卡可略過，缺出處的照片會標出來
 */

if (!window.collected) window.collected = new Set();
if (!window.unlockedStories) window.unlockedStories = new Map(); // 'spotId:key' → 'YYYY-M-D'
if (!window.items) window.items = new Map();                     // 道具名 → { desc, spotId, date }
if (!window.solved) window.solved = new Set();                   // 解開的謎題／現場關卡
if (!window.aiStories) window.aiStories = new Map();             // 'spotId:ai-日期' → variant
if (!window.quests) window.quests = new Map();                   // 'spotId:key' → 解謎進度

const DEBUG = new URLSearchParams(location.search).has('debug');
const ONSITE_DEFAULT_RADIUS = 60;

let currentFilter = 'all';
let pendingBadges = []; // 劇情播完再慶祝

/* ==========================================
   工具函式
   ========================================== */

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 方位角（0 = 正北，順時針）
function bearing(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(lng2 - lng1)) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
            Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lng2 - lng1));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function dirName(deg) {
  return ['北', '東北', '東', '東南', '南', '西南', '西', '西北'][Math.round(deg / 45) % 8];
}

function fmtDist(m) {
  return m >= 1000 ? (m / 1000).toFixed(1) + ' 公里' : Math.round(m) + ' 公尺';
}

function findNearest(lat, lng, list = SPOTS) {
  let best = null, bestDist = Infinity;
  for (const spot of list) {
    const d = haversine(lat, lng, spot.lat, spot.lng);
    if (d < bestDist) { bestDist = d; best = spot; }
  }
  return { spot: best, dist: bestDist };
}

// 最近一次定位結果（雷達、現場關卡、單次定位共用）
let lastFix = null;
function rememberFix(c) {
  lastFix = { lat: c.latitude, lng: c.longitude, acc: c.accuracy, t: Date.now() };
  return lastFix;
}
// 有 10 秒內的定位就直接用；否則重新定位。
// （有些瀏覽器在 watchPosition 進行中，getCurrentPosition 會一直等不到）
function getFix(onOk, onErr, maxAge = 10000) {
  if (lastFix && Date.now() - lastFix.t < maxAge) { onOk(lastFix); return; }
  if (!navigator.geolocation) { onErr({ message: '此瀏覽器不支援 GPS 定位' }); return; }
  navigator.geolocation.getCurrentPosition(
    p => onOk(rememberFix(p.coords)),
    onErr,
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 5000 }
  );
}

function escapeHTML(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function gameCtx() {
  return { items: window.items, collected: window.collected };
}

function buildImgHTML(spot, locked) {
  const lockClass = locked ? 'locked' : 'collected';
  return `<div class="stamp-img-wrap ${lockClass}">
    <img src="${spot.imagePast}" alt="${escapeHTML(spot.name)}" loading="lazy"
         onerror="this.style.display='none';this.parentElement.innerHTML='<span class=\\'stamp-emoji\\'>${spot.emoji}</span>'" />
  </div>`;
}

// 這間神社的劇情類型標記：🧩 有解謎、📜 有劇情
function storyMark(spotId) {
  if (typeof STORIES === 'undefined' || !STORIES[spotId]) return '';
  const vs = STORIES[spotId].variants.filter(v => v.lines.length);
  if (!vs.length) return '';
  const puzzle = vs.some(v => v.lines.some(l => l.type === 'ask' || l.type === 'onsite'));
  return `<div class="stamp-story-mark" title="${puzzle ? '有解謎' : '有劇情'}">${puzzle ? '🧩' : '📜'}</div>`;
}

let _saveTimer = null;
async function save() {
  clearTimeout(_saveTimer); _saveTimer = null;
  if (window.saveProgress) {
    try { await window.saveProgress(); } catch (e) { console.error('儲存失敗', e); }
  }
}
// 解謎進度每走一步都會變，合併成幾秒存一次
function scheduleSave() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(save, 2500);
}
// 手機切到背景前把還沒存的進度存起來
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && _saveTimer) save();
});

/* ==========================================
   分類篩選
   ========================================== */

function setFilter(filter) {
  const restoreFocus = document.activeElement?.matches('#badge-shelf [data-filter]');
  currentFilter = filter;
  renderGallery();
  if (restoreFocus) document.querySelector('#badge-shelf [aria-pressed="true"]')?.focus({ preventScroll: true });
}

function getFilteredSpots() {
  if (currentFilter === 'all') return SPOTS;
  return SPOTS.filter(s => s.category === currentFilter);
}

/* ==========================================
   渲染：圖鑑頁
   ========================================== */

function renderGallery() {
  renderBadgeShelf();

  const grid = document.getElementById('gallery-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const spots = getFilteredSpots();
  if (spots.length === 0) {
    grid.innerHTML = `<div class="empty-hint" style="grid-column:1/-1">
      <span class="empty-icon">🔍</span><p>此分類沒有資料</p>
    </div>`;
    updateProgress();
    return;
  }

  for (const spot of spots) {
    const ok = window.collected.has(spot.id);
    const card = document.createElement('div');
    card.className = `stamp-card${ok ? ' is-collected' : ''}`;
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `${spot.name}，${ok ? '已集章' : '尚未集章'}`);
    card.innerHTML = `
      <div class="stamp-badge ${ok ? 'badge-collected' : 'badge-locked'}" aria-hidden="true">${ok ? '✓' : '🔒'}</div>
      <div class="stamp-category-tag">${spot.category}</div>
      ${storyMark(spot.id)}
      ${buildImgHTML(spot, !ok)}
      <div class="stamp-name">${escapeHTML(spot.name)}</div>
      <div class="stamp-city">${escapeHTML(spot.city)}</div>
    `;
    card.addEventListener('click', () => openModal(spot));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openModal(spot); }
    });
    grid.appendChild(card);
  }

  updateProgress();
}

/* ==========================================
   渲染：已集章頁
   ========================================== */

function renderCollected() {
  const grid = document.getElementById('collected-grid');
  const empty = document.getElementById('collected-empty');
  if (!grid) return;
  grid.innerHTML = '';

  const list = SPOTS.filter((s) => window.collected.has(s.id));
  empty.style.display = list.length ? 'none' : 'block';

  for (const spot of list) {
    const card = document.createElement('div');
    card.className = 'stamp-card is-collected';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.innerHTML = `
      <div class="stamp-category-tag">${spot.category}</div>
      ${storyMark(spot.id)}
      ${buildImgHTML(spot, false)}
      <div class="stamp-name">${escapeHTML(spot.name)}</div>
      <div class="stamp-city">${escapeHTML(spot.city)}</div>
    `;
    card.addEventListener('click', () => openModal(spot));
    grid.appendChild(card);
  }
}

/* ==========================================
   渲染：行囊（道具與解謎紀錄）
   ========================================== */

function renderBag() {
  const list = document.getElementById('bag-list');
  const empty = document.getElementById('bag-empty');
  const stats = document.getElementById('bag-stats');
  if (!list) return;
  list.innerHTML = '';

  const storyCount = window.unlockedStories.size;
  stats.innerHTML = `
    <div><strong>${window.items.size}</strong><span>道具</span></div>
    <div><strong>${window.solved.size}</strong><span>解開的謎</span></div>
    <div><strong>${storyCount}</strong><span>聽過的故事</span></div>`;

  empty.style.display = window.items.size ? 'none' : 'block';

  for (const [name, it] of window.items) {
    const spot = SPOTS.find(s => s.id === it.spotId);
    const li = document.createElement('div');
    li.className = 'bag-item';
    li.innerHTML = `
      <div class="bag-icon">${it.image ? `<img src="${escapeHTML(it.image)}" alt="" onerror="this.replaceWith('🎁')">` : '🎁'}</div>
      <div class="bag-body">
        <div class="bag-name">${escapeHTML(name)}</div>
        <div class="bag-desc">${escapeHTML(it.desc || '')}</div>
        <div class="bag-from">${spot ? '得自 ' + escapeHTML(spot.name) : ''}${it.date ? '・' + fmtDateKey(it.date) : ''}</div>
      </div>`;
    list.appendChild(li);
  }
}

/* ==========================================
   進度條
   ========================================== */

function updateProgress() {
  const n = SPOTS.filter(s => window.collected.has(s.id)).length;
  const total = SPOTS.length;
  const pct = total > 0 ? (n / total) * 100 : 0;

  document.getElementById('prog-count').textContent = n;
  document.getElementById('prog-total').textContent = total;
  document.getElementById('prog-bar').style.width = pct.toFixed(1) + '%';

  const aria = document.getElementById('prog-bar-aria');
  aria.setAttribute('aria-valuenow', n);
  aria.setAttribute('aria-valuemax', total);
}

/* ==========================================
   分頁切換
   ========================================== */

// A 群為淺古紙色，B 群只加深同色系；GPS 沿用上一個群組。
let pageTone = new URLSearchParams(location.search).get('tab') === 'quest' ? 'mystery' : 'explore';
const toneBase = document.createElement('div');
toneBase.className = 'page-tone';
toneBase.dataset.tone = pageTone;
toneBase.setAttribute('aria-hidden', 'true');
document.body.prepend(toneBase);
let toneTransition = null;

function setPageTone(tabName) {
  const nextTone = ['quest', 'bag'].includes(tabName) ? 'mystery'
    : ['gallery', 'collected'].includes(tabName) ? 'explore' : pageTone;
  if (nextTone === pageTone) return;

  // 快速連續切換時先收尾舊動畫，避免疊加或舊回呼覆蓋新底色。
  if (toneTransition) toneTransition.finish();
  pageTone = nextTone;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !toneBase.animate) {
    toneBase.dataset.tone = nextTone;
    return;
  }

  const wash = toneBase.cloneNode();
  wash.classList.add('page-tone-wash');
  wash.dataset.tone = nextTone;
  toneBase.after(wash);
  const button = document.querySelector(`.tab[data-tab="${tabName}"]`);
  const rect = button.getBoundingClientRect();
  const x = Math.max(0, Math.min(innerWidth, rect.left + rect.width / 2));
  const y = Math.max(0, Math.min(innerHeight, rect.top + rect.height / 2));
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)) + 64;
  const animation = wash.animate([
    { clipPath: `circle(0px at ${x + 24}px ${y + 24}px)` },
    { clipPath: `circle(${radius}px at ${x + 24}px ${y + 24}px)` },
  ], { duration: 1200, easing: 'cubic-bezier(.2,.65,.3,1)', fill: 'forwards' });
  let finished = false;
  const transition = { finish() {
    if (finished) return;
    finished = true;
    toneBase.dataset.tone = nextTone;
    wash.remove();
    animation.cancel();
    if (toneTransition === transition) toneTransition = null;
  } };
  toneTransition = transition;
  animation.onfinish = () => transition.finish();
}

function switchTab(tabName) {
  setPageTone(tabName);
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  document.querySelectorAll('.section').forEach((sec) => sec.classList.remove('active'));
  document.getElementById('tab-' + tabName).classList.add('active');
  if (tabName === 'collected') renderCollected();
  if (tabName === 'bag') renderBag();
  if (tabName === 'quest') renderQuests();
  if (tabName === 'gps') fillRadarTargets();
}

/* ==========================================
   GPS：單次定位打卡
   ========================================== */

function checkLocation() {
  if (!navigator.geolocation) { showGpsError('此瀏覽器不支援 GPS 定位'); return; }

  const btn = document.getElementById('check-btn');
  const dot = document.getElementById('status-dot');
  const txt = document.getElementById('status-text');

  btn.disabled = true;
  dot.className = 'status-dot active';
  txt.textContent = '定位中…';

  getFix(
    (f) => {
      showCoords(f.lat, f.lng, f.acc);
      dot.className = 'status-dot active';
      txt.textContent = '定位成功';
      btn.disabled = false;
      processCheckIn(f.lat, f.lng);
    },
    (err) => { showGpsError('無法取得位置：' + err.message); btn.disabled = false; },
    5000
  );
}

function showCoords(lat, lng, acc) {
  document.getElementById('lat-val').textContent = lat.toFixed(5);
  document.getElementById('lng-val').textContent = lng.toFixed(5);
  const accEl = document.getElementById('acc-val');
  if (accEl) accEl.textContent = acc ? `誤差約 ${Math.round(acc)} 公尺` : '';
}

function showGpsError(msg) {
  document.getElementById('status-dot').className = 'status-dot error';
  document.getElementById('status-text').textContent = msg;
}

/* ==========================================
   GPS：尋路雷達（持續追蹤）
   ========================================== */

const radar = {
  watchId: null,
  target: 'auto',     // 'auto' | 神社編號 | { lat, lng, radius, name }
  pos: null,
  heading: null,
  lastDist: null,
  autoChecked: new Set(),
};

function fillRadarTargets() {
  const sel = document.getElementById('radar-target');
  if (!sel || !SPOTS.length) return;
  const keep = sel.value || String(radar.target);
  sel.innerHTML = '<option value="auto">最近的未集章神社</option>' +
    (radar.customTarget ? `<option value="custom">🧩 ${escapeHTML(radar.customTarget.name)}</option>` : '') +
    ['官社', '縣社', '鄉社', '未分類'].map(cat => {
      const list = SPOTS.filter(s => s.category === cat);
      if (!list.length) return '';
      return `<optgroup label="${cat}">` + list.map(s =>
        `<option value="${s.id}">${window.collected.has(s.id) ? '✓ ' : ''}${escapeHTML(s.name)}</option>`).join('') + '</optgroup>';
    }).join('');
  sel.value = [...sel.options].some(o => o.value === keep) ? keep : 'auto';
}

function setRadarTarget(value) {
  if (value && typeof value === 'object') { radar.customTarget = value; value = 'custom'; }
  radar.target = value === 'custom' ? radar.customTarget : value;
  radar.lastDist = null;
  const sel = document.getElementById('radar-target');
  if (sel) { fillRadarTargets(); sel.value = String(value); }
  drawRadar();
}

function resolveRadarTarget() {
  const t = radar.target;
  if (t && typeof t === 'object') return t;
  if (t !== 'auto') {
    const s = SPOTS.find(s => String(s.id) === String(t));
    if (s) return { lat: s.lat, lng: s.lng, radius: s.radius, name: s.name, spot: s };
  }
  if (!radar.pos) return null;
  const uncollected = SPOTS.filter(s => !window.collected.has(s.id));
  const { spot } = findNearest(radar.pos.lat, radar.pos.lng, uncollected.length ? uncollected : SPOTS);
  return spot ? { lat: spot.lat, lng: spot.lng, radius: spot.radius, name: spot.name, spot } : null;
}

async function toggleRadar() {
  const btn = document.getElementById('radar-toggle');
  if (radar.watchId != null) { stopRadar(); return; }
  if (!navigator.geolocation) { showGpsError('此瀏覽器不支援 GPS 定位'); return; }

  // iOS 要使用者按按鈕才能要求指南針權限
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      await DeviceOrientationEvent.requestPermission();
    }
  } catch (e) { /* 沒有指南針也能玩 */ }
  window.addEventListener('deviceorientationabsolute', onOrientation, true);
  window.addEventListener('deviceorientation', onOrientation, true);

  document.getElementById('status-dot').className = 'status-dot active';
  document.getElementById('status-text').textContent = '追蹤中…';
  btn.textContent = '⏹ 停止追蹤';
  btn.classList.add('on');

  radar.watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude: lat, longitude: lng, accuracy } = pos.coords;
      rememberFix(pos.coords);
      radar.pos = { lat, lng, accuracy };
      showCoords(lat, lng, accuracy);
      document.getElementById('status-text').textContent = '追蹤中';
      drawRadar();
      autoCheckIn(lat, lng);
    },
    (err) => { showGpsError('無法取得位置：' + err.message); },
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 }
  );
}

function stopRadar() {
  if (radar.watchId != null) navigator.geolocation.clearWatch(radar.watchId);
  radar.watchId = null;
  window.removeEventListener('deviceorientationabsolute', onOrientation, true);
  window.removeEventListener('deviceorientation', onOrientation, true);
  const btn = document.getElementById('radar-toggle');
  if (btn) { btn.textContent = '🧭 開始追蹤'; btn.classList.remove('on'); }
  document.getElementById('status-dot').className = 'status-dot';
  document.getElementById('status-text').textContent = '已停止追蹤';
}

// 兩個角度之間的最短差（-180 ~ 180）
function angleDelta(from, to) {
  return ((to - from + 540) % 360) - 180;
}

function onOrientation(e) {
  let h = null;
  if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;   // iPhone
  else if (e.absolute && e.alpha != null) h = 360 - e.alpha;                     // Android
  if (h == null || isNaN(h)) return;
  // 手機橫拿時要補上螢幕旋轉角度
  const screenAngle = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
  h = (h + screenAngle + 360) % 360;

  // 指南針很吵：小於 2° 的抖動不理，其餘平滑跟上
  if (radar.heading == null) radar.heading = h;
  else {
    const d = angleDelta(radar.heading, h);
    if (Math.abs(d) < 2) return;
    radar.heading = (radar.heading + d * 0.3 + 360) % 360;
  }
  requestRadarDraw();
}

// 感應器一秒會觸發幾十次，合併成每個畫面最多畫一次
let _radarFrame = 0;
function requestRadarDraw() {
  if (_radarFrame) return;
  _radarFrame = requestAnimationFrame(() => { _radarFrame = 0; drawRadar(); });
}

// 讓旋轉角度連續（避免從 359° 轉到 1° 時倒轉一整圈）
const _rot = { arrow: 0, north: 0 };
function setRotation(name, el, deg, apply) {
  _rot[name] += angleDelta(_rot[name], deg);
  apply(el, _rot[name]);
}

function drawRadar() {
  const distEl = document.getElementById('radar-dist');
  const tempEl = document.getElementById('radar-temp');
  const nameEl = document.getElementById('radar-name');
  const arrow = document.getElementById('radar-arrow');
  const dial = document.getElementById('radar-dial');
  const gmap = document.getElementById('radar-gmap');
  if (!distEl) return;

  const t = resolveRadarTarget();
  nameEl.textContent = t ? t.name : '—';
  if (t && gmap) {
    gmap.href = `https://www.google.com/maps/dir/?api=1&destination=${t.lat},${t.lng}&travelmode=walking`;
    gmap.style.visibility = 'visible';
  }
  if (!t || !radar.pos) {
    distEl.textContent = '—';
    tempEl.textContent = radar.watchId != null ? '等待定位…' : '按「開始追蹤」，跟著箭頭走';
    dial.dataset.temp = 'none';
    return;
  }

  const d = haversine(radar.pos.lat, radar.pos.lng, t.lat, t.lng);
  const b = bearing(radar.pos.lat, radar.pos.lng, t.lat, t.lng);
  const h = radar.heading ?? 0;
  setRotation('arrow', arrow, b - h, (el, r) => { el.style.transform = `rotate(${r}deg)`; });
  setRotation('north', dial, -h, (el, r) => { el.style.setProperty('--north', `${r}deg`); });
  document.getElementById('radar-compass-note').textContent =
    radar.heading == null ? '沒有指南針：圓盤上方 = 北方' : '箭頭會跟著手機轉向';

  distEl.textContent = fmtDist(d);

  let temp, msg;
  if (d <= (t.radius || CHECKIN_RADIUS)) { temp = 'hot'; msg = '就是這裡！'; }
  else if (d <= 120) { temp = 'warm'; msg = '就在附近，四處看看'; }
  else if (d <= 400) { temp = 'mild'; msg = `往${dirName(b)}方走`; }
  else { temp = 'cold'; msg = `還很遠，往${dirName(b)}方`; }

  if (radar.lastDist != null && Math.abs(d - radar.lastDist) > 8 && temp !== 'hot') {
    msg += d < radar.lastDist ? '・越來越近了' : '・好像走遠了';
  }
  if (radar.lastDist == null || Math.abs(d - radar.lastDist) > 8) radar.lastDist = d;

  tempEl.textContent = msg;
  dial.dataset.temp = temp;
}

// 雷達追蹤中走進任何神社的範圍 → 自動打卡（每間每次開頁只觸發一次）
function autoCheckIn(lat, lng) {
  if (storyState) return; // 劇情播放中不打擾
  const { spot, dist } = findNearest(lat, lng);
  if (!spot || dist > spot.radius || radar.autoChecked.has(spot.id)) return;
  radar.autoChecked.add(spot.id);
  processCheckIn(lat, lng);
}

/* ==========================================
   打卡主流程
   ========================================== */

async function processCheckIn(lat, lng, { forceSpot = null } = {}) {
  let spot, dist;
  if (forceSpot) { spot = forceSpot; dist = 0; }
  else ({ spot, dist } = findNearest(lat, lng));
  if (!spot) return;

  const nearestBox = document.getElementById('nearest-box');
  nearestBox.style.display = 'block';
  document.getElementById('nearest-name').textContent = spot.name + ' ' + spot.emoji;
  document.getElementById('nearest-dist').textContent = '距離 ' + fmtDist(dist);

  const banner = document.getElementById('result-banner');
  banner.style.display = 'block';

  if (dist > spot.radius) {
    banner.className = 'result-banner result-fail';
    banner.textContent =
      `距離「${spot.name}」還有 ${fmtDist(dist)}，再靠近一點（需在 ${spot.radius} 公尺內）`;
    return;
  }

  await storiesReady;
  const date = getStoryDate();
  const isNew = !window.collected.has(spot.id);
  if (isNew) window.collected.add(spot.id);

  // 1. 先找作者寫好的劇情（解謎任務不在打卡時自動播，改到解謎頁開始）
  let variant = pickStoryVariant(spot.id, date, window.unlockedStories, gameCtx(), { excludeQuests: true });
  const questsHere = availableQuestsAt(spot, date);

  // 2. 這間神社完全沒有登記劇情 → 問 AI（同一天同一間只問一次）
  if (!variant && !hasWrittenStories(spot.id)) {
    const aiKey = `${spot.id}:ai-${toDateKey(date)}`;
    variant = window.aiStories.get(aiKey) || null;
    if (!variant && AI_CONFIG.mode !== 'off') {
      banner.className = 'result-banner result-already';
      banner.textContent = '🦊 有什麼聲音在耳邊響起……';
      variant = await requestAIStory(spot, date, gameCtx());
      if (variant) window.aiStories.set(aiKey, variant);
    }
  }

  const key = variant && storyKey(spot.id, variant);
  const storyIsNew = !!variant && !window.unlockedStories.has(key);
  if (storyIsNew) window.unlockedStories.set(key, toDateKey(date));

  const freshBadges = isNew ? checkBadges(date) : [];
  if (isNew || storyIsNew || freshBadges.length) await save();
  if (isNew) { renderGallery(); fillRadarTargets(); }

  if (isNew) {
    banner.className = 'result-banner result-success';
    banner.textContent = `🎉 恭喜！成功集到「${spot.name}」的章！`;
  } else {
    banner.className = 'result-banner result-already';
    banner.textContent = `你已經集過「${spot.name}」的章囉！`;
  }
  if (storyIsNew) {
    banner.textContent += `\n📜 解鎖新劇情「${variant.title}」`;
  } else if (!variant && !questsHere.length && getStoryVariants(spot.id).length) {
    banner.textContent += '\n今天這裡很安靜。換個日子再來看看吧。';
  }
  showQuestHint(questsHere);
  if (freshBadges.length) banner.textContent += `\n🏅 獲得徽章「${freshBadges.map(b => b.name).join('」「')}」`;

  if (variant) {
    pendingBadges.push(...freshBadges);
    openStory(spot, variant, { justUnlocked: storyIsNew, date });
  } else {
    celebrateBadges(freshBadges);
  }
}

/* ==========================================
   Modal（神社詳情）
   ========================================== */

let currentModalSpot = null;
let currentPhotoMode = 'past';

function openModal(spot) {
  currentModalSpot = spot;
  currentPhotoMode = 'past';
  const ok = window.collected.has(spot.id);

  document.getElementById('modal-title').textContent = spot.name;
  document.getElementById('modal-new-name').textContent = spot.new_name ? `現名：${spot.new_name}` : '';
  document.getElementById('modal-sub').textContent = `${spot.city}　${spot.category}｜打卡半徑 ${spot.radius} 公尺`;
  document.getElementById('modal-period').textContent = spot.period ? '📅 ' + spot.period : '';
  document.getElementById('modal-desc').textContent = spot.description || '';

  const statusEl = document.getElementById('modal-status');
  statusEl.textContent = ok ? '✓ 已集章' : '尚未集章';
  statusEl.className = 'modal-status ' + (ok ? 'collected' : 'not-collected');

  document.getElementById('modal-photo-tabs').style.display = ok ? 'flex' : 'none';
  showModalPhoto('past');
  renderModalStories(spot);
  renderModalActions(spot);

  document.getElementById('modal').classList.add('open');
}

function renderModalActions(spot) {
  const box = document.getElementById('modal-actions');
  box.innerHTML = '';

  const go = document.createElement('button');
  go.className = 'modal-act primary';
  go.textContent = '🧭 帶我去';
  go.addEventListener('click', () => {
    closeModal();
    switchTab('gps');
    setRadarTarget(spot.id);
    if (radar.watchId == null) toggleRadar();
    document.getElementById('tab-gps').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  box.appendChild(go);

  const map = document.createElement('a');
  map.className = 'modal-act';
  map.textContent = '🗺 Google 地圖';
  map.target = '_blank';
  map.rel = 'noopener';
  map.href = `https://www.google.com/maps/search/?api=1&query=${spot.lat},${spot.lng}`;
  box.appendChild(map);

  if (radar.pos) {
    const d = haversine(radar.pos.lat, radar.pos.lng, spot.lat, spot.lng);
    const p = document.createElement('div');
    p.className = 'modal-distance';
    p.textContent = `距離你約 ${fmtDist(d)}・${dirName(bearing(radar.pos.lat, radar.pos.lng, spot.lat, spot.lng))}方`;
    box.appendChild(p);
  }

  if (DEBUG) {
    const dbg = document.createElement('button');
    dbg.className = 'modal-act debug';
    dbg.textContent = '🧪 模擬在此打卡';
    dbg.addEventListener('click', () => {
      closeModal();
      switchTab('gps');
      processCheckIn(spot.lat, spot.lng, { forceSpot: spot });
    });
    box.appendChild(dbg);
  }
}

// Modal 裡的劇情章節列表
function renderModalStories(spot) {
  const box = document.getElementById('modal-stories');
  const variants = getStoryVariants(spot.id);
  box.innerHTML = '';
  if (!variants.length) {
    // 沒寫劇情、但 AI 開著
    if (typeof AI_CONFIG !== 'undefined' && AI_CONFIG.mode !== 'off' && !hasWrittenStories(spot.id)) {
      box.style.display = 'block';
      box.innerHTML = '<div class="modal-story-hint">🦊 這裡的故事還沒有人寫下。親自前來，也許會聽見些什麼。</div>';
    } else {
      box.style.display = 'none';
    }
    return;
  }
  box.style.display = 'block';

  const unlocked = variants.filter(v => window.unlockedStories.has(storyKey(spot.id, v)));
  const lockedCount = variants.filter(v => !v.ai).length - unlocked.filter(v => !v.ai).length;

  for (const v of unlocked) {
    const d = fromDateKey(window.unlockedStories.get(storyKey(spot.id, v)));
    const btn = document.createElement('button');
    btn.className = 'modal-story-btn';
    const puzzle = v.lines.some(l => l.type === 'ask' || l.type === 'onsite');
    btn.textContent = `${puzzle ? '🧩' : '📜'} ${v.title}${v.ai ? '（AI）' : ''}`;
    const small = document.createElement('small');
    small.textContent = `${d.getMonth() + 1}/${d.getDate()}`;
    btn.appendChild(small);
    if (isQuestVariant(v) && !v.ai) {
      const q = window.quests.get(storyKey(spot.id, v));
      small.textContent = q && q.status === 'active' ? '進行中' : q && q.doneDate ? '✓ 完成' : small.textContent;
    }
    btn.addEventListener('click', () => openStory(spot, v, { date: d }));
    box.appendChild(btn);
  }

  if (lockedCount > 0) {
    const hint = document.createElement('div');
    hint.className = 'modal-story-hint';
    hint.textContent = unlocked.length
      ? `還有 ${lockedCount} 段劇情，要在特別的日子、或帶著特別的東西來才聽得到。`
      : `🔒 這裡有 ${lockedCount} 段劇情，親自前來就能解鎖。`;
    box.appendChild(hint);
  }
}

function showModalPhoto(mode) {
  if (!currentModalSpot) return;
  currentPhotoMode = mode;

  const spot = currentModalSpot;
  const ok = window.collected.has(spot.id);
  const src = mode === 'past' ? spot.imagePast : spot.imageNow;
  const label = mode === 'past' ? spot.name : (spot.new_name || spot.name);

  const imgEl = document.getElementById('modal-img');
  imgEl.innerHTML = `
    <img src="${src}" alt="${escapeHTML(label)}"
         style="${(!ok) ? 'filter:grayscale(1);opacity:.5' : ''}"
         onerror="this.parentElement.innerHTML='<span style=\\'font-size:42px\\'>${spot.emoji}</span>'" />`;

  document.getElementById('modal-photo-label').textContent = mode === 'past' ? `過去・${spot.name}` : `現在・${label}`;
  renderCredit(document.getElementById('modal-photo-credit'), src);
  document.querySelectorAll('.photo-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
}

function closeModal() {
  document.getElementById('modal').classList.remove('open');
  currentModalSpot = null;
}

function closeModalOverlay(e) {
  if (e.target === document.getElementById('modal')) closeModal();
}

/* ==========================================
   鍵盤
   ========================================== */

document.addEventListener('keydown', (e) => {
  if (document.getElementById('badge-popup').classList.contains('open')) {
    if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); closeBadgePopup(); }
    return;
  }
  if (storyState) {
    const typingInInput = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    if (e.key === 'Escape') { closeStory(); }
    else if (typingInInput) { return; }
    else if (/^[1-9]$/.test(e.key) && curLine().type === 'choice') {
      const btn = document.querySelectorAll('#story-interact .story-choice')[Number(e.key) - 1];
      if (btn) btn.click(); else return;
    }
    else if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') {
      if (e.target.tagName === 'BUTTON' && e.target.closest('#story-interact')) return; // 讓按鈕自己處理
      advanceStory();
    }
    else if (e.key === 'ArrowLeft') prevStory();
    else return;
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  if (e.key === 'Escape') closeModal();
}, true);

/* ==========================================
   劇情播放器
   ========================================== */

let storyState = null;
const REDUCE_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const TYPE_SPEED = 40;

const curLine = () => storyState.variant.lines[storyState.index];

function fillText(text) {
  const { date, spot } = storyState;
  return String(text || '')
    .replace(/\{month\}/g, CN_MONTHS[date.getMonth()])
    .replace(/\{神社\}/g, spot.name)
    .replace(/\{現名\}/g, spot.new_name || spot.name);
}

function resolveImage(img, spot) {
  if (img === 'past' || img === '過去') return spot.imagePast;
  if (img === 'now' || img === '現在') return spot.imageNow;
  return img;
}

function speakerOf(line) {
  const s = (line.speaker || '').trim();
  if (s === '旁白' || s === '-') return '';
  return s || storyState.variant.speaker || '';
}

function puzzleIdFor(spotId, variant, line) {
  return `${spotId}:${variant.key}:${line.node || 'r' + line.row}`;
}
function puzzleId(line) {
  return puzzleIdFor(storyState.spot.id, storyState.variant, line);
}
const todayKey = () => toDateKey(new Date());

function openStory(spot, variant, opts = {}) {
  if (!variant || !variant.lines.length) return false;
  stopOnsiteWatch();
  const qKey = storyKey(spot.id, variant);
  const isQuest = isQuestVariant(variant) && !variant.ai;
  storyState = {
    spot, variant,
    date: opts.date || getStoryDate(),
    index: -1, history: [],
    typing: false, timer: null, full: '',
    passed: false, // 目前這個互動節點是否已通過
    wrong: 0, hintShown: 0,
    quest: isQuest ? qKey : null,
  };

  // 解謎任務：讀取或建立存檔
  let start = 0, resumed = false;
  if (isQuest) {
    const q = window.quests.get(qKey);
    if (q && q.status === 'active' && !opts.restart && q.index > 0 && q.index < variant.lines.length) {
      start = q.index;
      storyState.history = Array.isArray(q.history) ? q.history.filter(i => i < variant.lines.length) : [];
      resumed = true;
    } else {
      window.quests.set(qKey, {
        ...(q || {}), status: 'active', index: 0, history: [],
        started: (q && q.started) || todayKey(), updated: todayKey(),
      });
    }
    if (!window.unlockedStories.has(qKey)) window.unlockedStories.set(qKey, todayKey());
    scheduleSave();
  }

  const title = document.getElementById('story-title');
  title.textContent = `${spot.name}｜${variant.title}`;
  if (variant.ai) {
    const tag = document.createElement('span');
    tag.className = 'story-ai-tag';
    tag.textContent = 'AI';
    tag.title = AI_CONFIG.label;
    title.appendChild(tag);
  }

  const seal = document.getElementById('story-seal');
  seal.classList.remove('show');
  if (opts.justUnlocked) { void seal.offsetWidth; seal.classList.add('show'); }

  const overlay = document.getElementById('story');
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  document.getElementById('story-box').focus();

  goTo(start, false);
  if (resumed) showStoryToast('📍 從上次的進度繼續');
  return true;
}

function showStoryToast(msg) {
  const el = document.getElementById('story-toast');
  el.textContent = msg;
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
}

// 把目前位置寫進解謎存檔（記憶體），稍後一起存到 Firestore
function recordQuestProgress() {
  if (!storyState || !storyState.quest) return;
  const q = window.quests.get(storyState.quest) || {};
  q.status = 'active';
  q.index = storyState.index;
  q.history = storyState.history.slice(-100);
  q.updated = todayKey();
  window.quests.set(storyState.quest, q);
  scheduleSave();
}
function saveQuestNow() {
  recordQuestProgress();
  save();
}

// 找節點；找不到回傳 null
function nodeIndex(name) {
  const v = storyState.variant;
  name = String(name || '').trim();
  if (!name) return null;
  if (v.nodes && name in v.nodes) return v.nodes[name];
  const i = v.lines.findIndex(l => l.node === name);
  return i >= 0 ? i : null;
}

function goTo(idx, pushHistory = true) {
  if (!storyState) return;
  const lines = storyState.variant.lines;
  let guard = 0;
  while (idx < lines.length && lines[idx].type === 'jump' && guard++ < 100) {
    const t = nodeIndex(lines[idx].param);
    if (t == null) console.warn(`[劇情] 找不到節點「${lines[idx].param}」（第 ${lines[idx].row} 列）`);
    idx = t == null ? idx + 1 : t;
  }
  if (idx >= lines.length) { finishStory(); return; }
  if (lines[idx].type === 'end' && !lines[idx].text) { endAt(lines[idx]); return; }

  if (pushHistory && storyState.index >= 0) storyState.history.push(storyState.index);
  storyState.index = idx;
  storyState.passed = false;
  storyState.wrong = 0;
  storyState.hintShown = 0;
  renderStoryLine();
  recordQuestProgress();
}

// 「結束」節點：參數寫「中斷」= 還沒真正開始（例如選了下次再說），不算完成
function endAt(line) {
  if (/中斷|abort/i.test(line.param || '')) abortStory();
  else finishStory();
}

function abortStory() {
  if (storyState && storyState.quest) {
    const q = window.quests.get(storyState.quest);
    // Firestore 合併寫入不會刪掉欄位，所以用狀態標記而不是 delete
    if (q && q.doneDate) Object.assign(q, { status: 'done', index: 0, history: [] });
    else window.quests.set(storyState.quest, { status: 'new', index: 0, history: [] });
    save();
  }
  closeStory({ keepProgress: true });
}

function finishStory() {
  if (!storyState) return;
  if (!storyState.quest) { closeStory(); return; }
  const q = window.quests.get(storyState.quest) || {};
  Object.assign(q, { status: 'done', index: 0, history: [], doneDate: todayKey(), updated: todayKey() });
  window.quests.set(storyState.quest, q);
  save();
  // 蓋一個「完成」印再關
  const seal = document.getElementById('story-seal');
  seal.textContent = '完成';
  seal.classList.remove('show'); void seal.offsetWidth; seal.classList.add('show');
  const st = storyState;
  st.finishing = true;
  setTimeout(() => { if (storyState === st) closeStory({ keepProgress: true }); }, 1600);
}

function isLastStep() {
  const { index, variant } = storyState;
  const l = curLine();
  if (l.type === 'end') return true;
  const next = variant.lines[index + 1];
  return !next || (next.type === 'end' && !next.text);
}

// 往回找最近一張指定的背景圖（道具列的圖片是道具圖示，不算背景）
function storyBgAt(index) {
  const { variant, spot } = storyState;
  for (let i = index; i >= 0; i--) {
    const l = variant.lines[i];
    if (l.image && l.type !== 'item') return resolveImage(l.image, spot);
  }
  return resolveImage(variant.background || 'past', spot);
}

function renderStoryLine() {
  stopOnsiteWatch();
  const line = curLine();
  const { index, variant } = storyState;

  const speaker = speakerOf(line);
  const spEl = document.getElementById('story-speaker');
  spEl.textContent = speaker;
  spEl.style.visibility = speaker ? 'visible' : 'hidden';
  document.getElementById('story-text').classList.toggle('narration', !speaker);

  document.getElementById('story-page').textContent = `${index + 1} / ${variant.lines.length}`;
  document.getElementById('story-prev').disabled = storyState.history.length === 0;
  const bg = storyBgAt(index);
  document.getElementById('story-bg').style.backgroundImage = `url("${bg}")`;
  renderCredit(document.getElementById('story-credit'), bg);

  // 史實標記：這句有填出處才顯示
  const fact = document.getElementById('story-fact');
  const hasSource = !!(line.source && line.source.length);
  fact.hidden = !hasSource;
  fact.setAttribute('aria-expanded', 'false');
  const srcPanel = document.getElementById('story-source');
  srcPanel.hidden = true;
  if (hasSource) {
    srcPanel.innerHTML = '<div class="story-source-title">📖 史料出處</div>';
    const ul = document.createElement('ul');
    line.source.forEach(src => ul.appendChild(sourceItem(src)));
    srcPanel.appendChild(ul);
    srcPanel.insertAdjacentHTML('beforeend', '<p class="story-source-note">未標記「史實」的台詞與角色為虛構敘事。</p>');
  }

  const box = document.getElementById('story-box');
  box.dataset.type = line.type;
  const interact = document.getElementById('story-interact');
  interact.innerHTML = '';

  switch (line.type) {
    case 'choice': renderChoice(line, interact); break;
    case 'ask':    renderAsk(line, interact); break;
    case 'onsite': renderOnsite(line, interact); break;
    case 'item':   renderItem(line, interact); break;
  }
  updateNextHint();

  // 道具：顯示說明文字；其他：顯示內容
  typeText(fillText(line.text));
}

function updateNextHint() {
  const line = curLine();
  const el = document.getElementById('story-next-hint');
  const waiting = ['choice', 'ask', 'onsite'].includes(line.type) && !storyState.passed;
  el.style.visibility = waiting ? 'hidden' : 'visible';
  el.textContent = isLastStep() ? '點擊結束 ■' : '點擊繼續 ▼';
}

/* ---------- 選擇 ---------- */
function renderChoice(line, box) {
  const opts = splitBar(line.param);
  if (!opts.length) { storyState.passed = true; return; }
  opts.forEach((o, i) => {
    const [label, target] = o.split(/>|＞/).map(s => s.trim());
    const b = document.createElement('button');
    b.className = 'story-choice';
    b.innerHTML = `<span class="story-choice-num">${i + 1}</span>${escapeHTML(fillText(label))}`;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const t = target ? nodeIndex(target) : null;
      if (target && t == null) console.warn(`[劇情] 找不到節點「${target}」`);
      goTo(t == null ? storyState.index + 1 : t);
    });
    box.appendChild(b);
  });
}

/* ---------- 問答／謎題 ---------- */
function normAnswer(s) {
  return String(s || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
}

function renderAsk(line, box) {
  const answers = splitBar(line.param);
  const pid = puzzleId(line);
  const already = window.solved.has(pid);

  box.innerHTML = `
    <form class="story-ask" autocomplete="off">
      <input type="text" class="story-input" placeholder="輸入答案" aria-label="答案" enterkeyhint="send" />
      <button type="submit" class="story-btn primary">送出</button>
    </form>
    <div class="story-hints" aria-live="polite"></div>
    <div class="story-ask-tools">
      ${line.hints.length ? '<button type="button" class="story-btn ghost" data-act="hint">💡 提示</button>' : ''}
      <button type="button" class="story-btn ghost" data-act="reveal" hidden>看答案</button>
      ${already ? '<span class="story-solved-note">你解開過這題了</span>' : ''}
    </div>`;

  const form = box.querySelector('form');
  const input = box.querySelector('input');
  const hintsEl = box.querySelector('.story-hints');
  const revealBtn = box.querySelector('[data-act="reveal"]');

  const showHint = () => {
    if (storyState.hintShown >= line.hints.length) return false;
    const p = document.createElement('p');
    p.textContent = `💡 ${fillText(line.hints[storyState.hintShown++])}`;
    hintsEl.appendChild(p);
    if (storyState.hintShown >= line.hints.length) {
      const hb = box.querySelector('[data-act="hint"]');
      if (hb) hb.hidden = true;
    }
    return true;
  };

  const pass = (revealed) => {
    storyState.passed = true;
    if (!revealed && !window.solved.has(pid)) window.solved.add(pid);
    saveQuestNow();
    form.innerHTML = `<div class="story-correct">${revealed ? '答案是' : '✓ 答對了！'}「${escapeHTML(answers[0] || '')}」</div>`;
    box.querySelector('.story-ask-tools').remove();
    updateNextHint();
    document.getElementById('story-box').focus();
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = normAnswer(input.value);
    if (!v) return;
    if (!answers.length || answers.some(a => normAnswer(a) === v)) { pass(false); return; }
    storyState.wrong++;
    input.classList.remove('shake'); void input.offsetWidth; input.classList.add('shake');
    input.select();
    showHint();
    if (storyState.wrong >= 3 && storyState.hintShown >= line.hints.length) revealBtn.hidden = false;
  });

  box.querySelector('[data-act="hint"]')?.addEventListener('click', () => {
    showHint();
    if (storyState.hintShown >= line.hints.length && storyState.wrong >= 1) revealBtn.hidden = false;
  });
  revealBtn.addEventListener('click', () => pass(true));

  if (already) { revealBtn.hidden = false; revealBtn.textContent = '直接看答案'; }
  setTimeout(() => input.focus({ preventScroll: true }), REDUCE_MOTION ? 0 : 300);
}

/* ---------- 現場關卡 ---------- */
let onsiteWatchId = null;
function stopOnsiteWatch() {
  if (onsiteWatchId != null && navigator.geolocation) navigator.geolocation.clearWatch(onsiteWatchId);
  onsiteWatchId = null;
}

/**
 * 現場關卡的參數：
 *   （空白）            神社座標
 *   緯度 經度 [半徑]     指定地點
 *   ……加上「隱藏」       不顯示距離與方向、解謎頁也不能導航（要玩家自己推理地點）
 */
function onsiteTarget(line, spot = storyState.spot) {
  const param = String(line.param || '');
  const hidden = /隱藏|hide/i.test(param);
  const nums = param.replace(/隱藏|hide/gi, ' ').split(/[\s,，]+/).filter(Boolean).map(Number).filter(n => !isNaN(n));
  if (nums.length >= 2) return { lat: nums[0], lng: nums[1], radius: nums[2] || ONSITE_DEFAULT_RADIUS, hidden, custom: true };
  return { lat: spot.lat, lng: spot.lng, radius: Math.max(spot.radius, ONSITE_DEFAULT_RADIUS), hidden, custom: false };
}

function renderOnsite(line, box) {
  const t = onsiteTarget(line);
  const pid = puzzleId(line);
  const already = window.solved.has(pid);

  box.innerHTML = `
    <div class="story-onsite">
      <div class="story-onsite-status" aria-live="polite">${t.hidden ? '找到地方之後，按「我到了」。' : '📡 正在確認你的位置…'}</div>
      <div class="story-ask-tools">
        <button type="button" class="story-btn primary" data-act="here">📍 我到了</button>
        ${already ? '<button type="button" class="story-btn ghost" data-act="skip">已完成過，繼續</button>' : ''}
        ${DEBUG ? '<button type="button" class="story-btn ghost" data-act="debug">🧪 略過</button>' : ''}
      </div>
      ${line.hints.length ? `<div class="story-hints">${line.hints.map(h => `<p>💡 ${escapeHTML(fillText(h))}</p>`).join('')}</div>` : ''}
    </div>`;
  const status = box.querySelector('.story-onsite-status');

  const pass = (record = true) => {
    stopOnsiteWatch();
    storyState.passed = true;
    if (record && !window.solved.has(pid)) { window.solved.add(pid); save(); }
    status.textContent = '✓ 抵達了';
    status.classList.add('ok');
    box.querySelector('.story-ask-tools').remove();
    updateNextHint();
    saveQuestNow();
    setTimeout(() => { if (storyState && curLine() === line) goTo(storyState.index + 1); }, 900);
  };

  let manual = false;
  const update = (lat, lng, acc) => {
    const d = haversine(lat, lng, t.lat, t.lng);
    // GPS 誤差大時放寬一點，避免站在原地進不去
    const slack = Math.min(acc || 0, 30);
    if (d <= t.radius + slack) { pass(); return true; }
    status.textContent = t.hidden
      ? (manual ? '好像還不是這裡。再想想線索指的是哪裡？' : '找到地方之後，按「我到了」。')
      : `距離目標約 ${fmtDist(d)}，往${dirName(bearing(lat, lng, t.lat, t.lng))}方走`;
    return false;
  };

  if (!navigator.geolocation) {
    status.textContent = '這個瀏覽器無法定位';
  } else {
    onsiteWatchId = navigator.geolocation.watchPosition(
      p => { rememberFix(p.coords); update(p.coords.latitude, p.coords.longitude, p.coords.accuracy); },
      err => { status.textContent = '無法取得位置：' + err.message; },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 }
    );
  }

  box.querySelector('[data-act="here"]').addEventListener('click', () => {
    manual = true;
    status.textContent = '📡 定位中…';
    getFix(
      f => update(f.lat, f.lng, f.acc),
      err => { status.textContent = '無法取得位置：' + err.message; },
      8000
    );
  });
  box.querySelector('[data-act="skip"]')?.addEventListener('click', () => pass(false));
  box.querySelector('[data-act="debug"]')?.addEventListener('click', () => pass(false));
}

/* ---------- 道具 ---------- */
function renderItem(line, box) {
  const name = (line.param || '').trim() || '神秘的東西';
  const isNew = !window.items.has(name);
  if (isNew) {
    window.items.set(name, {
      desc: fillText(line.text),
      spotId: storyState.spot.id,
      date: toDateKey(new Date()),
      image: line.image || '',
    });
    save();
  }
  box.innerHTML = `
    <div class="story-item ${isNew ? 'new' : ''}">
      <div class="story-item-icon">${line.image ? `<img src="${escapeHTML(line.image)}" alt="" onerror="this.replaceWith('🎁')">` : '🎁'}</div>
      <div>
        <div class="story-item-label">${isNew ? '獲得道具' : '已持有'}</div>
        <div class="story-item-name">${escapeHTML(name)}</div>
      </div>
    </div>`;
}

/* ---------- 打字效果 ---------- */
function typeText(text) {
  const el = document.getElementById('story-text');
  clearInterval(storyState.timer);
  storyState.full = text;

  if (REDUCE_MOTION || !text) {
    el.textContent = text;
    storyState.typing = false;
    return;
  }

  const chars = Array.from(text);
  let i = 0;
  el.textContent = '';
  storyState.typing = true;
  storyState.timer = setInterval(() => {
    i++;
    el.textContent = chars.slice(0, i).join('');
    if (i >= chars.length) {
      clearInterval(storyState.timer);
      storyState.typing = false;
    }
  }, TYPE_SPEED);
}

function advanceStory() {
  if (!storyState) return;
  if (storyState.typing) {
    clearInterval(storyState.timer);
    storyState.typing = false;
    document.getElementById('story-text').textContent = storyState.full;
    return;
  }
  const line = curLine();
  if (['choice', 'ask', 'onsite'].includes(line.type) && !storyState.passed) return;
  if (storyState.finishing) return;
  if (line.type === 'end') { endAt(line); return; }
  goTo(storyState.index + 1);
}

function prevStory() {
  if (!storyState || !storyState.history.length) return;
  goTo(storyState.history.pop(), false);
}

function closeStory({ keepProgress = false } = {}) {
  if (!storyState) return;
  const spot = storyState.spot;
  if (storyState.quest && !keepProgress && !storyState.finishing) { recordQuestProgress(); save(); }
  clearInterval(storyState.timer);
  stopOnsiteWatch();
  storyState = null;
  const overlay = document.getElementById('story');
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
  const seal = document.getElementById('story-seal');
  seal.classList.remove('show');
  seal.textContent = '解鎖';
  document.getElementById('story-source').hidden = true;
  if (currentModalSpot && currentModalSpot.id === spot.id) renderModalStories(spot);
  if (document.getElementById('tab-bag').classList.contains('active')) renderBag();
  if (document.getElementById('tab-quest').classList.contains('active')) renderQuests();

  if (pendingBadges.length) {
    const list = pendingBadges; pendingBadges = [];
    setTimeout(() => celebrateBadges(list), 300);
  }
}

/* ==========================================
   初始化：firebase.js 讀完玩家資料後呼叫
   ========================================== */

// 互動區（選項、輸入框）裡的點擊不要被當成「下一句」
document.getElementById('story-interact').addEventListener('click', (e) => {
  if (storyState && ['choice', 'ask', 'onsite'].includes(curLine().type)) e.stopPropagation();
});

// 出處文字：網址變成連結，其他照原樣
function sourceItem(src) {
  const li = document.createElement('li');
  const m = String(src).match(/https?:\/\/\S+/);
  if (!m) { li.textContent = src; return li; }
  const before = src.slice(0, m.index).trim();
  if (before) li.append(before + ' ');
  const a = document.createElement('a');
  a.href = m[0]; a.target = '_blank'; a.rel = 'noopener';
  try { a.textContent = new URL(m[0]).hostname + ' ↗'; } catch (e) { a.textContent = m[0]; }
  li.append(a);
  return li;
}

document.getElementById('story-fact').addEventListener('click', (e) => {
  e.stopPropagation();
  const panel = document.getElementById('story-source');
  panel.hidden = !panel.hidden;
  e.currentTarget.setAttribute('aria-expanded', String(!panel.hidden));
});
document.getElementById('story-source').addEventListener('click', e => e.stopPropagation());

/* ==========================================
   解謎頁
   ========================================== */

function allQuests() {
  const out = [];
  for (const spot of SPOTS) {
    const st = STORIES[spot.id];
    if (!st) continue;
    for (const v of st.variants) if (v.lines.length && isQuestVariant(v)) out.push({ spot, v });
  }
  return out;
}

function questInfo(spot, v, date = getStoryDate()) {
  const key = storyKey(spot.id, v);
  const q = window.quests.get(key);
  const state = q && q.status === 'active' ? 'active' : q && q.status === 'done' ? 'done' : 'new';
  const pick = type => v.lines.map((l, i) => ({ l, i })).filter(x => x.l.type === type);
  const onsites = pick('onsite'), asks = pick('ask');
  const solvedN = list => list.filter(x => window.solved.has(puzzleIdFor(spot.id, v, x.l))).length;
  const pos = state === 'active' ? q.index : 0;
  // 下一個還沒到過的現場
  const next = onsites.find(x => x.i >= pos && !window.solved.has(puzzleIdFor(spot.id, v, x.l)))
            || (state !== 'done' ? onsites.find(x => x.i >= pos) : null);
  const target = next ? onsiteTarget(next.l, spot) : null;
  return {
    key, q, state,
    available: state === 'active' || matchWhen(v.when, date, gameCtx()),
    onsite: [solvedN(onsites), onsites.length],
    ask: [solvedN(asks), asks.length],
    pct: state === 'done' ? 100 : state === 'active' ? Math.round((q.index / v.lines.length) * 100) : 0,
    target: target && !target.hidden ? target : null,
    targetHidden: !!(target && target.hidden),
  };
}

// 打卡時：這間神社有哪些現在能玩的解謎
function availableQuestsAt(spot, date) {
  return allQuests().filter(x => x.spot.id === spot.id)
    .map(x => ({ ...x, info: questInfo(x.spot, x.v, date) }))
    .filter(x => x.info.available && x.info.state !== 'done');
}

function showQuestHint(list) {
  const el = document.getElementById('quest-hint');
  if (!el) return;
  el.innerHTML = '';
  el.hidden = !list.length;
  if (!list.length) return;
  const p = document.createElement('p');
  p.textContent = `🧩 這裡有解謎任務：${list.map(x => '「' + x.v.title + '」').join('')}`;
  const b = document.createElement('button');
  b.className = 'story-btn primary';
  b.textContent = list.length === 1 ? (list[0].info.state === 'active' ? '繼續解謎' : '開始解謎') : '前往解謎頁';
  b.addEventListener('click', () => {
    if (list.length === 1) openStory(list[0].spot, list[0].v);
    else switchTab('quest');
  });
  el.append(p, b);
}

function renderQuests() {
  const listEl = document.getElementById('quest-list');
  const empty = document.getElementById('quest-empty');
  if (!listEl) return;
  listEl.innerHTML = '';
  const date = getStoryDate();
  const order = { active: 0, new: 1, locked: 2, done: 3 };
  const items = allQuests().map(x => {
    const info = questInfo(x.spot, x.v, date);
    const group = info.state === 'new' && !info.available ? 'locked' : info.state;
    return { ...x, info, group };
  }).sort((a, b) => order[a.group] - order[b.group]);

  empty.style.display = items.length ? 'none' : 'block';
  const doneN = items.filter(x => x.info.q && x.info.q.doneDate).length;
  document.getElementById('quest-summary').textContent =
    items.length ? `完成 ${doneN} / ${items.length} 個任務` : '';

  for (const { spot, v, info, group } of items) {
    const card = document.createElement('article');
    card.className = `quest-card ${group}`;
    const tag = { active: '進行中', new: '未開始', locked: '尚未開放', done: '✓ 已完成' }[group];
    const when = describeWhen(v.when);
    card.innerHTML = `
      <div class="quest-head">
        <div class="quest-thumb"><img src="${spot.imagePast}" alt="" loading="lazy" onerror="this.replaceWith('⛩️')"></div>
        <div class="quest-head-text">
          <div class="quest-spot">${escapeHTML(spot.name)}・${spot.category}</div>
          <div class="quest-title">${escapeHTML(v.title)}</div>
        </div>
        <span class="quest-tag">${tag}</span>
      </div>
      <div class="quest-meta">
        ${info.onsite[1] ? `<span>📍 現場 ${info.onsite[0]}/${info.onsite[1]}</span>` : ''}
        ${info.ask[1] ? `<span>🧩 謎題 ${info.ask[0]}/${info.ask[1]}</span>` : ''}
        ${info.q && info.q.updated && group === 'active' ? `<span>上次 ${fmtDateKey(info.q.updated)}</span>` : ''}
        ${info.q && info.q.doneDate ? `<span>完成於 ${fmtDateKey(info.q.doneDate)}</span>` : ''}
      </div>
      ${group !== 'locked' ? `<div class="quest-bar"><i style="width:${info.pct}%"></i></div>` : ''}
      ${group === 'locked' ? `<div class="quest-lock">🔒 開放條件：${escapeHTML(when)}</div>` : ''}
      ${info.targetHidden && group !== 'done' ? '<div class="quest-lock">🔍 下一個地點要靠線索推理</div>' : ''}
      <div class="quest-actions"></div>`;

    const actions = card.querySelector('.quest-actions');
    const btn = (label, cls, fn) => {
      const b = document.createElement('button');
      b.className = 'story-btn ' + cls;
      b.textContent = label;
      b.addEventListener('click', fn);
      actions.appendChild(b);
    };
    if (group === 'active') {
      btn('▶ 繼續', 'primary', () => openStory(spot, v));
    } else if (group === 'new') {
      btn('▶ 開始', 'primary', () => openStory(spot, v));
    } else if (group === 'done') {
      btn('↻ 再玩一次', 'ghost', () => openStory(spot, v, { restart: true }));
    }
    if (info.target && group !== 'done' && group !== 'locked') {
      btn(info.state === 'active' ? '🧭 前往下一個地點' : '🧭 前往起點', 'ghost', () => {
        switchTab('gps');
        setRadarTarget({ lat: info.target.lat, lng: info.target.lng, radius: info.target.radius,
                         name: `${v.title}・${info.target.custom ? '任務地點' : spot.name}` });
        if (radar.watchId == null) toggleRadar();
        document.getElementById('tab-gps').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
    if (group === 'active') {
      btn('從頭開始', 'ghost', () => {
        if (confirm(`要從頭開始「${v.title}」嗎？目前的進度會清除（已解開的謎題紀錄會保留）。`)) {
          openStory(spot, v, { restart: true });
        }
      });
    }
    listEl.appendChild(card);
  }
}

window.onGameDataLoaded = async function () {
  await spotsReady;
  renderGallery();
  fillRadarTargets();
  await storiesReady;
  renderGallery(); // 劇情標記
  // 首頁「迷走神界」入口：登入並載入玩家與劇情資料後直達解謎。
  if (new URLSearchParams(location.search).get('tab') === 'quest') {
    switchTab('quest');
  }
  // 舊玩家：之前就已經集齊的，補發徽章
  const fresh = checkBadges(new Date());
  if (fresh.length) { renderGallery(); await save(); celebrateBadges(fresh); }
};
