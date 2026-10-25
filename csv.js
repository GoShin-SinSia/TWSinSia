/**
 * csv.js — 共用的 CSV 讀取工具
 * - 支援雙引號包住的欄位（欄位裡可以有逗號、換行、""代表一個引號）
 * - 自動去掉 BOM
 * - 自動判斷 UTF-8 / Big5（Excel 直接存檔常是 Big5）
 * - 第一格以 # 開頭的列視為註解，整列略過
 */

function parseCSVRows(text) {
  text = String(text).replace(/^﻿/, '');
  const rows = [];
  let row = [], cell = '', inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else {
        cell += c;
      }
      continue;
    }
    if (c === '"' && cell.trim() === '') { cell = ''; inQuotes = true; }
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else {
      cell += c;
    }
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }

  return rows.filter(r => r.some(c => c.trim() !== '') && !r[0].trim().startsWith('#'));
}

/**
 * 轉成物件陣列。lastJoin：欄位數比標題多時，把多出來的併進最後一欄
 * （相容舊的 temple.csv：說明裡有逗號但沒加引號）
 */
function csvToObjects(text, { lastJoin = false } = {}) {
  const rows = parseCSVRows(text);
  if (!rows.length) return [];
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).map(cols => {
    if (lastJoin && cols.length > headers.length) {
      const extra = cols.splice(headers.length - 1);
      cols.push(extra.join(','));
    }
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (cols[i] ?? '').trim(); });
    return obj;
  });
}

// 讀檔並自動判斷編碼
async function fetchCSVText(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`無法讀取 ${url}（${res.status}）`);
  const buf = await res.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch (e) {
    try { return new TextDecoder('big5').decode(buf); }
    catch (e2) { return new TextDecoder('utf-8').decode(buf); }
  }
}

if (typeof module !== 'undefined') module.exports = { parseCSVRows, csvToObjects };
