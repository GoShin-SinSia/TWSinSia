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
            <h2 class="chat-display-name"></h2><p class="chat-caption">角色資料準備中</p>
            <section class="chat-profile-section"><h3>關於我</h3><p>簡介尚未公開。</p></section>
            <section class="chat-profile-section"><h3>關注</h3><div class="chat-profile-placeholder">尚無公開的關注內容</div></section>
            <section class="chat-profile-section"><h3>貼文</h3><div class="chat-profile-placeholder">尚無貼文<p>後續內容將顯示在這裡。</p></div></section>
          </div>
        </div>
      </section>`;
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
  if (window.taiwanChat?.player?.removed) screen = 'list';
  const dialog = document.getElementById('taiwan-chat');
  dialog.querySelectorAll('[data-screen]').forEach(section => {
    section.hidden = section.dataset.screen !== screen;
  });
  dialog.querySelector(`[data-screen="${screen}"] button`)?.focus();
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
    ['重置／第一章', '第二章', '第三章', '第四章'].forEach((label, index) => {
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
  if (!CHAT_CHAPTER_TEST_MODE || chatChapterBusy || taiwanChatSaving || ![1, 2, 3, 4].includes(chapter)) return;
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
      const stages = await Promise.all(Array.from({ length: chapter }, (_, index) => loadChatStage(index + 1)));
      const missing = stages.findIndex(rows => !rows);
      if (missing !== -1) throw new Error(`第 ${missing + 1} 章檔案尚未提供`);
      const now = Date.now();
      const player = { stage: chapter, index: 0, messages: [], tasks: {}, unread: false, gate: false, dueAt: 0, typingAt: 0, nickname: chapter >= 3 ? '加藤' : '' };
      for (let stage = 1; stage < chapter; stage++) {
        for (const row of stages[stage - 1]) {
          if (['npc', 'player', 'type'].includes(row.type)) {
            player.messages.push({ key: `${stage}:${row.id}`, type: row.type === 'npc' ? 'npc' : 'player', a: row.a, b: row.type === 'player' ? '' : row.b, red: row.red });
          }
        }
        const task = CHAT_STAGE_TASKS[stage];
        if (task) player.tasks[task.id] = { activatedAt: now, completedAt: now };
      }
      const first = stages[chapter - 1][0];
      if (['npc', 'think'].includes(first.type)) {
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
