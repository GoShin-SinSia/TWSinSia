// 儲存當前年份可見的廟宇資料
let places = []; 
let markers = []; 

// 設定外部 Wiki 的網域名稱 (目前先用佔位符，決定平台後可修改此處，例如 "https://zh.wikipedia.org/wiki")
const WIKI_DOMAIN = "https://your-wiki-domain.com";

// 初始化 Leaflet 地圖，中心點預設在臺北
const map = L.map("map").setView([25.0173, 121.5397], 15);

L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap"
}).addTo(map);

// 取得 HTML 元素
const xiangCount = document.getElementById("xiangCount");
const guanCount = document.getElementById("guanCount");
const xianCount = document.getElementById("xianCount");
const showXiang = document.getElementById("showXiang");
const showGuan = document.getElementById("showGuan");
const showXian = document.getElementById("showXian");
const viewAll = document.getElementById("viewAll");

// 讀取 CSV

async function loadCSV() {
  const response = await fetch("temple.csv");
  const text = await response.text();
  const rows = text.trim().split("\n");
  const headers = rows[0].split(",").map(h => h.trim());

  places = rows.slice(1).map(row => {
    const values = row.split(",");
    const place = {};

    headers.forEach((header, index) => {
      place[header] = values[index]?.trim();
    });

    place.id = Number(place.id || place.編號);
    place.lat = Number(place.lat || place.緯度);
    place.lng = Number(place.lng || place.經度);
    place.category = getCategoryById(place.id);

    return place;
  });
}

// 用編號判斷分類

function getCategoryById(id) {
  if ((id >= 101 && id <= 108) || (id >= 201 && id <= 212)) {
    return "鄉社";
  }

  if ((id >= 109 && id <= 112) || id == 301) {
    return "官社";
  }

  if (id >= 302 && id <= 312) {
    return "縣社";
  }

  return "未分類";
}

// 更新統計

function updateCounts() {
  const xiangTotal = places.filter(place => place.category === "鄉社").length;
  const guanTotal = places.filter(place => place.category === "官社").length;
  const xianTotal = places.filter(place => place.category === "縣社").length;

  xiangCount.textContent = `鄉社：${xiangTotal}`;
  guanCount.textContent = `官社：${guanTotal}`;
  xianCount.textContent = `縣社：${xianTotal}`;
}

// 顯示地圖標記

function renderMap(targetPlaces) {
  markers.forEach(marker => map.removeLayer(marker));
  markers = [];

  targetPlaces.forEach(place => {
    if (!place.lat || !place.lng) return;
    const marker = L.marker([place.lat, place.lng])
      .addTo(map)
      .bindPopup(`
        <div class="mini-popup">
          <strong>${place.名稱}</strong>
          <button onclick="openPlaceModalById('${place.編號}')">
            詳細資訊
          </button>
        </div>
      `, {
        autoPan: true
      });

    markers.push(marker);
  });

}

// 顯示特定分類

function showCategory(category) {
  const filteredPlaces = places.filter(
    place => place.category === category
  );

  renderMap(filteredPlaces);

  if (markers.length > 0) {
    const group = L.featureGroup(markers);
    map.fitBounds(group.getBounds(), {
      padding: [50, 50]
    });
  }
}

// 顯示全部

function showAllPlaces() {
  renderMap(places);
}

// 顯示全部並自動縮放

function fitAllMarkers() {
  if (markers.length > 0) {
    const group = L.featureGroup(markers);
    map.fitBounds(group.getBounds(), {
      padding: [50, 50]
    });
  }
}

// 按鈕事件

showXiang.addEventListener("click", function () {
  showCategory("鄉社");
});

showGuan.addEventListener("click", function () {
  showCategory("官社");
});

showXian.addEventListener("click", function () {
  showCategory("縣社");
});

viewAll.addEventListener("click", function () {
  showAllPlaces();
  fitAllMarkers();
});

// 網頁載入後讀 temple.csv

window.addEventListener("DOMContentLoaded", async () => {
  await loadCSV();
  updateCounts();
  showAllPlaces();
});

function showPhoto(id, mode, oldName, newName) {
  const img = document.getElementById(`photo-img-${id}`);
  const title = document.getElementById(`photo-title-${id}`);
  if (mode === "past") {
    img.src = `images/${id}1.jpeg`;
    img.alt = oldName;
    title.textContent = oldName;
  }

  if (mode === "now") {
    img.src = `images/${id}2.jpeg`;
    img.alt = newName;
    title.textContent = newName;
  }
}

const placeModal = document.getElementById("placeModal");
const closeModal = document.getElementById("closeModal");
const modalTitle = document.getElementById("modalTitle");
const modalPhotoTitle = document.getElementById("modalPhotoTitle");
const modalPhoto = document.getElementById("modalPhoto");
const modalAddress = document.getElementById("modalAddress");
const modalStartYear = document.getElementById("modalStartYear");
const modalEndYear = document.getElementById("modalEndYear");
const modalDescription = document.getElementById("modalDescription");
const pastBtn = document.getElementById("pastBtn");
const nowBtn = document.getElementById("nowBtn");

let currentPlace = null;

function openPlaceModal(place) {
  currentPlace = place;
  placeModal.classList.remove("hidden");
  modalAddress.textContent = place.地址 || "暫無資料";
  modalStartYear.textContent = place.開始年分 || "不詳";
  modalEndYear.textContent = place.結束年分 || "不詳";
  modalDescription.textContent = place.說明 || "暫無說明";
  showModalPhoto("past");
}

function showModalPhoto(mode) {
  if (!currentPlace) return;
  const id = currentPlace.編號;
  const oldName = currentPlace.名稱;
  const newName = currentPlace.新名稱 || currentPlace.名稱;

  if (mode === "past") {
    modalTitle.textContent = oldName;
    modalPhotoTitle.textContent = oldName;
    modalPhoto.src = `images/${id}1.jpeg`;
    modalPhoto.alt = oldName;
  }

  if (mode === "now") {
    modalTitle.textContent = oldName;
    modalPhotoTitle.textContent = newName;
    modalPhoto.src = `images/${id}2.jpeg`;
    modalPhoto.alt = newName;
  }
}

pastBtn.addEventListener("click", function () {
  showModalPhoto("past");
});

nowBtn.addEventListener("click", function () {
  showModalPhoto("now");
});

closeModal.addEventListener("click", function () {
  placeModal.classList.add("hidden");
});

placeModal.addEventListener("click", function (event) {
  if (event.target === placeModal) {
    placeModal.classList.add("hidden");
  }
});

function openPlaceModalById(id) {
  const place = places.find(place => String(place.編號) === String(id));
  if (!place) return;
  openPlaceModal(place);
  map.closePopup();
}