/* 個人頁的階段線索。文章是遊戲內頁面，不會連往外部網站。 */
function hasRelicsArticle() {
  const player = window.taiwanChat?.player;
  return !!(player && !player.removed && player.tasks?.['taiwan-stage2-other-place'] && !player.tasks?.['taiwan-stage3-memory']);
}

function renderChatFollowing() {
  const container = document.querySelector('#taiwan-chat [data-profile-following]');
  if (!container) return;
  container.replaceChildren();
  if (!hasRelicsArticle()) {
    const empty = document.createElement('div');
    empty.className = 'chat-profile-placeholder';
    empty.textContent = '尚無公開的關注內容';
    container.appendChild(empty);
    return;
  }
  const link = document.createElement('button');
  link.type = 'button';
  link.className = 'profile-followed-article';
  link.innerHTML = '<span class="profile-followed-avatar" aria-hidden="true">瑤</span><span><strong>臺灣神社遺物去向整理</strong><small>瑤瑤寶寶 · yaoyaobaby0911</small></span><span aria-hidden="true">↗</span>';
  link.addEventListener('click', () => showTaiwanChatScreen('article'));
  container.appendChild(link);
  const historyLink = document.createElement('button');
  historyLink.type = 'button';
  historyLink.className = 'profile-followed-article';
  historyLink.dataset.article = 'name-history';
  historyLink.innerHTML = '<span class="profile-followed-avatar" aria-hidden="true">墨</span><span><strong>臺灣神社名稱進化史</strong><small>起墨汁世家 · inkinkinkink</small></span><span aria-hidden="true">↗</span>';
  historyLink.addEventListener('click', () => showTaiwanChatScreen('name-history'));
  container.appendChild(historyLink);
  const travelLink = document.createElement('button');
  travelLink.type = 'button';
  travelLink.className = 'profile-followed-article';
  travelLink.dataset.article = 'taipei-travel';
  travelLink.innerHTML = '<span class="profile-followed-avatar" aria-hidden="true">喵</span><span><strong>台北遊記0922</strong><small>＊↖(＾ω＾)↗＊ · cat1314520</small></span><span aria-hidden="true">↗</span>';
  travelLink.addEventListener('click', () => showTaiwanChatScreen('taipei-travel'));
  container.appendChild(travelLink);
  const paintingsLink = document.createElement('button');
  paintingsLink.type = 'button';
  paintingsLink.className = 'profile-followed-article';
  paintingsLink.dataset.article = 'nasu-paintings';
  paintingsLink.innerHTML = '<span class="profile-followed-avatar profile-avatar-blue" aria-hidden="true">緯</span><span><strong>那須雅城的畫作之三</strong><small>大緯 · a912630335</small></span><span aria-hidden="true">↗</span>';
  paintingsLink.addEventListener('click', () => showTaiwanChatScreen('nasu-paintings'));
  container.appendChild(paintingsLink);
  const treasureLink = document.createElement('button');
  treasureLink.type = 'button';
  treasureLink.className = 'profile-followed-article';
  treasureLink.dataset.article = 'treasure-log';
  treasureLink.innerHTML = '<span class="profile-followed-avatar profile-avatar-blue" aria-hidden="true">韓</span><span><strong>尋寶記(0903更新)</strong><small>韓子建 · ryanhandsome1111</small></span><span aria-hidden="true">↗</span>';
  treasureLink.addEventListener('click', () => showTaiwanChatScreen('treasure-log'));
  container.appendChild(treasureLink);
  const tourLink = document.createElement('button');
  tourLink.type = 'button';
  tourLink.className = 'profile-followed-article';
  tourLink.dataset.article = 'grand-hotel-photos';
  tourLink.innerHTML = '<span class="profile-followed-avatar" aria-hidden="true">獅</span><span><strong>圓山大飯店合影</strong><small>雌獅旅行團 · 0982110k23</small></span><span aria-hidden="true">↗</span>';
  tourLink.addEventListener('click', () => showTaiwanChatScreen('grand-hotel-photos'));
  container.appendChild(tourLink);
}

