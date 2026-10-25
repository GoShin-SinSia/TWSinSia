/**
 * script.js — 地圖首頁
 * 手機（寬度 ≤ 640px）：點標記直接從下方滑出詳情；電腦：先出小視窗再看詳情
 * 需要先載入 leaflet.js、csv.js、credits.js
 */

let places = [];
let markers = [];
let activeCategory = null; // null = 全部

// 設定外部 Wiki 的網域名稱 (目前先用佔位符，決定平台後可修改此處，例如 "https://zh.wikipedia.org/wiki")
const WIKI_DOMAIN = "https://your-wiki-domain.com";

const isMobile = () => window.matchMedia("(max-width: 640px)").matches;

// 初始化 Leaflet 地圖，中心點預設在臺北
const map = L.map("map", { zoomControl: true }).setView([25.0173, 121.5397], 15);

L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap",
  maxZoom: 19,
}).addTo(map);

// 取得 HTML 元素
const xiangCount = document.getElementById("xiangCount");
const guanCount = document.getElementById("guanCount");
const xianCount = document.getElementById("xianCount");
const viewAll = document.getElementById("viewAll");
const chips = document.querySelectorAll(".count-chip");

/* ==========================================
   讀取 temple.csv
   ========================================== */

async function loadCSV() {
  const text = await fetchCSVText("temple.csv");
  places = csvToObjects(text, { lastJoin: true }).map(place => {
    place.id = Number(place.id || place.編號);
    place.lat = Number(place.lat || place.緯度);
    place.lng = Number(place.lng || place.經度);
    place.category = getCategoryById(place.id);
    return place;
  }).filter(p => !isNaN(p.id));
}

// 用編號判斷分類
function getCategoryById(id) {
  if ((id >= 101 && id <= 108) || (id >= 201 && id <= 212)) return "鄉社";
  if ((id >= 109 && id <= 112) || id == 301) return "官社";
  if (id >= 302 && id <= 312) return "縣社";
  return "未分類";
}

function updateCounts() {
  const n = cat => places.filter(p => p.category === cat).length;
  xiangCount.textContent = `鄉社：${n("鄉社")}`;
  guanCount.textContent = `官社：${n("官社")}`;
  xianCount.textContent = `縣社：${n("縣社")}`;
}

/* ==========================================
   標記：依社格上色，標記上寫「官／縣／鄉」
   ========================================== */

const CAT_CLASS = { "官社": "guan", "縣社": "xian", "鄉社": "xiang" };

function shrineIcon(category) {
  const cls = CAT_CLASS[category] || "other";
  return L.divIcon({
    className: `shrine-pin ${cls}`,
    html: `<span><i>${(category || "社").charAt(0)}</i></span>`,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -30],
  });
}

function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderMap(targetPlaces) {
  markers.forEach(marker => map.removeLayer(marker));
  markers = [];

  targetPlaces.forEach(place => {
    if (!place.lat || !place.lng) return;
    const marker = L.marker([place.lat, place.lng], {
      icon: shrineIcon(place.category),
      title: place.名稱,
      alt: place.名稱,
      riseOnHover: true,
    }).addTo(map);

    marker.on("click", () => {
      if (isMobile()) {
        openPlaceModal(place);
        return;
      }
      L.popup({ autoPan: true, offset: [0, -28] })
        .setLatLng(marker.getLatLng())
        .setContent(`
          <div class="mini-popup">
            <strong>${escapeHTML(place.名稱)}</strong>
            <button onclick="openPlaceModalById('${place.編號}')">詳細資訊</button>
          </div>`)
        .openOn(map);
    });

    markers.push(marker);
  });
}

function fitMarkers() {
  if (!markers.length) return;
  map.fitBounds(L.featureGroup(markers).getBounds(), {
    padding: isMobile() ? [30, 30] : [50, 50],
    maxZoom: 15,
  });
}

/* ==========================================
   篩選
   ========================================== */

function setActiveChip(category) {
  activeCategory = category;
  chips.forEach(chip => {
    const on = chip.dataset.cat === category;
    chip.classList.toggle("active", on);
    chip.setAttribute("aria-pressed", String(on));
  });
}

function showCategory(category) {
  // 再按一次已選的分類 = 取消篩選
  if (activeCategory === category) { showAllPlaces(); return; }
  setActiveChip(category);
  renderMap(places.filter(place => place.category === category));
  fitMarkers();
}

function showAllPlaces() {
  setActiveChip(null);
  renderMap(places);
  fitMarkers();
}

chips.forEach(chip => chip.addEventListener("click", () => showCategory(chip.dataset.cat)));
viewAll.addEventListener("click", showAllPlaces);

/* ==========================================
   定位按鈕（地圖右下角）
   ========================================== */

let meMarker = null;
const LocateControl = L.Control.extend({
  options: { position: "bottomright" },
  onAdd() {
    const btn = L.DomUtil.create("button", "locate-btn");
    btn.type = "button";
    btn.title = "我的位置";
    btn.setAttribute("aria-label", "移到我的位置");
    btn.innerHTML = "◎";
    L.DomEvent.disableClickPropagation(btn);
    L.DomEvent.on(btn, "click", () => {
      btn.classList.add("loading");
      map.locate({ setView: true, maxZoom: 16, enableHighAccuracy: true });
    });
    return btn;
  },
});
map.addControl(new LocateControl());

