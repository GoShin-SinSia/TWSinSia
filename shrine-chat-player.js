/* 聊天劇情共用格式；關卡條件留在程式，CSV 只負責線性內容與輸入秒數。 */
const CHAT_SHRINE_NAME = '台灣神宮';
const CHAT_WAIT_MS = 3000;
const CHAT_REWARD_DELAY_MS = 10000;
let chatRewardDeadline = null;
const CHAT_DELETE_MS = 60;
const CHAT_DELETE_BLACKOUT_MS = 1000;
const CHAT_TYPE_MS = 100;
const CHAT_TYPE_DELAY_MS = 1000;
let chatEditStartedAt = null;
const CHAT_DEFAULT_TYPING_SECONDS = 7;
const CHAT_CHAPTER_TEST_MODE = true; // 測試章節入口；未接正式員工身分驗證。
const CHAT_TASK_TEST_MODE = true; // 正式上線時關閉作弊打卡。
const CHAT_STAGE_TASKS = {
  1: { id: 'taiwan-stage1-underground', name: '狛犬', spotId: 301 },
  2: { id: 'taiwan-stage2-other-place', name: '加藤口中的其他地方', lat: 25.042754, lng: 121.51503, radius: 50 },
  3: { id: 'taiwan-stage3-memory', name: '回憶', lat: 24.93402367031506, lng: 121.37030686705481, radius: 50 },
};
let chatTaskSaving = false;
let chatSaveQueue = Promise.resolve();
let chatPlayerTimer;
let chatBlankDeadline = null; // 僅存於本次觀看，不存檔；離開即重新計時。
let chatRows = [];
let chatLoadedState = null;
let chatLoadToken = 0;
let chatRenderKey = '';
let chatLoadError = '';
let chatSaveError = false;
let chatNextLoading = false;
const chatTranslations = new Set();

async function loadChatStage(stage) {
  const path = `stories/${CHAT_SHRINE_NAME}/${CHAT_SHRINE_NAME}${stage}.csv`;
  const response = await fetch(path, { cache: 'no-cache' });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`讀檔失敗（${response.status}）`);
  const buffer = await response.arrayBuffer();
  let source;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch { source = new TextDecoder('big5').decode(buffer); }
  const table = parseCSVRows(source);
  const headers = table[0]?.map(value => value.trim()) || [];
  if (!['編號', '類型', '訊息A', '訊息B'].every(key => headers.includes(key))) {
    throw new Error(`${path} 缺少必要欄位`);
  }
  const ids = new Set();
  const rows = csvToObjects(source).map(row => {
    const seconds = row['秒數']?.trim() || '';
    const result = { id: row['編號'], type: row['類型'].toLowerCase(), a: row['訊息A'], b: row['訊息B'], red: row['紅字'] || '', seconds: seconds === '' ? CHAT_DEFAULT_TYPING_SECONDS : Number(seconds) };
    if (!result.id || ids.has(result.id) || !['npc', 'os', 'player', 'hint', 'blank', 'think', 'click_delete', 'type'].includes(result.type) || (!['blank', 'think'].includes(result.type) && !result.a)) {
      throw new Error(`${path} 編號 ${result.id || '空白'} 的類型、文字或編號不正確`);
    }
    if (['npc', 'blank', 'think'].includes(result.type) && (!Number.isFinite(result.seconds) || result.seconds < 0 || (['blank', 'think'].includes(result.type) && seconds === ''))) {
      throw new Error(`${path} 編號 ${result.id} 的秒數必須是非負數`);
    }
    ids.add(result.id);
    return result;
  });
  if (!rows.length) throw new Error(`${path} 沒有劇情內容`);
  return rows;
}

function persistShrineChat() {
  const state = window.taiwanChat;
  const owner = window._firebaseUser;
  chatSaveQueue = chatSaveQueue.then(async () => {
    if (!state || state !== window.taiwanChat || owner !== window._firebaseUser) return;
    try {
      if (!owner || !window.saveProgress) throw new Error('尚未登入');
      await window.saveProgress();
      if (state === window.taiwanChat) chatSaveError = false;
    } catch (error) {
      if (state === window.taiwanChat) chatSaveError = true;
      console.error('聊天進度未能儲存', error);
    }
  });
  return chatSaveQueue;
}

