/**
 * data.js — 從 temple.csv 載入景點資料
 * 欄位：編號, 名稱, 新名稱, 地址, 緯度, 經度, 開始年分, 結束年分, 說明
 * （需要先載入 csv.js）
 */

let SPOTS = [];
let _spotsReady;
const spotsReady = new Promise((resolve) => { _spotsReady = resolve; });

const CHECKIN_RADIUS = 50; // 打卡半徑（公尺）

function getCategoryById(id) {
  if ((id >= 101 && id <= 108) || (id >= 201 && id <= 212)) return "鄉社";
  if ((id >= 109 && id <= 112) || id === 301) return "官社";
  if (id >= 302 && id <= 312) return "縣社";
  return "未分類";
}

function rowToSpot(r) {
  const id = parseInt(r['編號'], 10);
  const address = r['地址'] || '';
  const cityMatch = address.match(/^(.{2,3}[縣市])/);
  const city = cityMatch ? cityMatch[1] : address.slice(0, 3);

  return {
    id,
    serial_no:   String(id),
    name:        r['名稱'],
    new_name:    r['新名稱'],
    address,
    city,
    category:    getCategoryById(id),
    emoji:       '⛩️',
    image:       `images/${id}1.jpeg`,
    imagePast:   `images/${id}1.jpeg`,   // 過去
    imageNow:    `images/${id}2.jpeg`,   // 現在
    lat:         parseFloat(r['緯度']),
    lng:         parseFloat(r['經度']),
    radius:      CHECKIN_RADIUS,
    startYear:   r['開始年分'],
    endYear:     r['結束年分'],
    period:      `${r['開始年分']}–${r['結束年分'] || '現在'}`,
    description: r['說明'],
  };
}

fetchCSVText('temple.csv')
  .then(text => {
    SPOTS = csvToObjects(text, { lastJoin: true })
      .map(rowToSpot)
      .filter(s => !isNaN(s.id) && !isNaN(s.lat));
    _spotsReady(SPOTS);
  })
  .catch(err => {
    console.error('CSV 載入失敗：', err);
    document.body.innerHTML =
      `<div style="padding:2rem;font-family:sans-serif;color:#B22222;">
         <strong>⚠️ 無法載入景點資料</strong><br>
         請確認 <code>temple.csv</code> 和 <code>card.html</code> 放在同一個資料夾。<br><br>
         錯誤訊息：${err.message}
       </div>`;
  });
