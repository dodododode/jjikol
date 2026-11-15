// PC 화면: 코드를 입력해 사진을 보고, 받고, 지웁니다.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getStorage, ref, listAll, getMetadata, getDownloadURL, deleteObject }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";

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
let photos = []; // { ref, name, size, time, url, el, checked }

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

async function load() {
  if (!configured || !code) return;
  $("listPanel").hidden = false;
  $("cards").innerHTML = "";
  $("empty").hidden = true;
  $("count").textContent = "불러오는 중…";
  try {
    const res = await listAll(ref(storage, "u/" + code));
    photos = await Promise.all(res.items.map(async (r) => {
      const [m, url] = await Promise.all([getMetadata(r), getDownloadURL(r)]);
      return {
        ref: r, url, size: Number(m.size), time: m.timeCreated,
        name: (m.customMetadata && m.customMetadata.originalName) || r.name, checked: false
      };
    }));
    photos.sort((a, b) => (a.time < b.time ? 1 : -1));
    render();
  } catch (e) {
    console.error(e);
    $("count").textContent = "불러오지 못했습니다. (" + (e.code || e.message) + ")";
  }
}

function render() {
  const cards = $("cards");
  cards.innerHTML = "";
  photos.forEach((p) => {
    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML = '<div class="pic"><img loading="lazy" alt=""><input type="checkbox" aria-label="선택"></div>' +
      '<div class="info"><div class="nm"></div><div class="mt"></div></div><button type="button">받기</button>';
    el.querySelector("img").src = p.url;
    el.querySelector(".nm").textContent = p.name;
    const mt = el.querySelector(".mt");
    if (p.size === 0) { mt.className = "bad"; mt.textContent = "0KB · 잘못 올라간 사진입니다"; }
    else mt.textContent = fmtSize(p.size) + " · " + fmtTime(p.time);
    const box = el.querySelector("input");
    const toggle = (v) => { p.checked = v; box.checked = v; el.classList.toggle("sel", v); updateBar(); };
    box.addEventListener("click", (e) => { e.stopPropagation(); toggle(box.checked); });
    el.querySelector(".pic").addEventListener("click", () => toggle(!p.checked));
    el.querySelector("button").addEventListener("click", () => download([p]));
    p.el = el; p.toggle = toggle;
    cards.appendChild(el);
  });
  $("empty").hidden = photos.length > 0;
  updateBar();
}

function updateBar() {
  const n = photos.filter((p) => p.checked).length;
  $("count").textContent = `사진 ${photos.length}장` + (n ? ` · ${n}장 선택` : "");
  $("dlSel").textContent = n ? `선택한 ${n}장 받기` : "전체 받기";
  $("delSel").disabled = n === 0;
  $("selAll").textContent = n === photos.length && n > 0 ? "선택 해제" : "전체 선택";
}
$("selAll").addEventListener("click", () => {
  const all = photos.length > 0 && photos.every((p) => p.checked);
  photos.forEach((p) => p.toggle(!all));
});

// 올릴 때 "내려받기" 표시를 해 두었기 때문에 주소를 열면 바로 저장됩니다.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function download(list) {
  for (const p of list) {
    const f = document.createElement("iframe");
    f.style.display = "none";
    f.src = p.url;
    document.body.appendChild(f);
    setTimeout(() => f.remove(), 60000);
    await sleep(400);
  }
}
$("dlSel").addEventListener("click", () => {
  const sel = photos.filter((p) => p.checked);
  download(sel.length ? sel : photos);
});
$("delSel").addEventListener("click", async () => {
  const sel = photos.filter((p) => p.checked);
  if (!sel.length || !confirm(`선택한 ${sel.length}장을 서버에서 지울까요? 되돌릴 수 없습니다.`)) return;
  const failed = [];
  await Promise.all(sel.map((p) => deleteObject(p.ref).catch(() => failed.push(p))));
  if (failed.length) alert(`${failed.length}장은 지우지 못했습니다.`);
  load();
});
