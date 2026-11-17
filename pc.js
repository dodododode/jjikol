// PC 화면: 코드를 입력해 사진을 받습니다. 제대로 받은 사진은 서버에서 바로 지웁니다.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getStorage, ref, listAll, getMetadata, getDownloadURL, deleteObject, getBlob }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";
import { makeZip } from "./zip.js";

const APP = window.APP;
const $ = (id) => document.getElementById(id);
window.__booted = true;
document.querySelectorAll(".app-name").forEach((el) => (el.textContent = APP.name));
document.title = APP.name + " - 사진 받기";

const configured = !String(APP.firebase.apiKey).startsWith("여기에");
const storage = configured ? getStorage(initializeApp(APP.firebase)) : null;
if (!configured) {
  $("bootMsg").textContent = "config.js에 Firebase 설정값을 넣어야 사진을 볼 수 있습니다.";
  $("bootMsg").hidden = false;
}

let code = "";
let photos = []; // { ref, name, size, time, url, el, checked, bad }
let busy = false;

const clean = (v) => v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
$("codeInput").addEventListener("input", (e) => {
  const c = clean(e.target.value);
  e.target.value = c.length > 4 ? c.slice(0, 4) + "-" + c.slice(4) : c;
});
$("codeForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const c = clean($("codeInput").value);
  if (c.length !== 8) { alert("코드는 8자리입니다."); return; }
  code = c;
  load();
});
$("reload").addEventListener("click", load);

