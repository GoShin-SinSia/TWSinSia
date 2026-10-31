/* 臺灣神宮專用聊天室原型。資料獨立存放，不修改一般道具或集章紀錄。 */
window.taiwanChat = null;
let taiwanChatSaving = false;


function renderTaiwanChatEntry(box) {
  box.replaceChildren();
  box.style.display = 'block';
  const button = document.createElement('button');
  button.className = 'modal-act primary chat-entry-button';
  button.textContent = window.taiwanChat?.player?.completed ? '已完成解謎' : window.taiwanChat?.started ? '去行囊看看吧' : '開始解謎';
  button.disabled = !!window.taiwanChat?.started || taiwanChatSaving;
  button.addEventListener('click', () => ensureTaiwanChat(button));
  box.appendChild(button);
}

function ensureTaiwanChat(button) {
  // 已建立時沿用原狀態，不覆寫聊天室或重複新增行囊入口。
  if (window.taiwanChat?.started) {
    renderTaiwanChatEntry(document.getElementById('modal-stories'));
    return;
  }
  return changeTaiwanChat({ version: 1, started: true, startedAt: new Date().toISOString() }, button);
}

async function changeTaiwanChat(next, button) {
  if (taiwanChatSaving) return;
  taiwanChatSaving = true;
  button.disabled = true;
  await chatSaveQueue;
  const previous = window.taiwanChat;
  const owner = window._firebaseUser;
  window.taiwanChat = next;
  const box = document.getElementById('modal-stories');
  box.querySelector('.chat-save-error')?.remove();
  try {
    if (!window.saveProgress || !owner) throw new Error('尚未登入');
    await window.saveProgress();
    if (owner !== window._firebaseUser) return;
    if (previous !== next) {
      stopShrineChatPlayer();
      refreshChatTaskRadar();
      document.getElementById('taiwan-chat')?.close();
    }
    if (previous !== next) {
      document.getElementById('chat-memory')?.close();
      document.getElementById('chat-memory-notice')?.close();
    }
    renderBag();
  } catch (error) {
    if (owner !== window._firebaseUser) return;
    window.taiwanChat = previous;
    const notice = document.createElement('p');
    notice.className = 'chat-save-error';
    notice.setAttribute('role', 'alert');
    notice.textContent = '未能儲存，請確認網路後再試一次。';
    box.appendChild(notice);
    console.error('聊天室狀態儲存失敗', error);
    return;
  } finally {
    taiwanChatSaving = false;
    button.disabled = false;
  }
  if (currentModalIsQuest && currentModalSpot?.id === 301) {
    renderModalStories(currentModalSpot);
    renderModalActions(currentModalSpot);
  }
  return true;
}

function resetTaiwanChat(button) {
  if (!confirm('重置臺灣神宮劇情並移除聊天室？一般集章與其他道具會保留。')) return;
  return changeTaiwanChat(null, button);
}

function appendTaiwanChatItem(list) {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'bag-item chat-bag-item';
  item.innerHTML = '<span class="bag-icon" aria-hidden="true">✉</span><span class="bag-body"><span class="bag-name">聊天室<span class="chat-item-arrow" aria-hidden="true">›</span></span><span class="bag-desc">點擊查看所有對話</span></span>';
  item.addEventListener('click', openTaiwanChat);
  list.appendChild(item);
}

