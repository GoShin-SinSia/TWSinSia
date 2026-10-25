/**
 * ai.js — AI 劇情接口
 * ============================================================
 * 只有「還沒在 stories/index.csv 登記劇情」的神社會用到。
 * 玩家在這些神社打卡成功時，會向 AI 要一段劇情。
 *
 * 三種模式（改 AI_CONFIG.mode）：
 *   'off'       關閉：沒劇情的神社就只集章
 *   'mock'      假資料：不連網，用神社說明自動拼一段，方便測試畫面
 *   'endpoint'  連到你自己的後端（例如 ai-proxy.gs 部署成的 Apps Script 網址）
 *
 * ⚠️ 不要把任何 AI 的 API key 寫在這個檔案裡——網頁原始碼誰都看得到。
 *    API key 放在後端（Apps Script 的「指令碼屬性」），這裡只放後端網址。
 *
 * 想完全自己接（例如改用 Firebase Functions），可以覆寫：
 *   window.GoShinAI.generate = async (spot, date, context) => ({ title, speaker, lines })
 * ============================================================
 */

const AI_CONFIG = {
  mode: 'mock',          // 'off' | 'mock' | 'endpoint'
  endpoint: '',          // 例：'https://script.google.com/macros/s/xxxx/exec'
  timeoutMs: 25000,
  speaker: '神社的守護者', // AI 沒給說話者時使用
  label: 'AI 生成・內容未經人工審核',
};

/* ------------------------------------------------------------
   後端會收到的資料（POST，JSON 字串）
   ------------------------------------------------------------ */
function buildAIRequest(spot, date, context = {}) {
  return {
    version: 1,
    spot: {
      id: spot.id,
      name: spot.name,
      newName: spot.new_name || '',
      category: spot.category,
      address: spot.address || '',
      startYear: spot.startYear || '',
      endYear: spot.endYear || '',
      description: spot.description || '',
    },
    date: toDateKey(date),
    month: CN_MONTHS[date.getMonth()],
    // 讓 AI 知道玩家進度，可以寫出呼應的內容（不含任何個人資料）
    progress: {
      collectedCount: context.collected ? context.collected.size : 0,
      items: context.items ? [...context.items.keys()] : [],
    },
  };
}

/* ------------------------------------------------------------
   後端可以回傳的格式（擇一）：
   A. JSON：{ "title": "...", "speaker": "...", "lines": [ ... ] }
      lines 每一項可以是字串，或
      { "type": "台詞|選擇|問答|現場|道具", "speaker": "", "text": "",
        "image": "past|now", "param": "", "hints": ["", ""] }
      （欄位意思和劇情 CSV 一樣）
   B. JSON：{ "title": "...", "csv": "劇情代號,標題,...（整份 CSV 文字）" }
   C. 直接回傳 CSV 文字（Content-Type 不是 JSON 時）
   ------------------------------------------------------------ */
function normalizeAIResponse(data, spot) {
  if (typeof data === 'string') data = { csv: data };
  if (data && data.error) throw new Error(data.error);

  let title = data.title || '偶然的相遇';
  let speaker = data.speaker || AI_CONFIG.speaker;
  let lines = [];

  if (data.csv) {
    const vs = parseStoryCSV(data.csv, speaker, 'AI');
    if (!vs.length) throw new Error('AI 回傳的 CSV 沒有內容');
    title = data.title || vs[0].title;
    lines = vs[0].lines;
  } else if (Array.isArray(data.lines)) {
    lines = data.lines.map((l, i) => {
      if (typeof l === 'string') l = { text: l };
      const type = NODE_TYPES[String(l.type || '').trim()] || 'say';
      return {
        type,
        node: l.node || '',
        speaker: l.speaker || '',
        text: unescapeText(l.text || ''),
        image: l.image || '',
        param: Array.isArray(l.param) ? l.param.join('|') : String(l.param || ''),
        hints: Array.isArray(l.hints) ? l.hints.map(String) : splitBar(l.hints),
        row: i + 1,
      };
    }).filter(l => l.text || l.type !== 'say');
  }

  if (!lines.length) throw new Error('AI 沒有回傳任何台詞');
  const nodes = {};
  lines.forEach((l, i) => { if (l.node) nodes[l.node] = i; });
  return { title, speaker, lines, nodes };
}