const fmtSize = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + "MB" : Math.max(1, Math.round(b / 1024)) + "KB");
const fmtTime = (t) => {
  const d = new Date(t), p = (n) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const RETRY = "폰에서 다시 올려주세요";

// 목록은 곧바로 띄우고, 사진마다 정보와 미리보기를 따로 채웁니다.
// 미리보기는 폰이 함께 올려 둔 작은 사진(_t_로 시작)을 씁니다. 원본은 받을 때만 내려받습니다.
async function load() {
  if (!configured || !code || busy) return;
  $("listPanel").hidden = false;
  $("cards").innerHTML = "";
  $("empty").hidden = true;
  $("resultMsg").hidden = true;
  $("zipMsg").hidden = true;
  $("count").textContent = "불러오는 중…";
  try {
    const res = await listAll(ref(storage, "u/" + code));
    const previews = new Map(), originals = [];
    res.items.forEach((r) => (r.name.startsWith("_t_") ? previews.set(r.name, r) : originals.push(r)));
    // 파일 이름이 올린 시각으로 시작하므로, 이름 순서가 곧 올린 순서입니다. (최근 것이 앞)
    originals.sort((x, y) => (x.name < y.name ? 1 : -1));
    photos = originals.map((r) => {
      const key = "_t_" + r.name + ".jpg";
      const p = { ref: r, preview: previews.get(key) || null, name: r.name, size: null, time: "", checked: false, bad: "" };
      previews.delete(key);
      return p;
    });
    // 원본이 이미 지워진 미리보기는 정리합니다.
    previews.forEach((r) => deleteObject(r).catch(() => {}));
    render();
    photos.forEach((p) => {
      p.meta = getMetadata(p.ref).then((m) => {
        p.size = Number(m.size); p.time = m.timeCreated;
        p.name = (m.customMetadata && m.customMetadata.originalName) || p.ref.name;
        if (p.size === 0) p.bad = "잘못 올라간 사진 · " + RETRY;
        if (p.el) { p.el.querySelector(".nm").textContent = p.name; paintInfo(p); }
      }).catch(() => { p.size = -1; if (p.el) paintInfo(p); });
    });
  } catch (e) {
    console.error(e);
    $("count").textContent = "불러오지 못했습니다. (" + (e.code || e.message) + ")";
  }
}
function removeFromServer(p) {
  return deleteObject(p.ref).then(() => { if (p.preview) deleteObject(p.preview).catch(() => {}); });
}

function paintInfo(p) {
  const mt = p.el.querySelector(".info > div:last-child");
  if (p.bad) { mt.className = "bad"; mt.textContent = p.bad; p.el.style.borderColor = "#b3261e"; }
  else if (p.size == null) { mt.className = "mt"; mt.textContent = "불러오는 중…"; }
  else if (p.size < 0) { mt.className = "mt"; mt.textContent = "정보를 불러오지 못했습니다"; }
  else { mt.className = "mt"; mt.textContent = fmtSize(p.size) + " · " + fmtTime(p.time); p.el.style.borderColor = ""; }
}
function render() {
  const cards = $("cards");
  cards.innerHTML = "";
  photos.forEach((p) => {
    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML = '<div class="pic"><img alt=""><input type="checkbox" aria-label="선택"></div>' +
      '<div class="info"><div class="nm"></div><div class="mt"></div></div><button type="button">받기</button>';
    const img = el.querySelector("img");
    // 미리보기가 있으면 그것을, 없으면(예전에 올린 사진) 원본을 보여줍니다.
    let usingPreview = !!p.preview;
    const show = (r) => getDownloadURL(r).then((u) => { img.src = u; });
    img.addEventListener("error", () => {
      if (usingPreview) { usingPreview = false; show(p.ref).catch(() => {}); }
      else if (!p.bad) { p.bad = "사진이 열리지 않음 · " + RETRY; paintInfo(p); }
    });
    show(p.preview || p.ref).catch(() => { if (usingPreview) { usingPreview = false; show(p.ref).catch(() => {}); } });
    el.querySelector(".nm").textContent = "";
    const box = el.querySelector("input");
    p.el = el;
    p.toggle = (v) => { p.checked = v; box.checked = v; el.classList.toggle("sel", v); updateBar(); };
    box.addEventListener("click", (e) => { e.stopPropagation(); p.toggle(box.checked); });
    el.querySelector(".pic").addEventListener("click", () => p.toggle(!p.checked));
    el.querySelector("button").addEventListener("click", () => receive([p], false));
    paintInfo(p);
    cards.appendChild(el);
  });
  $("empty").hidden = photos.length > 0;
  updateBar();
}

function updateBar() {
  const n = photos.filter((p) => p.checked).length;
  $("count").textContent = `사진 ${photos.length}장` + (n ? ` · ${n}장 선택` : "");
  if (!busy) {
    $("dlZip").textContent = n ? `${n}장 압축파일로 받기` : "전체 압축파일로 받기";
    $("dlSel").textContent = n ? `${n}장 하나씩 받기` : "전체 하나씩 받기";
  }
  $("dlZip").disabled = busy || photos.length === 0;
  $("dlSel").disabled = busy || photos.length === 0;
  $("delSel").disabled = busy || n === 0;
  $("selAll").textContent = n === photos.length && n > 0 ? "선택 해제" : "전체 선택";
}
$("selAll").addEventListener("click", () => {
  const all = photos.length > 0 && photos.every((p) => p.checked);
  photos.forEach((p) => p.toggle(!all));
});

// ── 받기 ──────────────────────────────────
function uniqueName(name, used) {
  let n = name, i = 2;
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : "";
  while (used.has(n.toLowerCase())) n = `${base} (${i++})${ext}`;
  used.add(n.toLowerCase());
  return n;
}
function saveBlob(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
// 서버에서 읽어 온 크기가 올릴 때 크기와 같아야 "제대로 받은 것"으로 봅니다.
async function fetchPhoto(p) {
  await p.meta; // 크기 정보가 올 때까지 기다립니다
  if (p.size === 0) throw new Error("empty");
  if (p.size < 0) throw new Error("no-info");
  const blob = await getBlob(p.ref);
  if (blob.size !== p.size) throw new Error("size-mismatch");
  return blob;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function receive(list, asZip) {
  if (busy || !list.length) return;
  busy = true;
  $("resultMsg").hidden = true;
  $("zipMsg").hidden = true;
  updateBar();
  const btn = asZip ? $("dlZip") : $("dlSel");
  const good = [], used = new Set(), files = [];

  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    btn.textContent = `받는 중 ${i + 1} / ${list.length}`;
    try {
      const blob = await fetchPhoto(p);
      const name = uniqueName(p.name, used);
      if (asZip) files.push({ name, data: new Uint8Array(await blob.arrayBuffer()), date: new Date(p.time) });
      else { saveBlob(blob, name); await sleep(300); }
      good.push(p);
    } catch (e) {
      console.error(e);
      p.bad = "받지 못함 · " + RETRY;
      paintInfo(p);
    }
  }

  let saved = true;
  if (asZip && good.length) {
    try {
      const d = new Date(), p2 = (n) => String(n).padStart(2, "0");
      saveBlob(makeZip(files), `${APP.name}_${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}_${good.length}장.zip`);
    } catch (e) {
      console.error(e);
      saved = false;
      $("zipMsg").textContent = "압축파일을 만들지 못했습니다. \"하나씩 받기\"를 이용하세요. 사진은 지우지 않았습니다.";
      $("zipMsg").hidden = false;
    }
  }

  // 제대로 받은 사진만 서버에서 지웁니다.
  let removed = 0;
  if (saved && good.length) {
    btn.textContent = "서버에서 지우는 중…";
    await Promise.all(good.map((p) => removeFromServer(p).then(() => {
      removed++;
      p.el.remove();
      photos.splice(photos.indexOf(p), 1);
    }).catch((e) => console.error(e))));
  }

  const failed = list.length - good.length;
  if (saved) {
    let msg = good.length ? `${good.length}장을 받았고 서버에서 지웠습니다.` : "";
    if (good.length && removed < good.length) msg = `${good.length}장을 받았습니다. ${good.length - removed}장은 서버에서 지우지 못해 남아 있습니다.`;
    if (failed) msg += ` ${failed}장은 받지 못해 남겨두었습니다. 빨간 표시가 된 사진을 ${RETRY}.`;
    $("resultMsg").textContent = msg.trim();
    $("resultMsg").hidden = false;
  }
  busy = false;
  $("empty").hidden = true;
  updateBar();
}

$("dlZip").addEventListener("click", () => {
  const sel = photos.filter((p) => p.checked);
  receive(sel.length ? sel : photos.slice(), true);
});
$("dlSel").addEventListener("click", () => {
  const sel = photos.filter((p) => p.checked);
  receive(sel.length ? sel : photos.slice(), false);
});
$("delSel").addEventListener("click", async () => {
  const sel = photos.filter((p) => p.checked);
  if (!sel.length || !confirm(`선택한 ${sel.length}장을 받지 않고 서버에서 지울까요? 되돌릴 수 없습니다.`)) return;
  const failed = [];
  await Promise.all(sel.map((p) => removeFromServer(p).catch(() => failed.push(p))));
  if (failed.length) alert(`${failed.length}장은 지우지 못했습니다.`);
  load();
});

// 홈페이지에서 코드를 입력하고 넘어온 경우 바로 사진을 보여줍니다.
{
  const q = clean(new URLSearchParams(location.search).get("code") || "");
  if (q.length === 8) {
    $("codeInput").value = q.slice(0, 4) + "-" + q.slice(4);
    code = q;
    load();
  }
}