function openTaiwanChat() {
  if (!window.taiwanChat?.started) return;
  let dialog = document.getElementById('taiwan-chat');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'taiwan-chat';
    dialog.className = 'shrine-chat';
    dialog.setAttribute('aria-label', '聊天室');
    dialog.innerHTML = `
      <section class="chat-screen" data-screen="list">
        <header class="chat-header"><button type="button" data-chat-close class="chat-return">← 行囊</button><span class="chat-list-title">所有對話</span><span aria-hidden="true"></span></header>
        <div class="chat-conversations" aria-live="polite"></div><footer class="chat-ending chat-options chat-os-box" hidden></footer>
      </section>
      <section class="chat-screen" data-screen="chat" hidden>
        <header class="chat-header">
          <button type="button" data-chat-list class="chat-return" aria-label="返回所有對話">← 所有對話</button>
          <button type="button" class="chat-person" data-profile aria-label="查看對方個人頁">
            <span class="chat-avatar" aria-hidden="true">人</span><span><span class="chat-display-name"></span><span class="chat-caption">查看個人頁面</span></span>
          </button>
          <span class="chat-context">臺灣神宮</span>
        </header>
        <div class="chat-history">
          <span class="chat-date">對話尚未開始</span>
          <div class="chat-empty"><span aria-hidden="true">✉</span><h2>等待一封訊息</h2><p>這裡將留下你與對方的對話。</p></div>
        </div>
        <footer class="chat-options"><span>回覆選項會隨對話出現</span><small>此聊天室不提供自由輸入</small></footer>
      </section>
      <section class="chat-screen" data-screen="profile" hidden>
        <header class="chat-header"><button type="button" data-chat-back>← 返回對話</button><span>個人頁</span><button type="button" data-chat-close aria-label="關閉聊天室">關閉</button></header>
        <div class="chat-profile-scroll">
          <div class="chat-cover" aria-hidden="true"></div>
          <div class="chat-profile-body">
            <span class="chat-avatar chat-avatar-large" aria-hidden="true">人</span>
            <h2 class="chat-display-name"></h2><button type="button" class="chat-caption chat-profile-photo-link" data-profile-photo>IMG-0306</button>
            <section class="chat-profile-section"><h3>關於我</h3><p>簡介尚未公開。</p></section>
            <section class="chat-profile-section"><h3>關注</h3><div data-profile-following></div></section>
            <section class="chat-profile-section"><h3>貼文</h3><div class="chat-profile-placeholder">尚無貼文<p>後續內容將顯示在這裡。</p></div></section>
          </div>
        </div>
      </section>`;
    const photoScreen = document.createElement('section');
    photoScreen.className = 'chat-screen chat-photo-screen';
    photoScreen.dataset.screen = 'profile-photo';
    photoScreen.hidden = true;
    photoScreen.innerHTML = `<header class="chat-header"><button type="button" data-photo-back>← 返回個人頁</button><span>IMG-0306</span><button type="button" data-chat-close aria-label="關閉聊天室">關閉</button></header><div class="chat-photo-view"><svg class="chat-profile-photo" viewBox="0 0 774 1024" role="img" aria-label="IMG-0306"><image href="stories/台灣神宮/photo.png" width="1536" height="1024"/></svg></div>`;
    photoScreen.insertAdjacentHTML('beforeend', '<div class="chat-photo-controls"><button type="button" data-photo-zoom="out" aria-label="縮小照片">−</button><button type="button" data-photo-zoom="in" aria-label="放大照片">＋</button><button type="button" data-photo-fit>全圖</button></div>');
    dialog.appendChild(photoScreen);
    setupChatPhotoViewer(photoScreen);
    dialog.querySelector('[data-profile-photo]').addEventListener('click', () => showTaiwanChatScreen('profile-photo'));
    photoScreen.querySelector('[data-photo-back]').addEventListener('click', () => {
      showTaiwanChatScreen('profile');
      dialog.querySelector('[data-profile-photo]').focus();
    });
    appendRelicsArticle(dialog);
    document.body.appendChild(dialog);
    dialog.addEventListener('close', resetChatBlankWait);
    dialog.addEventListener('cancel', resetChatBlankWait);
    dialog.querySelector('[data-profile]').addEventListener('click', () => showTaiwanChatScreen('profile'));
    dialog.querySelector('[data-chat-back]').addEventListener('click', () => showTaiwanChatScreen('chat'));
    dialog.querySelector('[data-chat-list]').addEventListener('click', () => {
      renderTaiwanConversationList();
      showTaiwanChatScreen('list');
    });
    dialog.querySelectorAll('[data-chat-close]').forEach(b => b.addEventListener('click', () => dialog.close()));
  }
  renderChatNickname();
  renderTaiwanConversationList();
  if (!dialog.open) dialog.showModal();
  showTaiwanChatScreen('list');
  startShrineChatPlayer();
}

