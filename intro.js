/* 首頁開場：不依賴地圖、Firebase 或外部套件。 */
(() => {
  const intro = document.getElementById('site-intro');
  if (!intro) return;

  const storageKey = 'goshin:intro-seen';
  try {
    if (sessionStorage.getItem(storageKey)) {
      intro.remove();
      return;
    }
    // 開始時即記錄，播放期間重新整理也不會重播。
    sessionStorage.setItem(storageKey, '1');
  } catch (_) {
    // 儲存空間不可用時仍可正常進入首頁。
  }

  let fallback;
  function dismiss() {
    clearTimeout(fallback);
    document.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('pagehide', dismiss);
    intro.remove();
  }
  function onKeyDown(event) {
    if (['Escape', 'Enter', ' ', 'Tab'].includes(event.key)) {
      if (event.key !== 'Tab') event.preventDefault();
      dismiss();
    }
  }

  intro.addEventListener('click', dismiss);
  intro.addEventListener('animationend', event => {
    if (event.target === intro) dismiss();
  });
  document.addEventListener('keydown', onKeyDown);
  // 避免返回瀏覽器快取頁面時再次看到尚未結束的開場。
  window.addEventListener('pagehide', dismiss);
  intro.hidden = false;
  // 比 CSS 的 4 秒動畫多留 0.2 秒；調整動畫總長時請同步更新。
  // 動畫未觸發或樣式載入失敗時也不會卡住。
  fallback = setTimeout(dismiss, 4200);
})();