function stopShrineChatPlayer() {
  chatRewardDeadline = null;
  clearInterval(chatPlayerTimer);
  resetChatBlankWait();
  chatLoadToken++;
  chatLoadedState = null;
  chatRows = [];
  chatRenderKey = '';
  chatLoadError = '';
  chatSaveError = false;
  chatNextLoading = false;
  chatTranslations.clear();
}

async function startShrineChatPlayer() {
  const state = window.taiwanChat;
  if (!state?.started) return;
  if (chatLoadedState === state) { tickShrineChat(); return; }
  const token = ++chatLoadToken;
  const openedAt = Date.now();
  chatLoadError = '';
  try {
    const rows = await loadChatStage(state.player?.stage || 1);
    if (token !== chatLoadToken || state !== window.taiwanChat) return;
    if (!rows) throw new Error('此階段劇情檔案尚未提供');
    chatRows = rows;
    chatLoadedState = state;
    if (!state.player) {
      state.version = 2;
      state.player = { stage: 1, index: 0, messages: [], unread: false, gate: false, dueAt: 0, typingAt: 0 };
      delete state.previewArrivalAt;
      delete state.previewSeen;
      prepareChatRow(openedAt, true);
      persistShrineChat();
    }
    enterChatDisappearance();
    delete state.player.hintUntil;
    if (!state.player.gate && chatRows[state.player.index]?.type === 'hint') activateChatTask();
    refreshChatTaskRadar();
    // 更新已儲存的本階段訊息標色，不重置或重播劇情。
    let highlightChanged = false;
    for (const message of state.player.messages) {
      const row = rows.find(row => `${state.player.stage}:${row.id}` === message.key);
      if (row && message.red !== row.red) { message.red = row.red; highlightChanged = true; }
    }
    if (highlightChanged) persistShrineChat();
    clearInterval(chatPlayerTimer);
    chatPlayerTimer = setInterval(tickShrineChat, 50);
    tickShrineChat();
  } catch (error) {
    if (token !== chatLoadToken || state !== window.taiwanChat) return;
    chatLoadError = `無法載入劇情：${error.message}`;
    renderChatLoadFailure();
  }
}

function renderChatLoadFailure() {
  const list = document.querySelector('.chat-conversations');
  if (!list) return;
  list.replaceChildren();
  const message = document.createElement('p');
  message.textContent = chatLoadError;
  message.className = 'chat-save-error';
  message.setAttribute('role', 'alert');
  list.append(message, chatAction('重新讀取', startShrineChatPlayer));
}

function prepareChatRow(time, first = false) {
  resetChatBlankWait();
  enterChatDisappearance();
  const player = window.taiwanChat.player;
  const row = chatRows[player.index];
  player.dueAt = 0;
  player.typingAt = 0;

  if (['npc', 'think'].includes(row?.type)) {
    player.typingAt = first ? 0 : time + CHAT_WAIT_MS;
    player.dueAt = first ? time + CHAT_WAIT_MS : player.typingAt + row.seconds * 1000;
  } else if (row?.type === 'hint') {
    activateChatTask();
  }
}