function appendRelicsArticle(dialog) {
  const screen = document.createElement('section');
  screen.className = 'chat-screen relics-site';
  screen.dataset.screen = 'article';
  screen.hidden = true;
  screen.innerHTML = `
    <header class="relics-toolbar"><button type="button" data-article-back>← 返回個人頁</button><span>瑤瑤的追蹤筆記</span></header>
    <div class="relics-scroll" tabindex="0" aria-label="臺灣神社遺物去向整理文章">
      <article class="relics-article">
        <p class="relics-eyebrow">走走看看 · 遺物筆記</p>
        <h1>臺灣神社遺物去向整理</h1>
        <div class="relics-author"><span class="relics-avatar" aria-hidden="true">瑤</span><div><strong>瑤瑤寶寶</strong><span>yaoyaobaby0911</span></div></div>
        <p>這是我追查部分的台灣神社遺物，很用心在追蹤，喜歡可以幫我點讚分享&lt;3</p>
        <table class="relics-table">
          <thead><tr><th scope="col">遺物</th><th scope="col">去向</th></tr></thead>
          <tbody>
            <tr><th scope="row">圓山飯店石獅</th><td>圓山大飯店外</td></tr>
            <tr><th scope="row">劍潭公園狛犬</th><td>劍潭公園</td></tr>
            <tr><th scope="row">獨木大鼓</th><td>國立臺灣博物館<span class="relics-note">(不開放參觀)</span></td></tr>
            <tr><th scope="row">銅犬</th><td>國立臺灣博物館<span class="relics-note">(展出未明？)</span></td></tr>
            <tr><th scope="row">《新高山之圖》</th><td>國立臺灣博物館<span class="relics-note">(展出未明？)</span></td></tr>
            <tr><th scope="row">《高御座之圖》</th><td>國立臺灣博物館<span class="relics-note">(展出未明？)</span></td></tr>
          </tbody>
        </table>
        <aside class="relics-aside">＊展出未明：網路上只查到典藏地點，沒有找到公開展出的資訊。我追了好幾年都沒等到！想去現場看實物、拍照的寶寶們，建議先找其他有開放的啦，別跟我一起傻等～</aside>
        <p class="relics-signoff">後續不定期更新，寶寶們記得追蹤我，嘻嘻～</p>
        <footer class="relics-footer"><button type="button" class="relics-like" aria-label="讚" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10v11H3V10h4Zm0 1 5-8c.4-.6 1.3-.6 1.6.1.6 1.4.6 3 .1 4.5L13 10h6.3c1.1 0 1.9 1 1.7 2.1l-1.4 7c-.2 1.1-1.2 1.9-2.3 1.9H7"/></svg><span>讚</span></button></footer>
      </article>
    </div>`;
  dialog.appendChild(screen);
  bindProfileArticle(dialog, screen, '.profile-followed-article');
  const history = screen.cloneNode(true);
  history.dataset.screen = 'name-history';
  history.querySelector('.relics-toolbar > span').textContent = '起墨汁世家的歷史筆記';
  history.querySelector('.relics-scroll').setAttribute('aria-label', '臺灣神社名稱進化史文章');
  const article = history.querySelector('.relics-article');
  const footer = article.querySelector('.relics-footer');
  article.innerHTML = `
    <p class="relics-eyebrow">歷史筆記</p>
    <h1>臺灣神社名稱進化史</h1>
    <div class="relics-author"><span class="relics-avatar" aria-hidden="true">墨</span><div><strong>起墨汁世家</strong><span>inkinkinkink</span></div></div>
    <p>1901年完工的「台灣神社」，是全台唯一的官幣大社，主要祭祀開拓三神和北白川宮能久親王；<br>(關於神明的更多介紹，歡迎到我的檔案頁面裡搜尋)</p>
    <p>1944年因增祀天照大神，正式升格為「台灣神宮」；</p>
    <p>1945年日本戰敗離台後，國民政府接收改建為「台灣大飯店」；</p>
    <p>1952年改組正式更名為「圓山大飯店」。</p>
    <p class="relics-signoff">下一篇將開始正式介紹各個時期的背景故事，敬請期待。</p>`;
  article.appendChild(footer);
  dialog.appendChild(history);
  bindProfileArticle(dialog, history, '[data-article="name-history"]');
  const paintings = screen.cloneNode(true);
  paintings.dataset.screen = 'nasu-paintings';
  paintings.querySelector('.relics-toolbar > span').textContent = '大緯的畫作筆記';
  paintings.querySelector('.relics-scroll').setAttribute('aria-label', '那須雅城的畫作之三文章');
  const paintingsArticle = paintings.querySelector('.relics-article');
  const paintingsFooter = paintingsArticle.querySelector('.relics-footer');
  paintingsArticle.innerHTML = `
    <p class="relics-eyebrow">畫作筆記</p>
    <h1>那須雅城的畫作之三</h1>
    <div class="relics-author"><span class="relics-avatar profile-avatar-blue" aria-hidden="true">緯</span><div><strong>大緯</strong><span>a912630335</span></div></div>
    <h2>1. 那須雅城《新高山之圖》</h2>
    <p>日本四條派畫家那須雅城，在1928年為了慶祝昭和天皇登基大典而來到臺灣寫生。新高山即是玉山當時的別稱。於1930年奉獻給神社，目前保存在國立臺灣博物館人類學門庫房中，展期無法確定。</p>
    <h2>2. 那須雅城《高御座之圖》</h2>
    <p>正式名稱為《紫宸殿高御座圖》。「高御座」是日本天皇登基大典時所坐的寶座。1928年11月正值昭和天皇舉辦登基大典（御大典），那須雅城將這幅繪有京都御所紫宸殿登基寶座的《紫宸殿高御座圖》正式奉獻給臺灣神社。目前保存於國立臺灣博物館中，展期無法確定。</p>
    <h2>3. 那須雅城《酒麿圖》</h2>
    <p>畫作上落款有「豐慶筆」字樣，描繪奈良時代的歷史人物「川部酒麿」：他擔任日本遣唐使船隻的舵手，在歸國途中遭遇大火。當時他臨危不亂、果斷轉舵，利用風向將火勢撲滅，成功保住了整船官員的性命與珍貴文物，事後立下大功。《酒麿圖》在戰後與其他神社文物一起移交給臺博館，展期無法確定。</p>
    <p>三個非常有意義的作品都無法確定展期，沒辦法親眼目睹，是真的相當可惜啊。</p>
    <h2>同場加碼：木下靜涯《臺灣神社》</h2>
    <p>這幅膠彩畫並非奉納品，而是直接描繪日治後期「臺灣神社」外觀景致的藝術創作。目前典藏於國美館。</p>`;
  paintingsArticle.appendChild(paintingsFooter);
  dialog.appendChild(paintings);
  bindProfileArticle(dialog, paintings, '[data-article="nasu-paintings"]');
  const travel = screen.cloneNode(true);
  travel.dataset.screen = 'taipei-travel';
  travel.querySelector('.relics-toolbar > span').textContent = '旅遊日記';
  travel.querySelector('.relics-scroll').setAttribute('aria-label', '台北遊記0922文章');
  const travelArticle = travel.querySelector('.relics-article');
  const travelFooter = travelArticle.querySelector('.relics-footer');
  travelArticle.innerHTML = `
    <p class="relics-eyebrow">走走看看 · 遊記</p>
    <h1>台北遊記0922</h1>
    <div class="relics-author"><span class="relics-avatar" aria-hidden="true">喵</span><div><strong>＊↖(＾ω＾)↗＊</strong><span>cat1314520</span></div></div>
    <p>第一站劍潭公園～</p>
    <p>有台灣神宮的狛犬～好可愛～到底是想到大中午來戶外的～熱死人啦～(／‵Дˊ)／~ ╧╧</p>
    <p>第二站二二八公園～</p>
    <p>裡面有急公好義坊～有一座石獅～(๑´ㅂ&#96;๑)</p>
    <p>第三站臺灣博物館～</p>
    <p>我就是來看古生物展的～對的我的自我認同就是一個古生物～外面還有可可愛愛的銅牛～(((o(*ﾟ▽ﾟ*)o)))</p>
    <p class="relics-signoff">總之今天相當充實～明天去基隆～</p>`;
  travelArticle.appendChild(travelFooter);
  dialog.appendChild(travel);
  bindProfileArticle(dialog, travel, '[data-article="taipei-travel"]');
  const treasure = screen.cloneNode(true);
  treasure.dataset.screen = 'treasure-log';
  treasure.querySelector('.relics-toolbar > span').textContent = '韓子建的尋寶記';
  treasure.querySelector('.relics-scroll').setAttribute('aria-label', '尋寶記(0903更新)文章');
  const treasureArticle = treasure.querySelector('.relics-article');
  const treasureFooter = treasureArticle.querySelector('.relics-footer');
  treasureArticle.innerHTML = `
    <p class="relics-eyebrow">尋寶筆記</p>
    <h1>尋寶記(0903更新)</h1>
    <div class="relics-author"><span class="relics-avatar profile-avatar-blue" aria-hidden="true">韓</span><div><strong>韓子建</strong><span>ryanhandsome1111</span></div></div>
    <p>桃園神社：<br>鳥居 (1/1)<br>手水舍 (1/1)<br>狛犬(以對數計) (1/1)</p>
    <p>玉里神社：<br>鳥居 (0/2)<br>表忠碑 (0/1)</p>
    <p>金瓜石神社：<br>鳥居 (1/1)<br>旗桿座 (0/1)</p>
    <p>林田神社：<br>本殿臺基 (1/1)<br>玉垣 (0/1)</p>
    <p>台灣神宮：<br>狛犬(以對數計) (2/3)<br>銅牛 (1/1)<br>百年金龍 (1/1)<br>石燈籠 (0/1)</p>
    <p>通霄神社：<br>鳥居 (1/2)<br>拜殿 (1/1)<br>社務所 (0/1)</p>
    <p>花蓮港神社：<br>銅馬 (0/1)</p>
    <p class="relics-signoff">全部找完我就要跟孫亦雰告白哈哈</p>`;
  treasureArticle.appendChild(treasureFooter);
  dialog.appendChild(treasure);
  bindProfileArticle(dialog, treasure, '[data-article="treasure-log"]');
  const tour = screen.cloneNode(true);
  tour.dataset.screen = 'grand-hotel-photos';
  tour.querySelector('.relics-toolbar > span').textContent = '雌獅旅行團';
  tour.querySelector('.relics-scroll').setAttribute('aria-label', '圓山大飯店合影文章');
  const tourArticle = tour.querySelector('.relics-article');
  const tourFooter = tourArticle.querySelector('.relics-footer');
  const brokenPhoto = '<span class="profile-broken-photo" role="img" aria-label="圖片無法載入"><svg viewBox="0 0 24 20" aria-hidden="true"><path d="M9 2H2v16h20V2h-7M4 15l5-5 4 4 3-3 4 4M12 1l-2 5 4 3-2 5"/><circle cx="6" cy="6" r="1"/></svg></span>';
  tourArticle.innerHTML = `
    <p class="relics-eyebrow">旅行合影</p>
    <h1>圓山大飯店合影</h1>
    <div class="relics-author"><span class="relics-avatar" aria-hidden="true">獅</span><div><strong>雌獅旅行團</strong><span>0982110k23</span></div></div>
    <figure class="profile-tour-photo">${brokenPhoto}<figcaption>百年金龍合照</figcaption></figure>
    <figure class="profile-tour-photo">${brokenPhoto}<figcaption>門口狛犬合照</figcaption></figure>
    <figure class="profile-tour-photo">${brokenPhoto}<figcaption>石燈籠合照</figcaption></figure>
    <p class="relics-signoff">想報名請撥打電話0982110k23</p>`;
  tourArticle.appendChild(tourFooter);
  dialog.appendChild(tour);
  bindProfileArticle(dialog, tour, '[data-article="grand-hotel-photos"]');
}

function bindProfileArticle(dialog, screen, returnSelector) {
  screen.querySelector('[data-article-back]').addEventListener('click', () => {
    showTaiwanChatScreen('profile');
    dialog.querySelector(returnSelector)?.focus();
  });
  const like = screen.querySelector('.relics-like');
  like.addEventListener('click', () => {
    const pressed = like.getAttribute('aria-pressed') !== 'true';
    like.setAttribute('aria-pressed', String(pressed));
    like.setAttribute('aria-label', pressed ? '取消讚' : '讚');
  });
}