function showTaiwanChatScreen(screen) {
  resetChatBlankWait();
  if (['article', 'name-history', 'nasu-paintings', 'taipei-travel', 'treasure-log', 'grand-hotel-photos'].includes(screen) && !hasRelicsArticle()) screen = 'profile';
  if (window.taiwanChat?.player?.removed) screen = 'list';
  if (screen === 'profile') renderChatFollowing();
  if (screen === 'profile' || screen === 'profile-photo') renderChatProfilePhoto();
  const dialog = document.getElementById('taiwan-chat');
  dialog.querySelectorAll('[data-screen]').forEach(section => {
    section.hidden = section.dataset.screen !== screen;
  });
  dialog.querySelector(`[data-screen="${screen}"] button`)?.focus();
  if (screen === 'profile-photo') dialog.querySelector('[data-screen="profile-photo"]').resetPhotoView();
  if (screen === 'profile') requestAnimationFrame(fillChatPhotoLabel);
  if (screen === 'chat') { tickShrineChat(); renderShrineChatPlayer(true); }
  renderChatEnding();
}

function renderTaiwanConversationList() {
  const list = document.querySelector('.chat-conversations');
  if (!list) return;
  list.replaceChildren();
  const state = window.taiwanChat;
  if (!state?.started || !state.player?.messages?.length || state.player?.removed) {
    const empty = document.createElement('p');
    empty.className = 'chat-list-empty';
    empty.textContent = '目前還沒有對話';
    list.appendChild(empty);
    return;
  }
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'chat-conversation';
  row.innerHTML = `<span class="chat-avatar" aria-hidden="true">人</span><span class="chat-conversation-name"></span><span class="chat-new-message">${state.player.unread ? '你有新消息' : ''}</span><span class="chat-conversation-shrine">臺灣神宮</span>`;
  row.querySelector('.chat-conversation-name').textContent = state.player.nickname || '';
  row.addEventListener('click', () => {
    showTaiwanChatScreen('chat');

  });
  list.appendChild(row);
}


function renderChatNickname() {
  const name = window.taiwanChat?.player?.nickname || '';
  document.querySelectorAll('#taiwan-chat .chat-display-name').forEach(element => { element.textContent = name; });
}


let chatChapterBusy = false;
function openChatChapterMenu() {
  if (!CHAT_CHAPTER_TEST_MODE || taiwanChatSaving) return;
  let dialog = document.getElementById('chat-chapters');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'chat-chapters';
    dialog.className = 'chat-memory-dialog';
    dialog.setAttribute('aria-label', '測試章節選擇');
    dialog.innerHTML = '<h2>測試章節選擇</h2><p>跳章會取代目前劇情進度，清除後續進度與「回憶」。一般集章及其他道具會保留。</p><div class="chat-chapter-buttons"></div><p class="chat-chapter-status" role="status"></p>';
    const choices = dialog.querySelector('.chat-chapter-buttons');
    ['重置／第一章', '第二章', '第三章', '第四章', '完結'].forEach((label, index) => {
      const button = chatAction(label, () => selectChatChapter(index + 1, dialog));
      choices.appendChild(button);
    });
    dialog.appendChild(chatAction('取消', () => { if (!chatChapterBusy) dialog.close(); }));
    dialog.addEventListener('cancel', event => { if (chatChapterBusy) event.preventDefault(); });
    document.body.appendChild(dialog);
  }
  dialog.querySelector('.chat-chapter-status').textContent = '';
  if (!dialog.open) dialog.showModal();
}

