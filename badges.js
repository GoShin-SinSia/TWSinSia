/**
 * badges.js — 徽章
 * 想加新徽章：在 BADGES 加一項即可。
 *   spots(SPOTS) 回傳「需要集齊的神社」，全部集到就獲得徽章
 *   featured: true 的徽章會在圖鑑頁以大尺寸展示
 */

const BADGES = [
  {
    id: 'guan-all',
    name: '官社巡禮',
    seal: '官社',
    desc: '集齊所有官社的御朱印',
    icon: '🏯',
    spots: (all) => all.filter(s => s.category === '官社'),
  },
  {
    id: 'xian-all', name: '縣社巡禮', seal: '縣社', desc: '集齊所有縣社', icon: '⛩',
    spots: (all) => all.filter(s => s.category === '縣社'),
  },
  {
    id: 'xiang-all', name: '鄉社巡禮', seal: '鄉社', desc: '集齊所有鄉社', icon: '🏮',
    spots: (all) => all.filter(s => s.category === '鄉社'),
  },
  {
    id: 'all', name: '神社巡禮', seal: '神社\n巡禮', desc: '集齊全部36座神社御朱印', icon: '🗾',
    featured: true,
    spots: (all) => all,
  },
];

if (!window.earnedBadges) window.earnedBadges = new Map(); // id → 'YYYY-M-D'

function badgeProgress(badge) {
  const need = badge.spots(SPOTS);
  const have = need.filter(s => window.collected.has(s.id)).length;
  return { have, total: need.length, done: need.length > 0 && have === need.length };
}

// 檢查有沒有新獲得的徽章，回傳新徽章陣列
function checkBadges(date = new Date()) {
  const fresh = [];
  for (const b of BADGES) {
    if (window.earnedBadges.has(b.id)) continue;
    if (badgeProgress(b).done) {
      window.earnedBadges.set(b.id, toDateKey(date));
      fresh.push(b);
    }
  }
  return fresh;
}

function renderBadgeShelf() {
  const shelf = document.getElementById('badge-shelf');
  if (!shelf || !SPOTS.length) return;
  shelf.innerHTML = '';

  // 沒有任何神社屬於這個徽章（例如資料裡沒有縣社）就不顯示
  const shown = BADGES.filter(b => b.spots(SPOTS).length > 0);
  const featured = shown.filter(b => b.featured);
  const others = shown.filter(b => !b.featured);
  const filters = { all: 'all', 'guan-all': '官社', 'xian-all': '縣社', 'xiang-all': '鄉社' };
  const connectFilter = (el, b, p) => {
    const filter = filters[b.id];
    el.type = 'button';
    el.dataset.filter = filter;
    el.classList.toggle('selected', currentFilter === filter);
    el.setAttribute('aria-pressed', String(currentFilter === filter));
    el.setAttribute('aria-label', `${b.name}：${p.have}/${p.total}，顯示${filter === 'all' ? '全部神社' : filter}`);
    el.addEventListener('click', () => setFilter(filter));
  };

  for (const b of featured) {
    const p = badgeProgress(b);
    const earned = window.earnedBadges.has(b.id);
    const pct = p.total ? Math.round((p.have / p.total) * 100) : 0;
    const el = document.createElement('button');
    el.className = `badge-feature ${earned ? 'earned' : 'locked'}`;
    el.style.setProperty('--pct', pct);
    el.setAttribute('aria-label', `${b.name}：${earned ? '已獲得' : `${p.have}/${p.total}`}`);
    el.innerHTML = `
      <div class="badge-seal" aria-hidden="true"><span>${b.seal.replace('\n', '<br>')}</span></div>
      <div class="badge-info">
        <div class="badge-name">${b.icon} ${b.name}</div>
        <div class="badge-desc">${b.desc}・${p.have}/${p.total}</div>
        <div class="badge-bar" aria-hidden="true"><i style="width:${pct}%"></i></div>
      </div>`;
    connectFilter(el, b, p);
    shelf.appendChild(el);
  }

  const row = document.createElement('div');
  row.className = 'badge-row';
  for (const b of others) {
    const p = badgeProgress(b);
    const earned = window.earnedBadges.has(b.id);
    const chip = document.createElement('button');
    chip.className = `badge-chip ${earned ? 'earned' : 'locked'}`;
    const pct = p.total ? (p.have / p.total) * 100 : 0;
    chip.style.setProperty('--progress', `${pct}%`);
    chip.innerHTML = `
      <span class="badge-chip-head"><span class="badge-category">${b.seal}</span><span class="badge-icon" aria-hidden="true">${b.icon}</span><span class="badge-count">${p.have}/${p.total}</span></span>`;
    chip.title = `顯示${filters[b.id]}・${b.desc}`;
    chip.setAttribute('aria-label', `${b.name}：${earned ? '已獲得' : `${p.have}/${p.total}`}`);
    connectFilter(chip, b, p);
    row.appendChild(chip);
  }
  shelf.appendChild(row);
  const selectedBadge = shown.find(b => filters[b.id] === currentFilter);
  if (selectedBadge) {
    const detail = document.createElement('button');
    detail.type = 'button';
    detail.className = 'badge-detail-link';
    detail.textContent = '集章提示';
    detail.setAttribute('aria-label', `${selectedBadge.name}・集章提示`);
    detail.addEventListener('click', () => showBadgeDetail(selectedBadge));
    shelf.appendChild(detail);
  }
}

function fmtDateKey(k) {
  const d = fromDateKey(k);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

// 點徽章：顯示還差哪些神社
function showBadgeDetail(b) {
  const need = b.spots(SPOTS);
  const missing = need.filter(s => !window.collected.has(s.id));
  const earned = window.earnedBadges.has(b.id);
  openBadgePopup(b, {
    title: b.name,
    text: earned
      ? `${fmtDateKey(window.earnedBadges.get(b.id))} 達成。${b.desc}。`
      : `${b.desc}。還差 ${missing.length} 間：\n` + missing.map(s => `・${s.name}`).join('\n'),
    earned,
  });
}

// 新獲得時的慶祝畫面
function celebrateBadges(list) {
  if (!list.length) return;
  const [first, ...rest] = list;
  openBadgePopup(first, {
    title: `獲得徽章「${first.name}」`,
    text: first.desc + '！\n徽章已放進圖鑑頁。',
    earned: true, celebrate: true,
    onClose: () => celebrateBadges(rest),
  });
}

let _badgeOnClose = null;
function openBadgePopup(b, { title, text, earned, celebrate, onClose }) {
  const pop = document.getElementById('badge-popup');
  pop.querySelector('.badge-pop-seal').innerHTML = `<span>${b.seal.replace('\n', '<br>')}</span>`;
  pop.querySelector('.badge-pop-seal').className = `badge-pop-seal ${earned ? 'earned' : 'locked'} ${celebrate ? 'stamp-in' : ''}`;
  pop.querySelector('.badge-pop-title').textContent = title;
  pop.querySelector('.badge-pop-text').textContent = text;
  pop.classList.add('open');
  _badgeOnClose = onClose || null;
  pop.querySelector('.badge-pop-close').focus();
}
function closeBadgePopup() {
  document.getElementById('badge-popup').classList.remove('open');
  const cb = _badgeOnClose; _badgeOnClose = null;
  if (cb) setTimeout(cb, 250);
}
