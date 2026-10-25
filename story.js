/**
 * story.js — 從 stories/ 資料夾讀取各神社的劇情 CSV
 * ============================================================
 * 檔案結構：
 *   stories/index.csv      哪些神社有劇情（編號, 檔案, 預設說話者）
 *   stories/101.csv        臺北稻荷神社的劇情
 *   stories/xxx.csv        ...每間神社一個檔案
 *
 * CSV 欄位與寫法請看「劇情CSV格式說明.md」。
 * 這個檔案只負責：讀檔 → 轉成劇情物件 → 判斷今天播哪一段。
 * 寫劇情時不需要改這裡。
 */

const STORY_DIR = 'stories/';
const STORIES = {};               // { 神社編號: { speaker, file, variants: [...] } }
let _storiesReady;
const storiesReady = new Promise(r => { _storiesReady = r; });

const CN_MONTHS = ['一月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','十二月'];

/* ------------------------------------------------------------
   類型名稱（中英都可以寫）
   ------------------------------------------------------------ */
const NODE_TYPES = {
  '': 'say', '台詞': 'say', '對白': 'say', 'say': 'say',
  '選擇': 'choice', 'choice': 'choice',
  '問答': 'ask', '謎題': 'ask', 'ask': 'ask',
  '現場': 'onsite', 'onsite': 'onsite',
  '道具': 'item', 'item': 'item',
  '跳轉': 'jump', 'jump': 'jump',
  '結束': 'end', 'end': 'end',
};

const splitBar = (s) => String(s || '').split(/[|｜]/).map(x => x.trim()).filter(Boolean);

// 文字裡的 \n 轉成真正的換行（兩種寫法都可以）
const unescapeText = (s) => String(s || '').replace(/\\n/g, '\n');

/* ------------------------------------------------------------
   觸發條件：「每月=25; 月份=10」這種寫法 → when 物件
   ------------------------------------------------------------ */