async function selectChatChapter(chapter, dialog) {
  if (!CHAT_CHAPTER_TEST_MODE || chatChapterBusy || taiwanChatSaving || ![1, 2, 3, 4, 5].includes(chapter)) return;
  chatChapterBusy = true;
  const owner = window._firebaseUser;
  const buttons = dialog.querySelectorAll('button');
  buttons.forEach(button => { button.disabled = true; });
  const status = dialog.querySelector('.chat-chapter-status');
  status.textContent = '準備章節中…';
  try {
    let next = null;
    if (chapter > 1) {
      // 先完整讀取並驗證，任何一份缺失都不覆寫目前進度。
      const stages = await Promise.all(Array.from({ length: Math.min(chapter, 4) }, (_, index) => loadChatStage(index + 1)));
      const missing = stages.findIndex(rows => !rows);
      if (missing !== -1) throw new Error(`第 ${missing + 1} 章檔案尚未提供`);
      const now = Date.now();
      const player = { stage: Math.min(chapter, 4), index: 0, messages: [], tasks: {}, unread: false, gate: false, dueAt: 0, typingAt: 0, nickname: chapter >= 3 ? '加藤' : '' };
      for (let stage = 1; stage < chapter; stage++) {
        for (const row of stages[stage - 1]) {
          if (['npc', 'player', 'type'].includes(row.type)) {
            player.messages.push({ key: `${stage}:${row.id}`, type: row.type === 'npc' ? 'npc' : 'player', a: row.a, b: row.type === 'player' ? '' : row.b, red: row.red });
          }
        }
        const task = CHAT_STAGE_TASKS[stage];
        if (task) player.tasks[task.id] = { activatedAt: now, completedAt: now };
      }
      const first = stages[Math.min(chapter, 4) - 1][0];
      if (chapter === 5) {
        player.index = stages[3].length;
        player.messages = [];
        player.removed = true;
        player.completed = true;
        player.rewardNotice = true;
      } else if (['npc', 'think'].includes(first.type)) {
        player.typingAt = now + CHAT_WAIT_MS;
        player.dueAt = player.typingAt + first.seconds * 1000;
      }
      next = { version: 2, started: true, startedAt: new Date(now).toISOString(), player };
    }
    if (!owner || owner !== window._firebaseUser) throw new Error('登入狀態已變更，請重新開啟選單');
    const saved = await changeTaiwanChat(next, document.createElement('button'));
    if (!saved) throw new Error('未能儲存，原進度已保留，請重試');
    dialog.close();
    if (next) await startShrineChatPlayer();
  } catch (error) {
    status.textContent = error.message;
  } finally {
    chatChapterBusy = false;
    buttons.forEach(button => { button.disabled = false; });
  }
}

function renderChatProfilePhoto() {
  const dialog = document.getElementById('taiwan-chat');
  if (!dialog) return;
  const burnt = !!window.taiwanChat?.player?.tasks?.['taiwan-stage3-memory'];
  const label = burnt ? 'IMG-03066666666666666666666' : 'IMG-0306';
  dialog.querySelector('[data-profile-photo]').textContent = label;
  const screen = dialog.querySelector('[data-screen="profile-photo"]');
  screen.querySelector('.chat-header > span').textContent = label;
  const photo = screen.querySelector('.chat-profile-photo');
  photo.setAttribute('aria-label', label);
  screen.dataset.burnt = String(burnt);
  photo.querySelector('image').setAttribute('href', burnt ? 'stories/台灣神宮/burnt.png' : 'stories/台灣神宮/photo.png');
}