function tickShrineChat() {
  if (taiwanChatSaving || window.taiwanChat !== chatLoadedState || !chatLoadedState?.player) return;
  const p = chatLoadedState.player;
  let changed = false;
  // 以預定送達時間推算，不因切頁或背景計時器延遲而重新等待。
  while (!p.gate && ['npc', 'think'].includes(chatRows[p.index]?.type) && p.dueAt && Date.now() >= p.dueAt) {
    const row = chatRows[p.index];
    const deliveredAt = p.dueAt;
    if (row.type === 'npc') {
      p.messages.push({ key: `${p.stage}:${row.id}`, type: 'npc', a: row.a, b: row.b, red: row.red });
      p.unread = true;
    }
    p.index++;
    p.dueAt = 0;
    p.typingAt = 0;
    if (['npc', 'blank', 'think', 'type'].includes(chatRows[p.index]?.type)) prepareChatRow(deliveredAt);
    else p.gate = p.unread;
    changed = true;
  }
  // blank 只計算留在指定對話且分頁可見的完整等待時間。
  while (!p.gate && chatRows[p.index]?.type === 'blank') {
    if (!isChatConversationVisible()) { resetChatBlankWait(); break; }
    const row = chatRows[p.index];
    if (chatBlankDeadline === null) chatBlankDeadline = Date.now() + row.seconds * 1000;
    if (Date.now() < chatBlankDeadline) break;
    p.index++;
    prepareChatRow(Date.now());
    changed = true;
  }
  const editRow = chatRows[p.index];
  if (!p.gate && (editRow?.type === 'type' || (editRow?.type === 'click_delete' && p.deleting === `${p.stage}:${editRow.id}`))) {
    if (!isChatConversationVisible()) resetChatBlankWait();
    else {
      if (chatEditStartedAt === null) beginChatEdit(editRow, p);
      updateChatBlackout(editRow, p);
      const length = chatCharacters(editRow.a).length;
      const speed = editRow.type === 'type' ? CHAT_TYPE_MS : CHAT_DELETE_MS;
      if (Date.now() - chatEditStartedAt >= (length + 1) * speed) {
        if (editRow.type === 'type') p.messages.push({ key: `${p.stage}:${editRow.id}`, type: 'player', a: editRow.a, b: editRow.b, red: editRow.red });
        p.deleting = null;
        p.index++;
        prepareChatRow(Date.now());
        changed = true;
        chatRenderKey = '';
        renderShrineChatPlayer(true);
        const history = document.querySelector('#taiwan-chat .chat-history');
        if (history) history.scrollTop = history.scrollHeight;
      }
    }
  }
  if (changed) {
    persistShrineChat();
    renderTaiwanConversationList();
  }
  renderShrineChatPlayer();
  renderChatEnding();
  tickChatRewardNotice();
}

function chatAction(label, action) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'chat-action';
  button.textContent = label;
  button.addEventListener('click', action);
  return button;
}

function completeChatStep() {
  const p = window.taiwanChat?.player;
  if (!p || window.taiwanChat !== chatLoadedState) return;
  const row = chatRows[p.index];
  if (p.completed) return;
  const sentReply = !p.gate && row?.type === 'player';
  if (p.gate) {
    p.gate = false;
    p.unread = false;
    prepareChatRow(Date.now());
  } else if (row?.type === 'os' || row?.type === 'player') {
    if (row.type === 'player') p.messages.push({ key: `${p.stage}:${row.id}`, type: 'player', a: row.a, b: '', red: row.red });
    // 關卡演出事件：讀完第二階段改名 OS，才設定玩家端暱稱。
    if (p.stage === 2 && row.id === '39' && row.type === 'os') {
      p.nickname = '加藤';
      renderChatNickname();
    }
    if (p.stage === 4 && row.id === '42' && row.type === 'os') {
      p.completed = true;
      p.rewardNotice = true;
      chatRewardDeadline = Date.now() + CHAT_REWARD_DELAY_MS;
      renderBag();
      if (typeof currentModalIsQuest !== 'undefined' && currentModalIsQuest && currentModalSpot?.id === 301) renderModalStories(currentModalSpot);
    }
    p.index++;
    prepareChatRow(Date.now());
  } else return;
  persistShrineChat();
  renderTaiwanConversationList();
  tickShrineChat();
  renderShrineChatPlayer(true);
  if (sentReply) {
    const history = document.querySelector('#taiwan-chat .chat-history');
    if (history) history.scrollTop = history.scrollHeight;
  }
}