function parseWhen(str) {
  str = String(str || '').trim();
  if (!str) return null;
  const when = {};
  for (const raw of str.split(/[;；]/)) {
    const part = raw.trim();
    if (!part) continue;
    const [k, v = ''] = part.split(/[=＝]/).map(x => x.trim());
    const nums = () => splitBar(v).map(Number).filter(n => !isNaN(n));
    switch (k) {
      case '日期': case 'date':   when.dates = splitBar(v).map(d => d.replace(/\//g, '-').replace(/-0/g, '-').replace(/^0/, '')); break;
      case '每月': case 'day':    when.day = nums(); break;
      case '月份': case 'month':  when.months = nums(); break;
      case '初午': case 'hatsuuma': when.hatsuuma = true; break;
      case '需道具': case 'item': when.items = splitBar(v); break;
      case '需集章': case 'stamp': when.stamps = nums(); break;
      case '星期': case 'weekday': when.weekdays = nums(); break; // 0=日 1=一 … 6=六
      default: console.warn(`[劇情] 看不懂的觸發條件「${part}」`);
    }
  }
  return Object.keys(when).length ? when : null;
}

/* ------------------------------------------------------------
   一個劇情 CSV → variants 陣列
   ------------------------------------------------------------ */
function parseStoryCSV(text, defaultSpeaker = '', fileName = '') {
  const rows = csvToObjects(text);
  const variants = [];
  const byKey = {};

  rows.forEach((r, i) => {
    const key = r['劇情代號'];
    if (!key) return;
    let v = byKey[key];
    if (!v) {
      v = byKey[key] = { key, title: '', when: null, speaker: defaultSpeaker, lines: [] };
      variants.push(v);
    }
    if (!v.title && r['標題']) v.title = r['標題'];
    if (!v.when && r['觸發']) v.when = parseWhen(r['觸發']);

    const typeRaw = (r['類型'] || '').trim();
    const type = NODE_TYPES[typeRaw];
    if (!type) { console.warn(`[劇情] ${fileName} 第 ${i + 2} 列：看不懂的類型「${typeRaw}」`); return; }

    const text = unescapeText(r['內容']);
    const param = (r['參數'] || '').trim();
    // 台詞沒有內容 → 只是佔位（例如還沒寫的祭典），略過
    if (type === 'say' && !text && !r['圖片']) return;

    v.lines.push({
      type,
      node: (r['節點'] || '').trim(),
      speaker: r['說話者'] || '',
      text,
      image: (r['圖片'] || '').trim(),
      param,
      hints: splitBar(r['提示']).map(unescapeText),
      row: i + 2, // CSV 第幾列，除錯用
    });
  });

  for (const v of variants) {
    if (!v.title) v.title = v.key;
    v.nodes = {};
    v.lines.forEach((l, idx) => { if (l.node) v.nodes[l.node] = idx; });
  }
  return variants;
}

/* ------------------------------------------------------------
   載入 stories/index.csv 與各檔案
   ------------------------------------------------------------ */
async function loadAllStories() {
  let index = [];
  try {
    index = csvToObjects(await fetchCSVText(STORY_DIR + 'index.csv'));
  } catch (e) {
    console.warn('[劇情] 找不到 stories/index.csv，所有神社都視為「沒有劇情」', e);
  }

  await Promise.all(index.map(async (r) => {
    const id = parseInt(r['編號'], 10);
    if (isNaN(id)) return;
    const file = r['檔案'] || `${id}.csv`;
    const speaker = r['預設說話者'] || '';
    try {
      const text = await fetchCSVText(STORY_DIR + file);
      STORIES[id] = { speaker, file, variants: parseStoryCSV(text, speaker, file) };
    } catch (e) {
      console.warn(`[劇情] ${file} 讀取失敗`, e);
    }
  }));

  _storiesReady(STORIES);
}
loadAllStories();

/* ============================================================
   日期工具
   ============================================================ */

// 今天的日期；測試時可在網址加 ?date=2026-10-25 假裝是那一天
function getStoryDate() {
  const q = new URLSearchParams(location.search).get('date');
  if (q && /^\d{4}-\d{1,2}-\d{1,2}$/.test(q)) {
    const [y, m, d] = q.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date();
}

function toDateKey(date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}
function fromDateKey(key) {
  const [y, m, d] = String(key).split('-').map(Number);
  return y ? new Date(y, m - 1, d) : new Date();
}

// 農曆月日（用瀏覽器內建的農曆）
function lunarInfo(date) {
  try {
    const parts = new Intl.DateTimeFormat('en-u-ca-chinese', { month: 'numeric', day: 'numeric' })
      .formatToParts(date);
    const m = parts.find(p => p.type === 'month').value;
    const d = parts.find(p => p.type === 'day').value;
    return { month: parseInt(m, 10), leap: /bis/.test(m), day: parseInt(d, 10) };
  } catch (e) {
    return null;
  }
}

// 日地支：0=子 … 6=午 … 11=亥（以 1949-10-01 甲子日為基準）
function dayBranch(date) {
  const n = Math.round(
    (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(1949, 9, 1)) / 86400000
  );
  return (((n % 60) + 60) % 60) % 12;
}

// 農曆二月的第一個午日
function isHatsuuma(date) {
  const l = lunarInfo(date);
  return !!l && l.month === 2 && !l.leap && l.day <= 12 && dayBranch(date) === 6;
}

/* ============================================================
   觸發判斷
   ctx = { items: Map, collected: Set }
   ============================================================ */

function matchWhen(when, date, ctx = {}) {
  if (!when) return true;
  const m = date.getMonth() + 1, d = date.getDate();
  if (when.dates && !when.dates.includes(`${m}-${d}`)) return false;
  if (when.day && when.day.length && !when.day.includes(d)) return false;
  if (when.months && !when.months.includes(m)) return false;
  if (when.weekdays && !when.weekdays.includes(date.getDay())) return false;
  if (when.hatsuuma && !isHatsuuma(date)) return false;
  if (when.items && !when.items.every(it => ctx.items && ctx.items.has(it))) return false;
  if (when.stamps && !when.stamps.every(id => ctx.collected && ctx.collected.has(id))) return false;
  return true;
}

function storyPriority(when) {
  if (!when) return 0;
  let p = 0;
  if (when.dates || when.hatsuuma) p = 3;
  else if (when.day) p = 2;
  else if (when.months || when.weekdays) p = 1;
  // 需要道具／集章的劇情是解謎的獎勵，同順位時優先
  if (when.items || when.stamps) p += 0.5;
  return p;
}

function storyKey(spotId, variant) {
  return `${spotId}:${variant.key}`;
}

function hasWrittenStories(spotId) {
  const s = STORIES[spotId];
  return !!s && s.variants.some(v => v.lines.length);
}

// 這個神社所有「已寫好」的劇情（含玩家已解鎖的 AI 劇情）
function getStoryVariants(spotId) {
  const s = STORIES[spotId];
  const written = s ? s.variants.filter(v => v.lines.length) : [];
  const ai = [];
  if (window.aiStories) {
    for (const [k, v] of window.aiStories) {
      if (k.startsWith(spotId + ':')) ai.push(v);
    }
  }
  return written.concat(ai);
}

// 選出今天要播放的劇情；沒有就回傳 null
function pickStoryVariant(spotId, date, unlocked, ctx = {}) {
  const s = STORIES[spotId];
  if (!s) return null;
  const matched = s.variants.filter(v => v.lines.length && matchWhen(v.when, date, ctx));
  if (!matched.length) return null;
  const top = Math.max(...matched.map(v => storyPriority(v.when)));
  const cands = matched.filter(v => storyPriority(v.when) === top);
  const fresh = cands.find(v => !unlocked.has(storyKey(spotId, v)));
  return fresh || cands[date.getMonth() % cands.length];
}

if (typeof module !== 'undefined') {
  module.exports = { parseStoryCSV, parseWhen, matchWhen, storyPriority, pickStoryVariant, STORIES };
}