function fillChatPhotoLabel() {
  const link = document.querySelector('[data-profile-photo]');
  if (!link || !link.offsetWidth || !window.taiwanChat?.player?.tasks?.['taiwan-stage3-memory']) return;
  const parentStyle = getComputedStyle(link.parentElement);
  const width = link.parentElement.clientWidth - parseFloat(parentStyle.paddingLeft) - parseFloat(parentStyle.paddingRight);
  const measure = document.createElement('span');
  measure.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;pointer-events:none';
  link.appendChild(measure);
  const style = getComputedStyle(link);
  measure.style.font = style.font;
  measure.style.letterSpacing = style.letterSpacing;
  let label = 'IMG-0306';
  measure.textContent = label + '6';
  while (measure.getBoundingClientRect().width <= width - 2 && label.length < 500) {
    label += '6';
    measure.textContent = label + '6';
  }
  link.textContent = label;
}

function setupChatPhotoViewer(screen) {
  const svg = screen.querySelector('.chat-profile-photo');
  let box, fitWidth;
  const pointers = new Map();
  function draw() { svg.setAttribute('viewBox', `${box.x} ${box.y} ${box.w} ${box.h}`); }
  function fit(closeUp = false) {
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const burnt = screen.dataset.burnt === 'true';
    const ratio = rect.width / rect.height;
    const contentWidth = burnt ? 820 : 774;
    fitWidth = Math.max(contentWidth, 1024 * ratio);
    const w = closeUp && burnt ? Math.max(280, 340 * ratio) : fitWidth;
    const h = w / ratio;
    const cx = closeUp && burnt ? 680 : contentWidth / 2;
    const cy = closeUp && burnt ? 380 : 512;
    box = {x: cx-w/2, y: cy-h/2, w, h};
    pointers.clear();
    draw();
  }
  function zoom(factor, px = .5, py = .5) {
    if (!box) return;
    const w = Math.max(fitWidth / 12, Math.min(fitWidth * 2, box.w * factor));
    const h = w * box.h / box.w;
    box = {x: box.x + (box.w-w)*px, y: box.y + (box.h-h)*py, w, h};
    draw();
  }
  screen.resetPhotoView = () => fit(true);
  screen.querySelector('[data-photo-fit]').addEventListener('click', () => fit());
  screen.querySelector('[data-photo-zoom="in"]').addEventListener('click', () => zoom(.8));
  screen.querySelector('[data-photo-zoom="out"]').addEventListener('click', () => zoom(1.25));
  svg.addEventListener('wheel', event => {
    event.preventDefault();
    const r = svg.getBoundingClientRect();
    zoom(Math.exp(event.deltaY * .002), (event.clientX-r.left)/r.width, (event.clientY-r.top)/r.height);
  }, {passive: false});
  svg.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    svg.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, {x:event.clientX, y:event.clientY});
  });
  svg.addEventListener('pointermove', event => {
    if (!pointers.has(event.pointerId) || !box) return;
    const before = [...pointers.values()];
    const old = pointers.get(event.pointerId);
    pointers.set(event.pointerId, {x:event.clientX, y:event.clientY});
    const after = [...pointers.values()];
    const r = svg.getBoundingClientRect();
    if (before.length === 2) {
      const distance = points => Math.hypot(points[0].x-points[1].x, points[0].y-points[1].y);
      const oldDistance = distance(before), newDistance = distance(after);
      const cx = (before[0].x+before[1].x)/2, cy = (before[0].y+before[1].y)/2;
      if (oldDistance > 0 && newDistance > 0) zoom(oldDistance/newDistance, (cx-r.left)/r.width, (cy-r.top)/r.height);
      box.x -= ((after[0].x+after[1].x)/2-cx)*box.w/r.width;
      box.y -= ((after[0].y+after[1].y)/2-cy)*box.h/r.height;
    } else {
      box.x -= (event.clientX-old.x)*box.w/r.width;
      box.y -= (event.clientY-old.y)*box.h/r.height;
    }
    draw();
  });
  for (const type of ['pointerup','pointercancel','lostpointercapture']) svg.addEventListener(type, event => pointers.delete(event.pointerId));
  new ResizeObserver(() => { if (!screen.hidden) fit(true); }).observe(svg);
  new ResizeObserver(fillChatPhotoLabel).observe(screen.parentElement.querySelector('[data-profile-photo]').parentElement);
}
