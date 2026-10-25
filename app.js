/**
 * app.js — 集章圖鑑主程式（Firebase 版）
 * 功能：分類篩選、過去/現在圖片、GPS 打卡、尋路雷達、
 *       互動劇情（選擇／問答／現場關卡／道具）、行囊、徽章、AI 劇情
 *
 * 網址參數（測試用）：
 *   ?date=2026-10-25   假裝是那一天
 *   ?debug=1           在神社詳情出現「模擬在此打卡」，現場關卡可略過
 */

if (!window.collected) window.collected = new Set();
if (!window.unlockedStories) window.unlockedStories = new Map(); // 'spotId:key' → 'YYYY-M-D'
if (!window.items) window.items = new Map();                     // 道具名 → { desc, spotId, date }
if (!window.solved) window.solved = new Set();                   // 解開的謎題／現場關卡
if (!window.aiStories) window.aiStories = new Map();             // 'spotId:ai-日期' → variant

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

async function save() {
  if (window.saveProgress) {
    try { await window.saveProgress(); } catch (e) { console.error('儲存失敗', e); }
  }
}

/* ==========================================
   分類篩選
   ========================================== */

function setFilter(filter) {
  currentFilter = filter;
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === filter);
  });
  renderGallery();
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

function switchTab(tabName) {
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  document.querySelectorAll('.section').forEach((sec) => sec.classList.remove('active'));
  document.getElementById('tab-' + tabName).classList.add('active');
  if (tabName === 'collected') renderCollected();
  if (tabName === 'bag') renderBag();
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

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude: lat, longitude: lng } = pos.coords;
      showCoords(lat, lng, pos.coords.accuracy);
      dot.className = 'status-dot active';
      txt.textContent = '定位成功';
      btn.disabled = false;
      processCheckIn(lat, lng);
    },
    (err) => { showGpsError('無法取得位置：' + err.message); btn.disabled = false; },
    { enableHighAccuracy: true, timeout: 12000 }
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
    ['官社', '縣社', '鄉社', '未分類'].map(cat => {
      const list = SPOTS.filter(s => s.category === cat);
      if (!list.length) return '';
      return `<optgroup label="${cat}">` + list.map(s =>
        `<option value="${s.id}">${window.collected.has(s.id) ? '✓ ' : ''}${escapeHTML(s.name)}</option>`).join('') + '</optgroup>';
    }).join('');
  sel.value = [...sel.options].some(o => o.value === keep) ? keep : 'auto';
}

function setRadarTarget(value) {
  radar.target = value;
  radar.lastDist = null;
  const sel = document.getElementById('radar-target');
  if (sel && typeof value !== 'object') { fillRadarTargets(); sel.value = String(value); }
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

function onOrientation(e) {
  let h = null;
  if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;
  else if (e.absolute && e.alpha != null) h = (360 - e.alpha) % 360;
  if (h == null) return;
  radar.heading = h;
  drawRadar();
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
  arrow.style.transform = `rotate(${b - h}deg)`;
  dial.style.setProperty('--north', `${-h}deg`);
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

  // 1. 先找作者寫好的劇情
  let variant = pickStoryVariant(spot.id, date, window.unlockedStories, gameCtx());

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
  } else if (!variant && getStoryVariants(spot.id).length) {
    banner.textContent += '\n今天這裡很安靜。換個日子再來看看吧。';
  }
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

function puzzleId(line) {
  const { spot, variant } = storyState;
  return `${spot.id}:${variant.key}:${line.node || 'r' + line.row}`;
}

function openStory(spot, variant, opts = {}) {
  if (!variant || !variant.lines.length) return false;
  stopOnsiteWatch();
  storyState = {
    spot, variant,
    date: opts.date || getStoryDate(),
    index: -1, history: [],
    typing: false, timer: null, full: '',
    passed: false, // 目前這個互動節點是否已通過
    wrong: 0, hintShown: 0,
  };

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

  goTo(0, false);
  return true;
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
  if (idx >= lines.length || (lines[idx].type === 'end' && !lines[idx].text)) { closeStory(); return; }

  if (pushHistory && storyState.index >= 0) storyState.history.push(storyState.index);
  storyState.index = idx;
  storyState.passed = false;
  storyState.wrong = 0;
  storyState.hintShown = 0;
  renderStoryLine();
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
  document.getElementById('story-bg').style.backgroundImage = `url("${storyBgAt(index)}")`;

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
    if (!revealed && !window.solved.has(pid)) { window.solved.add(pid); save(); }
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

function onsiteTarget(line) {
  const nums = String(line.param || '').split(/[\s,，]+/).map(Number).filter(n => !isNaN(n));
  const spot = storyState.spot;
  if (nums.length >= 2) return { lat: nums[0], lng: nums[1], radius: nums[2] || ONSITE_DEFAULT_RADIUS };
  return { lat: spot.lat, lng: spot.lng, radius: Math.max(spot.radius, ONSITE_DEFAULT_RADIUS) };
}

function renderOnsite(line, box) {
  const t = onsiteTarget(line);
  const pid = puzzleId(line);
  const already = window.solved.has(pid);

  box.innerHTML = `
    <div class="story-onsite">
      <div class="story-onsite-status" aria-live="polite">📡 正在確認你的位置…</div>
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
    setTimeout(() => { if (storyState && curLine() === line) goTo(storyState.index + 1); }, 900);
  };

  const update = (lat, lng, acc) => {
    const d = haversine(lat, lng, t.lat, t.lng);
    // GPS 誤差大時放寬一點，避免站在原地進不去
    const slack = Math.min(acc || 0, 30);
    if (d <= t.radius + slack) { pass(); return true; }
    status.textContent = `距離目標約 ${fmtDist(d)}，往${dirName(bearing(lat, lng, t.lat, t.lng))}方走`;
    return false;
  };

  if (!navigator.geolocation) {
    status.textContent = '這個瀏覽器無法定位';
  } else {
    onsiteWatchId = navigator.geolocation.watchPosition(
      p => update(p.coords.latitude, p.coords.longitude, p.coords.accuracy),
      err => { status.textContent = '無法取得位置：' + err.message; },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 }
    );
  }

  box.querySelector('[data-act="here"]').addEventListener('click', () => {
    status.textContent = '📡 定位中…';
    navigator.geolocation?.getCurrentPosition(
      p => update(p.coords.latitude, p.coords.longitude, p.coords.accuracy),
      err => { status.textContent = '無法取得位置：' + err.message; },
      { enableHighAccuracy: true, timeout: 12000 }
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
  if (line.type === 'end') { closeStory(); return; }
  goTo(storyState.index + 1);
}

function prevStory() {
  if (!storyState || !storyState.history.length) return;
  goTo(storyState.history.pop(), false);
}

function closeStory() {
  if (!storyState) return;
  const spot = storyState.spot;
  clearInterval(storyState.timer);
  stopOnsiteWatch();
  storyState = null;
  const overlay = document.getElementById('story');
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
  document.getElementById('story-seal').classList.remove('show');
  if (currentModalSpot && currentModalSpot.id === spot.id) renderModalStories(spot);
  if (document.getElementById('tab-bag').classList.contains('active')) renderBag();

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

window.onGameDataLoaded = async function () {
  await spotsReady;
  renderGallery();
  fillRadarTargets();
  await storiesReady;
  renderGallery(); // 劇情標記
  // 舊玩家：之前就已經集齊的，補發徽章
  const fresh = checkBadges(new Date());
  if (fresh.length) { renderGallery(); await save(); celebrateBadges(fresh); }
};