async function nextChatStage() {
  const state = window.taiwanChat;
  const p = state?.player;
  if (chatNextLoading || !p || p.gate || chatRows[p.index]?.type !== 'hint' || !isChatTaskComplete()) return;
  chatNextLoading = true;
  renderShrineChatPlayer(true);
  try {
    const rows = await loadChatStage(p.stage + 1);
    if (state !== window.taiwanChat) return;
    if (!rows) { chatLoadError = '下一階段尚未開放'; return; }
    chatRows = rows;
    p.stage++;
    p.index = 0;
    p.gate = false;
    chatLoadError = '';
    prepareChatRow(Date.now());
    persistShrineChat();
  } catch (error) {
    if (state === window.taiwanChat) chatLoadError = `讀取失敗，請重試：${error.message}`;
  } finally {
    if (state === window.taiwanChat) {
      chatNextLoading = false;
      renderShrineChatPlayer(true);
    }
  }
}

function renderShrineChatPlayer(force = false) {
  const dialog = document.getElementById('taiwan-chat');
  const p = window.taiwanChat?.player;
  if (!dialog?.open || dialog.querySelector('[data-screen="chat"]').hidden) return;
  if (!p || window.taiwanChat !== chatLoadedState) {
    dialog.querySelector('.chat-history').textContent = '正在載入對話…';
    dialog.querySelector('[data-screen="chat"] .chat-options').replaceChildren();
    return;
  }
  const row = chatRows[p.index];
  const typing = !p.gate && ['npc', 'think'].includes(row?.type) && p.typingAt > 0 && Date.now() >= p.typingAt && Date.now() < p.dueAt;
  const editText = chatEditText(row, p);
  const taskComplete = isChatTaskComplete();
  const key = JSON.stringify([p.stage, p.index, p.messages.length, p.gate, typing, editText, p.deleting, taskComplete, chatLoadError, chatSaveError, chatNextLoading]);
  if (!force && key === chatRenderKey) return;
  chatRenderKey = key;
  const history = dialog.querySelector('.chat-history');
  const previousTop = history.scrollTop;
  const atBottom = history.scrollHeight - history.scrollTop - history.clientHeight < 60;
  history.replaceChildren();
  history.classList.add('chat-history-active');
  for (const message of p.messages) {
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble chat-bubble-${message.type}`;
    const text = document.createElement('p');
    renderChatHighlightedText(text, chatTranslations.has(message.key) ? message.b : message.a, message.red);
    bubble.appendChild(text);
    if (message.b) {
      const translate = chatAction(chatTranslations.has(message.key) ? '原文' : '翻譯', () => {
        if (chatTranslations.has(message.key)) chatTranslations.delete(message.key);
        else chatTranslations.add(message.key);
        renderShrineChatPlayer(true);
      });
      translate.classList.add('chat-translate');
      bubble.appendChild(translate);
    }
    history.appendChild(bubble);
  }
  if (typing) {
    const indicator = document.createElement('div');
    indicator.className = 'chat-typing';
    indicator.setAttribute('aria-label', '對方正在輸入');
    indicator.innerHTML = '<span>●</span><span>●</span><span>●</span>';
    history.appendChild(indicator);
  }
  if (p.gate) history.appendChild(chatAction('確認已讀', completeChatStep));
  history.scrollTop = atBottom && !force ? history.scrollHeight : previousTop;
  const options = dialog.querySelector('[data-screen="chat"] .chat-options');
  options.replaceChildren();
  options.classList.toggle('chat-os-box', !p.gate && row?.type === 'os');
  if (chatSaveError) {
    const error = document.createElement('p');
    error.setAttribute('role', 'alert');
    error.textContent = '進度尚未儲存，請確認網路並重試。';
    options.append(error, chatAction('重試儲存', () => persistShrineChat()));
  }
  if (p.gate) options.append('讀完上方訊息後，請點擊「確認已讀」。');
  else if (row?.type === 'os') {
    const os = chatAction(`${row.a}\n\n點擊繼續 ▼`, completeChatStep);
    renderChatHighlightedText(os, row.a, row.red);
    os.append(document.createTextNode('\n\n點擊繼續 ▼'));
    os.classList.add('chat-os-text');
    options.appendChild(os);
  } else if (row?.type === 'player') {
    const reply = chatAction('', completeChatStep);
    renderChatHighlightedText(reply, row.a, row.red);
    options.appendChild(reply);
  }
  else if (row?.type === 'click_delete' && p.deleting !== `${p.stage}:${row.id}`) {
    const button = chatAction('', () => {
      if (p.deleting || p.gate || window.taiwanChat !== chatLoadedState) return;
      p.deleting = `${p.stage}:${row.id}`;
      beginChatEdit(row, p);
      persistShrineChat();
      renderShrineChatPlayer(true);
    });
    renderChatHighlightedText(button, row.a, row.red);
    options.appendChild(button);
  } else if (['click_delete', 'type'].includes(row?.type)) {
    const draft = document.createElement('div');
    draft.className = 'chat-scripted-draft';
    renderChatHighlightedText(draft, editText, row.red);
    const cursor = document.createElement('span');
    cursor.className = 'chat-text-cursor';
    cursor.setAttribute('aria-hidden', 'true');
    draft.appendChild(cursor);
    options.appendChild(draft);
  }
  else if (row?.type === 'hint') {
    const hint = document.createElement('p');
    if (taskComplete) hint.textContent = '已完成任務目標。';
    else renderChatHighlightedText(hint, row.a, row.red);
    options.appendChild(hint);
    if (taskComplete) {
      const button = chatAction(chatNextLoading ? '讀取中…' : '繼續劇情', nextChatStage);
      button.disabled = chatNextLoading;
      options.appendChild(button);
    }
    if (chatLoadError) {
      const notice = document.createElement('p');
      notice.textContent = chatLoadError;
      notice.setAttribute('role', 'status');
      options.appendChild(notice);
    }
  } else if (row?.type !== 'blank') options.append(row ? '等待對方的訊息…' : '本階段對話已結束');
}

function resetChatBlankWait() {
  chatBlankDeadline = null;
  chatEditStartedAt = null;
  document.getElementById('chat-blackout')?.close();
}

function isChatConversationVisible() {
  const dialog = document.getElementById('taiwan-chat');
  return !!(dialog?.open && !dialog.querySelector('[data-screen="chat"]').hidden && !document.hidden);
}

document.addEventListener('visibilitychange', () => {
  chatRewardDeadline = null;
  resetChatBlankWait();
  if (!document.hidden) tickShrineChat();
});
window.addEventListener('pagehide', () => { chatRewardDeadline = null; resetChatBlankWait(); });
window.addEventListener('pageshow', () => { chatRewardDeadline = null; tickShrineChat(); });

// 使用文字節點，CSV 內容不作為 HTML；每一處完全相同的字串都標色。
function renderChatHighlightedText(target, value, red = '') {
  target.replaceChildren();
  if (!red) { target.textContent = value; return; }
  const parts = value.split(red);
  parts.forEach((part, index) => {
    if (index) {
      const highlight = document.createElement('span');
      highlight.className = 'chat-highlight-red';
      highlight.textContent = red;
      target.appendChild(highlight);
    }
    target.appendChild(document.createTextNode(part));
  });
}


function activateChatTask() {
  const p = window.taiwanChat?.player;
  const config = p && CHAT_STAGE_TASKS[p.stage];
  if (!config) return;
  p.tasks ||= {};
  if (!p.tasks[config.id]) {
    p.tasks[config.id] = { activatedAt: Date.now(), completedAt: null };
    persistShrineChat();
  }
  refreshChatTaskRadar();
}

function isChatTaskComplete() {
  const p = window.taiwanChat?.player;
  const config = p && CHAT_STAGE_TASKS[p.stage];
  return !!(config && p.tasks?.[config.id]?.completedAt);
}

function activeChatTaskTarget() {
  const p = window.taiwanChat?.player;
  const config = p && CHAT_STAGE_TASKS[p.stage];
  if (!config || p.gate || chatLoadedState !== window.taiwanChat || chatRows[p.index]?.type !== 'hint') return null;
  const task = p.tasks?.[config.id];
  if (!task || task.completedAt) return null;
  if (Number.isFinite(config.lat) && Number.isFinite(config.lng)) return { ...config };
  const spot = SPOTS.find(spot => spot.id === config.spotId);
  return spot ? { ...config, lat: spot.lat, lng: spot.lng, radius: spot.radius } : null;
}

function refreshChatTaskRadar() {
  if (typeof fillRadarTargets === 'function') { fillRadarTargets(); drawRadar(); }
}

function updateChatTaskCheatButton() {
  const button = document.getElementById('chat-task-cheat');
  if (!button) return;
  button.hidden = !CHAT_TASK_TEST_MODE || radar.target !== 'chat-task' || !activeChatTaskTarget();
  button.disabled = chatTaskSaving;
}

async function completeChatTask({ cheat = false, lat, lng } = {}) {
  const target = activeChatTaskTarget();
  if (!target || chatTaskSaving || taiwanChatSaving) return false;
  if (cheat) {
    if (!CHAT_TASK_TEST_MODE || radar.target !== 'chat-task') return false;
  } else if (!Number.isFinite(lat) || !Number.isFinite(lng) || haversine(lat, lng, target.lat, target.lng) > target.radius) return false;
  const state = window.taiwanChat;
  const task = state.player.tasks[target.id];
  chatTaskSaving = true;
  updateChatTaskCheatButton();
  task.completedAt = Date.now();
  await persistShrineChat();
  if (state !== window.taiwanChat) { chatTaskSaving = false; return false; }
  if (chatSaveError) task.completedAt = null;
  chatTaskSaving = false;
  refreshChatTaskRadar();
  renderShrineChatPlayer(true);
  const banner = document.getElementById('result-banner');
  if (banner) {
    banner.style.display = 'block';
    banner.className = `result-banner ${chatSaveError ? 'result-fail' : 'result-success'}`;
    banner.textContent = chatSaveError ? '任務完成紀錄未能儲存，請重試打卡。' : '已完成任務目標，請回聊天室繼續劇情。';
  }
  return !chatSaveError;
}


function chatCharacters(text) {
  return Array.from(new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(text), part => part.segment);
}

function chatEditText(row, p) {
  if (!row || !['click_delete', 'type'].includes(row.type)) return '';
  const chars = chatCharacters(row.a);
  const speed = row.type === 'type' ? CHAT_TYPE_MS : CHAT_DELETE_MS;
  const count = chatEditStartedAt === null ? 0 : Math.max(0, Math.floor((Date.now() - chatEditStartedAt) / speed));
  return chars.slice(0, row.type === 'type' ? Math.min(count, chars.length) : Math.max(0, chars.length - count)).join('');
}

function renderChatEnding() {
  const dialog = document.getElementById('taiwan-chat');
  const p = window.taiwanChat?.player;
  const footer = dialog?.querySelector('.chat-ending');
  if (!footer) return;
  const row = chatRows[p?.index];
  const key = JSON.stringify([!!p?.removed, !!p?.completed, row?.id, chatSaveError]);
  if (footer.dataset.key !== key) {
    footer.dataset.key = key;
    footer.replaceChildren();
    footer.hidden = !p?.removed || (!!p?.completed && !chatSaveError);
    if (p?.removed && !p.completed && row?.type === 'os') {
      const button = chatAction(`${row.a}\n\n點擊繼續 ▼`, completeChatStep);
      button.classList.add('chat-os-text');
      footer.appendChild(button);
    }
    if (p?.removed && chatSaveError) footer.appendChild(chatAction('進度尚未儲存，點擊重試', () => persistShrineChat()));
  }

}

function showChatMemoryNotice() {
  const state = window.taiwanChat;
  if (!state?.player?.rewardNotice || document.hidden || chatRewardDeadline === null || Date.now() < chatRewardDeadline) return;
  if (!state.player.memory) {
    state.player.memory = true;
    renderBag();
    persistShrineChat();
  }
  let dialog = document.getElementById('chat-memory-notice');
  if (dialog) dialog.remove();
  dialog = document.createElement('dialog');
  dialog.id = 'chat-memory-notice';
  dialog.className = 'chat-memory-dialog';
  dialog.setAttribute('aria-label', '獲得物品');
  const text = document.createElement('p');
  text.textContent = '你收到了一個物品，去行囊看看吧。';
  const acknowledge = () => {
    if (window.taiwanChat === state && state.player.rewardNotice) {
      state.player.rewardNotice = false;
      persistShrineChat();
    }
  };
  dialog.append(text, chatAction('知道了', () => { acknowledge(); dialog.close(); }));
  dialog.addEventListener('cancel', acknowledge);
  dialog.addEventListener('close', acknowledge);
  document.body.appendChild(dialog);
  dialog.showModal();
}

function appendChatMemoryItem(list) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'bag-item chat-bag-item';
  button.innerHTML = '<span class="bag-icon" aria-hidden="true">▧</span><span class="bag-body"><span class="bag-name">回憶</span></span>';
  button.addEventListener('click', openChatMemory);
  list.appendChild(button);
}

function openChatMemory() {
  if (!window.taiwanChat?.player?.memory) return;
  let dialog = document.getElementById('chat-memory');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'chat-memory';
    dialog.className = 'chat-memory-dialog chat-memory-viewer';
    dialog.setAttribute('aria-label', '回憶');
    dialog.innerHTML = '<img class="chat-memory-photo" src="stories/台灣神宮/memory.png" alt="回憶照片"><p class="chat-memory-caption">你拯救了一個彌留中的靈魂</p>';
    dialog.appendChild(chatAction('關閉', () => dialog.close()));
    document.body.appendChild(dialog);
  }
  dialog.showModal();
}


// 進入 41 時就切換背景，讓該行 OS 顯示在已消失的列表上。
function enterChatDisappearance() {
  const p = window.taiwanChat?.player;
  const row = chatRows[p?.index];
  if (!p || p.removed || p.stage !== 4 || row?.id !== '41' || row.type !== 'os') return;
  p.removed = true;
  p.messages = [];
  p.unread = false;
  chatTranslations.clear();
  document.querySelector('#taiwan-chat .chat-history')?.replaceChildren();
  document.querySelector('#taiwan-chat [data-screen="chat"] .chat-options')?.replaceChildren();
  renderTaiwanConversationList();
  if (document.getElementById('taiwan-chat')) showTaiwanChatScreen('list');
  persistShrineChat();
}


function hasChatDeleteBlackout(row, player) {
  return player.stage === 4 && row.type === 'click_delete' && row.id === '13';
}

function beginChatEdit(row, player) {
  const delay = row.type === 'type' ? CHAT_TYPE_DELAY_MS : hasChatDeleteBlackout(row, player) ? CHAT_DELETE_BLACKOUT_MS : 0;
  chatEditStartedAt = Date.now() + delay;
  updateChatBlackout(row, player);
}

function updateChatBlackout(row, player) {
  let overlay = document.getElementById('chat-blackout');
  const active = hasChatDeleteBlackout(row, player) && chatEditStartedAt !== null && Date.now() < chatEditStartedAt && isChatConversationVisible();
  if (!active) { overlay?.close(); return; }
  if (!overlay) {
    // 使用頂層 modal，確保蓋住聊天室 dialog 以及整個頁面。
    overlay = document.createElement('dialog');
    overlay.id = 'chat-blackout';
    overlay.className = 'chat-blackout';
    overlay.tabIndex = -1;
    overlay.setAttribute('aria-label', '劇情轉場');
    overlay.addEventListener('cancel', event => event.preventDefault());
    document.body.appendChild(overlay);
  }
  if (!overlay.open) overlay.showModal();
}


function tickChatRewardNotice() {
  if (!window.taiwanChat?.player?.rewardNotice) { chatRewardDeadline = null; return; }
  if (document.hidden || document.getElementById('chat-memory-notice')?.open) return;
  if (chatRewardDeadline === null) chatRewardDeadline = Date.now() + CHAT_REWARD_DELAY_MS;
  if (Date.now() >= chatRewardDeadline) showChatMemoryNotice();
}
