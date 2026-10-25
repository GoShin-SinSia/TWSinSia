/**
 * ai-proxy.gs — GoShin 的 AI 劇情後端（Google Apps Script）
 * ============================================================
 * 為什麼要有這個：API key 不能放在網頁裡（任何人都看得到），
 * 所以網頁 → 這支 Apps Script → AI，key 只存在這裡。
 *
 * 設定步驟：
 *  1. 到 https://script.google.com 新增專案，把這整個檔案貼進去
 *  2. 左側「專案設定」→「指令碼屬性」新增：
 *       GEMINI_API_KEY = 你的 key
 *  3. 右上「部署」→「新增部署作業」→ 類型選「網頁應用程式」
 *       執行身分：我　／　誰可以存取：所有人
 *  4. 複製「網頁應用程式網址」，貼到 ai.js：
 *       mode: 'endpoint', endpoint: '那串網址'
 *  5. 之後改了程式碼要「管理部署作業 → 編輯 → 新版本」才會生效
 *
 * 省額度的設計：
 *  - 同一間神社同一天只會真的呼叫 AI 一次，之後 6 小時內直接回快取
 *  - 每天總呼叫次數上限 DAILY_LIMIT，超過就回錯誤（網頁會當作沒有劇情）
 * ============================================================
 */

const MODEL = 'gemini-2.5-flash';   // 改成你帳號可用的模型名稱
const DAILY_LIMIT = 150;
const TZ = 'Asia/Taipei';

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents || '{}');
    const spot = req.spot || {};
    if (!spot.id || !spot.name) return json_({ error: '缺少神社資料' });

    // 日期以伺服器為準，避免有人改網址參數一直要新故事
    const today = Utilities.formatDate(new Date(), TZ, 'yyyy-M-d');
    const cacheKey = `story:${spot.id}:${today}`;
    const cache = CacheService.getScriptCache();
    const hit = cache.get(cacheKey);
    if (hit) return ContentService.createTextOutput(hit).setMimeType(ContentService.MimeType.JSON);

    if (!countToday_()) return json_({ error: '今日 AI 額度已用完' });

    const story = callGemini_(buildPrompt_(spot, req, today));
    const out = JSON.stringify(story);
    cache.put(cacheKey, out, 6 * 60 * 60);
    return ContentService.createTextOutput(out).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return json_({ error: String(err) });
  }
}

// 用瀏覽器打開網址測試是否部署成功
function doGet() {
  return json_({ ok: true, model: MODEL });
}

/* ------------------------------------------------------------
   提示詞：想調整 AI 寫法就改這裡
   ------------------------------------------------------------ */
function buildPrompt_(spot, req, today) {
  return [
    '你是「臺灣神社模擬器」的說書人。玩家剛走到一座日治時期神社的原址。',
    '請用繁體中文寫一段 8～14 句、溫柔而帶點懷舊感的短劇情，說話者是守護這片土地的神使或精靈。',
    '',
    '【歷史正確性規則——非常重要】',
    '- 只能使用下面「神社資料」裡寫到的事實（名稱、年份、地點、說明）。',
    '- 不要編造任何年份、人名、祭典名稱或事件；不確定的事情用感受、想像、景物描寫帶過。',
    '- 可以描寫「現在」玩家眼前可能看到的街景，但用不確定的語氣（例如「也許」「大概」）。',
    '',
    '【互動】',
    '- 可以在中間放一題「問答」，答案必須能從神社資料直接得知（例如鎮座年份、現在的名稱）。',
    '- 不要放「現場」或「道具」類型。',
    '',
    '【神社資料】',
    `名稱：${spot.name}`,
    `現在名稱／原址：${spot.newName || '（無資料）'}`,
    `社格：${spot.category || ''}`,
    `地址：${spot.address || ''}`,
    `年份：${spot.startYear || '?'}–${spot.endYear || '?'}`,
    `說明：${spot.description || '（無資料）'}`,
    `今天：${today}（${req.month || ''}）`,
    '',
    '【只輸出 JSON，格式如下】',
    '{',
    '  "title": "四到八個字的標題",',
    '  "speaker": "說話者名稱",',
    '  "lines": [',
    '    { "type": "台詞", "speaker": "", "text": "第一句", "image": "now" },',
    '    { "type": "台詞", "speaker": "旁白", "text": "旁白的句子" },',
    '    { "type": "問答", "text": "題目", "param": "答案1|答案2", "hints": ["提示1", "提示2"] }',
    '  ]',
    '}',
    'speaker 空字串 = 用預設說話者；"旁白" = 旁白。image 可省略，"past" = 舊照片、"now" = 現況照片。',
  ].join('\n');
}

function callGemini_(prompt) {
  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!key) throw new Error('沒有設定 GEMINI_API_KEY');

  const res = UrlFetchApp.fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-goog-api-key': key },
      muteHttpExceptions: true,
      payload: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.9,
          maxOutputTokens: 2048,
          responseMimeType: 'application/json',
        },
      }),
    }
  );
  if (res.getResponseCode() !== 200) throw new Error('Gemini 回應 ' + res.getResponseCode() + '：' + res.getContentText().slice(0, 200));

  const data = JSON.parse(res.getContentText());
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
  const story = JSON.parse(text.replace(/^```(json)?\s*|\s*```$/g, ''));
  if (!Array.isArray(story.lines) || !story.lines.length) throw new Error('AI 沒有回傳 lines');
  return story;
}

function countToday_() {
  const props = PropertiesService.getScriptProperties();
  const k = 'count:' + Utilities.formatDate(new Date(), TZ, 'yyyyMMdd');
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const n = Number(props.getProperty(k) || 0);
    if (n >= DAILY_LIMIT) return false;
    props.setProperty(k, String(n + 1));
    return true;
  } finally {
    lock.releaseLock();
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