map.on("locationfound", (e) => {
  document.querySelector(".locate-btn")?.classList.remove("loading");
  if (!meMarker) {
    meMarker = L.circleMarker(e.latlng, {
      radius: 8, color: "#fff", weight: 3, fillColor: "#2B7BE4", fillOpacity: 1,
    }).addTo(map);
  } else {
    meMarker.setLatLng(e.latlng);
  }
});
map.on("locationerror", (e) => {
  document.querySelector(".locate-btn")?.classList.remove("loading");
  alert("無法取得位置：" + e.message);
});

// 手機轉向、網址列收合時重新計算地圖大小
window.addEventListener("resize", () => map.invalidateSize());

/* ==========================================
   啟動
   ========================================== */

window.addEventListener("DOMContentLoaded", async () => {
  try {
    await loadCSV();
  } catch (e) {
    console.error("temple.csv 載入失敗", e);
    return;
  }
  updateCounts();
  renderMap(places);
  map.invalidateSize();
});

/* ==========================================
   神社詳情（電腦：置中視窗；手機：從下方滑出）
   ========================================== */

const placeModal = document.getElementById("placeModal");
const closeModalBtn = document.getElementById("closeModal");
const modalTitle = document.getElementById("modalTitle");
const modalPhotoTitle = document.getElementById("modalPhotoTitle");
const modalPhoto = document.getElementById("modalPhoto");
const modalAddress = document.getElementById("modalAddress");
const modalCategory = document.getElementById("modalCategory");
const modalPeriod = document.getElementById("modalPeriod");
const modalDescription = document.getElementById("modalDescription");
const modalNav = document.getElementById("modalNav");
const pastBtn = document.getElementById("pastBtn");
const nowBtn = document.getElementById("nowBtn");

let currentPlace = null;

function openPlaceModal(place) {
  currentPlace = place;
  map.closePopup();

  modalCategory.textContent = place.category;
  modalCategory.className = "place-cat " + (CAT_CLASS[place.category] || "");
  const start = place.開始年分 || "不詳";
  const end = place.結束年分 || "現在";
  modalPeriod.textContent = `${start} – ${end}`;
  modalAddress.textContent = place.地址 || "暫無資料";
  modalDescription.textContent = place.說明 || "暫無說明";
  modalNav.href = `https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}&travelmode=walking`;

  showModalPhoto("past");
  placeModal.querySelector(".modal-card").scrollTop = 0;
  placeModal.classList.remove("hidden");
  closeModalBtn.focus({ preventScroll: true });
}

function closePlaceModal() {
  placeModal.classList.add("hidden");
  currentPlace = null;
}

function showModalPhoto(mode) {
  if (!currentPlace) return;
  const id = currentPlace.編號;
  const oldName = currentPlace.名稱;
  const newName = currentPlace.新名稱 || currentPlace.名稱;
  const src = `images/${id}${mode === "past" ? 1 : 2}.jpeg`;

  modalTitle.textContent = oldName;
  // 過去照片的名稱和標題一樣，不重複顯示；現在照片顯示現址名稱
  modalPhotoTitle.textContent = mode === "past" ? "" : `現址：${newName}`;
  modalPhoto.src = src;
  modalPhoto.alt = mode === "past" ? oldName : newName;
  pastBtn.classList.toggle("active", mode === "past");
  nowBtn.classList.toggle("active", mode === "now");

  // 影像出處（credits.js）
  renderCredit(document.getElementById("modalPhotoCredit"), src);
}

pastBtn.addEventListener("click", () => showModalPhoto("past"));
nowBtn.addEventListener("click", () => showModalPhoto("now"));
closeModalBtn.addEventListener("click", closePlaceModal);
placeModal.addEventListener("click", (event) => {
  if (event.target === placeModal) closePlaceModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !placeModal.classList.contains("hidden")) closePlaceModal();
});

// 手機：把上方的小橫條往下拖就能關閉
(function enableSwipeDown() {
  const card = placeModal.querySelector(".modal-card");
  const handle = placeModal.querySelector(".sheet-handle");
  let startY = null, dy = 0;
  const start = (e) => {
    if (!isMobile()) return;
    if (e.target !== handle && card.scrollTop > 0) return; // 內容捲動中不攔截
    startY = e.touches[0].clientY; dy = 0;
    card.style.transition = "none";
  };
  const move = (e) => {
    if (startY == null) return;
    dy = Math.max(0, e.touches[0].clientY - startY);
    if (dy > 0) card.style.transform = `translateY(${dy}px)`;
  };
  const end = () => {
    if (startY == null) return;
    card.style.transition = "";
    card.style.transform = "";
    if (dy > 90) closePlaceModal();
    startY = null;
  };
  card.addEventListener("touchstart", start, { passive: true });
  card.addEventListener("touchmove", move, { passive: true });
  card.addEventListener("touchend", end);
  card.addEventListener("touchcancel", end);
})();

function openPlaceModalById(id) {
  const place = places.find(place => String(place.編號) === String(id));
  if (place) openPlaceModal(place);
}