/* ------------------------------------------------------------
   mock：不連網，拼一段簡單的劇情＋一題問答
   ------------------------------------------------------------ */
function mockAIStory(spot, date) {
  const lines = [
    { type: 'say', speaker: '旁白', text: `${CN_MONTHS[date.getMonth()]}的風，從${spot.city || '街口'}吹過。`, image: 'now' },
    { type: 'say', text: `你站的地方，曾經是「${spot.name}」。` },
  ];
  if (spot.new_name) lines.push({ type: 'say', text: `現在，這裡叫做「${spot.new_name}」。` });
  if (spot.description) {
    const first = spot.description.split(/(?<=[。！？])/)[0];
    lines.push({ type: 'say', text: first, image: 'past' });
  }
  if (spot.startYear) {
    lines.push({
      type: 'ask',
      text: '考考你：這座神社是哪一年鎮座的？（填西元年）',
      param: String(spot.startYear).replace(/[^\d]/g, ''),
      hints: ['看看圖鑑裡的年份', `是 ${String(spot.startYear).slice(0, 2)} 開頭的四位數`],
    });
  }
  lines.push({ type: 'say', text: '這段故事是臨時說給你聽的。\n等真正的說書人寫好了，再回來聽吧。' });
  return {
    title: '偶然的相遇（測試）',
    speaker: AI_CONFIG.speaker,
    lines: lines.map((l, i) => ({ node: '', speaker: '', image: '', param: '', hints: [], row: i + 1, ...l })),
  };
}

/* ------------------------------------------------------------
   主要入口：回傳一個 variant；失敗回傳 null（不會讓打卡失敗）
   ------------------------------------------------------------ */
async function requestAIStory(spot, date, context = {}) {
  let result;
  try {
    if (window.GoShinAI && typeof window.GoShinAI.generate === 'function') {
      result = normalizeAIResponse(await window.GoShinAI.generate(spot, date, context), spot);
    } else if (AI_CONFIG.mode === 'mock') {
      result = mockAIStory(spot, date);
    } else if (AI_CONFIG.mode === 'endpoint' && AI_CONFIG.endpoint) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), AI_CONFIG.timeoutMs);
      const res = await fetch(AI_CONFIG.endpoint, {
        method: 'POST',
        // text/plain 可以避開 CORS 預檢，Apps Script 才收得到
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(buildAIRequest(spot, date, context)),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`AI 後端回應 ${res.status}`);
      const type = res.headers.get('content-type') || '';
      const raw = await res.text();
      let data = raw;
      if (type.includes('json') || /^\s*[{[]/.test(raw)) data = JSON.parse(raw);
      result = normalizeAIResponse(data, spot);
    } else {
      return null;
    }
  } catch (e) {
    console.warn('[AI 劇情] 取得失敗：', e);
    return null;
  }

  return {
    key: `ai-${toDateKey(date)}`,
    title: result.title,
    speaker: result.speaker || AI_CONFIG.speaker,
    lines: result.lines,
    nodes: result.nodes || {},
    when: null,
    ai: true,
  };
}

// 存進 Firestore 前把 variant 精簡成純資料
function serializeAIStory(v) {
  return {
    title: v.title, speaker: v.speaker,
    lines: v.lines.map(({ type, node, speaker, text, image, param, hints }) =>
      ({ type, node, speaker, text, image, param, hints })),
  };
}
function deserializeAIStory(key, data) {
  const lines = (data.lines || []).map((l, i) => ({ hints: [], row: i + 1, ...l }));
  const nodes = {};
  lines.forEach((l, i) => { if (l.node) nodes[l.node] = i; });
  return { key: key.split(':').slice(1).join(':'), title: data.title, speaker: data.speaker, lines, nodes, when: null, ai: true };
}
