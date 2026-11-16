// 폰 화면: 사진을 찍거나 골라서 올립니다.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getStorage, ref, uploadBytesResumable, deleteObject }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";

const APP = window.APP;
const $ = (id) => document.getElementById(id);
const bootMsg = $("bootMsg");
window.__booted = true;

document.querySelectorAll(".app-name").forEach((el) => (el.textContent = APP.name));
document.title = APP.name + " - 사진 올리기";

// ── 설정 확인 ─────────────────────────────
const configured = !String(APP.firebase.apiKey).startsWith("여기에");
let storage = null;
if (configured) {
  storage = getStorage(initializeApp(APP.firebase));
  storage.maxUploadRetryTime = 60000;
} else {
  bootMsg.textContent = "config.js에 Firebase 설정값을 넣어야 올리기가 됩니다. (사진 고르기와 미리보기는 지금도 됩니다)";
  bootMsg.hidden = false;
}

// ── 내 코드 ───────────────────────────────
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 헷갈리는 0,O,1,I 제외
function makeCode() {
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => ALPHABET[b % 32]).join("");
}
function loadCode() {
  try {
    let c = localStorage.getItem("code");
    if (!c || c.length !== 8) { c = makeCode(); localStorage.setItem("code", c); }
    return c;
  } catch (e) { return makeCode(); }
}
let code = loadCode();
const pretty = (c) => c.slice(0, 4) + "-" + c.slice(4);
function showCode() { $("code").textContent = pretty(code); $("doneCode").textContent = pretty(code); }
showCode();
$("pcUrl").textContent = new URL("./", location.href).href.replace(/^https?:\/\//, "");

$("newCode").addEventListener("click", () => {
  if (!confirm("새 코드를 만들까요?\n이전 코드로 올린 사진은 이전 코드로만 볼 수 있습니다.")) return;
  code = makeCode();
  try { localStorage.setItem("code", code); } catch (e) {}
  showCode();
});

// ── 사진 목록 ─────────────────────────────
// state: ready(고름) → wait(대기) → up(올리는 중) → done(완료) / fail(실패)
const items = [];
let seq = 0;
const grid = $("grid");

function addFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  const room = APP.maxPhotos - items.filter((i) => i.state !== "done").length;
  if (files.length > room) alert(`한 번에 ${APP.maxPhotos}장까지 올릴 수 있습니다. 앞에서부터 ${Math.max(room, 0)}장만 추가합니다.`);
  files.slice(0, Math.max(room, 0)).forEach((file) => {
    const it = { id: ++seq, file, state: "ready", pct: 0, err: "" };
    it.el = makeTile(it);
    grid.appendChild(it.el);
    items.push(it);
    thumbQueue.push(it);
  });
  $("queuePanel").hidden = false;
  $("doneBox").hidden = true;
  runThumbs();
  refresh();
}
$("fileInput").addEventListener("change", (e) => { addFiles(e.target.files); e.target.value = ""; });
$("camInput").addEventListener("change", (e) => { addFiles(e.target.files); e.target.value = ""; });

function makeTile(it) {
  const el = document.createElement("div");
  el.className = "tile";
  el.innerHTML = '<img alt=""><span class="num"></span><button class="x" type="button" aria-label="빼기">×</button><i class="fill"></i><span class="state"></span>';
  el.querySelector(".x").addEventListener("click", (e) => {
    e.stopPropagation();
    if (it.state !== "ready") return;
    items.splice(items.indexOf(it), 1);
    el.remove();
    refresh();
  });
  el.addEventListener("click", () => {
    if (it.state === "fail") { it.state = "wait"; refresh(); pump(); }
    else if (it.state === "ready") openEditor(it);
  });
  return el;
}

// 미리보기는 한 장씩 작게 만들어 메모리를 아낍니다.
const thumbQueue = [];
let thumbBusy = false;
async function runThumbs() {
  if (thumbBusy) return;
  thumbBusy = true;
  while (thumbQueue.length) {
    const it = thumbQueue.shift();
    const img = it.el.querySelector("img");
    try {
      const bmp = await createImageBitmap(it.file, { resizeWidth: 240, resizeQuality: "low" });
      const c = document.createElement("canvas");
      c.width = bmp.width; c.height = bmp.height;
      c.getContext("2d").drawImage(bmp, 0, 0);
      if (bmp.close) bmp.close();
      img.src = c.toDataURL("image/jpeg", 0.6);
    } catch (e) {
      const url = URL.createObjectURL(it.file);
      img.onload = () => URL.revokeObjectURL(url);
      img.src = url;
    }
  }
  thumbBusy = false;
}

// ── 가리기: 올리기 전에 사진의 일부를 검게 덮습니다 ─────────────
// 가린 사진은 폰 안에서 새로 만들어지고, 그 사진만 서버로 올라갑니다.
const edCanvas = $("edCanvas");
let ed = null; // { it, src, w, h, rects:[{x,y,w,h}] (0~1 비율), cur }
async function loadPicture(file) {
  try { return await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch (e) {
    return await new Promise((resolve, reject) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("load")); };
      img.src = url;
    });
  }
}
async function openEditor(it) {
  let src;
  try { src = await loadPicture(it.file); } catch (e) { alert("이 사진은 열 수 없어 가리기를 쓸 수 없습니다."); return; }
  const w = src.width || src.naturalWidth, h = src.height || src.naturalHeight;
  const k = Math.min(1, 1600 / Math.max(w, h)); // 화면용은 작게
  edCanvas.width = Math.round(w * k); edCanvas.height = Math.round(h * k);
  ed = { it, src, w, h, rects: [], cur: null };
  $("editor").hidden = false;
  drawEditor();
}
function paintRects(ctx, cw, ch, rects) {
  ctx.fillStyle = "#000";
  rects.forEach((r) => ctx.fillRect(r.x * cw, r.y * ch, r.w * cw, r.h * ch));
}
function drawEditor() {
  const ctx = edCanvas.getContext("2d");
  ctx.drawImage(ed.src, 0, 0, edCanvas.width, edCanvas.height);
  paintRects(ctx, edCanvas.width, edCanvas.height, ed.cur ? ed.rects.concat([ed.cur]) : ed.rects);
  $("edUndo").disabled = ed.rects.length === 0;
  $("edDone").textContent = ed.rects.length ? `완료 (${ed.rects.length}곳 가림)` : "완료";
}
function edPoint(e) {
  const b = edCanvas.getBoundingClientRect();
  return { x: Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), y: Math.min(1, Math.max(0, (e.clientY - b.top) / b.height)) };
}
let edStart = null;
edCanvas.addEventListener("pointerdown", (e) => { if (!ed) return; edCanvas.setPointerCapture(e.pointerId); edStart = edPoint(e); });
edCanvas.addEventListener("pointermove", (e) => {
  if (!ed || !edStart) return;
  const p = edPoint(e);
  ed.cur = { x: Math.min(p.x, edStart.x), y: Math.min(p.y, edStart.y), w: Math.abs(p.x - edStart.x), h: Math.abs(p.y - edStart.y) };
  drawEditor();
});
function edEnd() {
  if (!ed || !edStart) return;
  if (ed.cur && ed.cur.w > 0.01 && ed.cur.h > 0.01) ed.rects.push(ed.cur);
  ed.cur = null; edStart = null;
  drawEditor();
}
edCanvas.addEventListener("pointerup", edEnd);
edCanvas.addEventListener("pointercancel", edEnd);
function closeEditor() { if (ed && ed.src.close) ed.src.close(); ed = null; $("editor").hidden = true; }
$("edUndo").addEventListener("click", () => { ed.rects.pop(); drawEditor(); });
$("edCancel").addEventListener("click", closeEditor);
$("edDone").addEventListener("click", async () => {
  if (!ed.rects.length) { closeEditor(); return; }
  $("edDone").disabled = true;
  try {
    // 원래 크기로 다시 그립니다. 폰이 다룰 수 있는 한도를 넘는 아주 큰 사진만 줄입니다.
    const k = Math.min(1, Math.sqrt(16000000 / (ed.w * ed.h)));
    const c = document.createElement("canvas");
    c.width = Math.round(ed.w * k); c.height = Math.round(ed.h * k);
    const ctx = c.getContext("2d");
    ctx.drawImage(ed.src, 0, 0, c.width, c.height);
    paintRects(ctx, c.width, c.height, ed.rects);
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.92));
    if (!blob || !blob.size) throw new Error("empty");
    const name = (ed.it.file.name || "photo").replace(/\.[^.]+$/, "") + ".jpg";
    const it = ed.it;
    it.file = new File([blob], name, { type: "image/jpeg", lastModified: Date.now() });
    it.masked = true;
    thumbQueue.push(it); runThumbs();
    closeEditor();
    refresh();
  } catch (e) {
    console.error(e);
    alert("가린 사진을 만들지 못했습니다. 다시 시도해 주세요.");
  }
  $("edDone").disabled = false;
});

// ── 화면 갱신 ─────────────────────────────
const LABEL = { ready: "올리기 전", wait: "대기 중", done: "완료", fail: "실패 · 눌러서 재시도" };
function paint(it) {
  const el = it.el;
  el.className = "tile " + it.state;
  el.querySelector(".num").textContent = items.indexOf(it) + 1;
  el.querySelector(".x").hidden = it.state !== "ready";
  el.querySelector(".state").textContent = it.state === "up" ? Math.round(it.pct) + "%" : LABEL[it.state];
  el.querySelector(".fill").style.width = it.state === "up" ? it.pct + "%" : "0";
  let badge = el.querySelector(".mask");
  if (it.masked && !badge) { badge = document.createElement("span"); badge.className = "mask"; badge.textContent = "가림"; el.appendChild(badge); }
  el.title = it.err || "";
}
function refresh() {
  items.forEach(paint);
  const n = (s) => items.filter((i) => i.state === s).length;
  const total = items.length, done = n("done"), fail = n("fail"), ready = n("ready"), busy = n("up") + n("wait");
  $("sumMain").textContent = `${total}장 중 ${done}장 완료`;
  $("sumSub").textContent = [busy ? `올리는 중 ${busy}` : "", fail ? `실패 ${fail}` : "", ready ? `올리기 전 ${ready}` : ""].filter(Boolean).join(" · ");
  const sumPct = items.reduce((a, i) => a + (i.state === "done" ? 100 : i.state === "up" ? i.pct : 0), 0);
  $("barFill").style.width = total ? sumPct / total + "%" : "0";

  $("uploadBtn").disabled = !ready || !configured;
  $("uploadBtn").textContent = ready ? `${ready}장 올리기` : "올리기";
  $("retryBtn").hidden = !fail || busy > 0;
  $("retryBtn").textContent = `실패한 ${fail}장 다시 올리기`;
  $("queuePanel").hidden = total === 0;

  // 모두 끝났을 때: 결과를 알려주고, 실패가 없으면 목록을 비웁니다.
  const finished = total > 0 && busy === 0 && ready === 0;
  if (finished && done > 0 && !announced) {
    announced = true;
    $("doneTitle").textContent = fail
      ? `${done}장 올렸고 ${fail}장은 실패했습니다. 확인을 누른 뒤 빨간 사진을 눌러 다시 올리세요.`
      : `${done}장 모두 올렸습니다.`;
    $("doneIcon").textContent = fail ? "!" : "✓";
    $("doneIcon").className = fail ? "check warn" : "check";
    $("doneBox").hidden = false;
    $("doneOk").focus();
    if (!fail) setTimeout(() => {
      if (items.every((i) => i.state === "done")) { items.length = 0; grid.innerHTML = ""; refresh(); }
    }, 1100);
  }
}

let announced = false; // 알림창은 한 번 올릴 때마다 한 번만
$("doneOk").addEventListener("click", () => { $("doneBox").hidden = true; });

// ── 올리기 ────────────────────────────────
const MAX_PARALLEL = 3, MAX_TRIES = 3;
let running = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const safeName = (n) => (n || "photo.jpg").replace(/[^\w.\-가-힣]/g, "_").slice(-80);

function pump() {
  if (items.some((i) => i.state === "wait")) announced = false;
  while (running < MAX_PARALLEL) {
    const it = items.find((i) => i.state === "wait");
    if (!it) break;
    runOne(it);
  }
}
async function runOne(it) {
  running++;
  it.state = "up"; it.pct = 0; it.err = "";
  paint(it);
  try {
    await uploadWithRetry(it);
    it.state = "done";
    setTimeout(() => it.el.classList.add("gone"), 600);
    setTimeout(() => it.el.remove(), 1000);
  } catch (e) {
    it.state = "fail";
    it.err = explain(e);
  }
  running--;
  refresh();
  pump();
}
async function uploadWithRetry(it) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    try {
      if (!it.file.size) throw new Error("empty-file");
      const path = `u/${code}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${safeName(it.file.name)}`;
      const r = ref(storage, path);
      const task = uploadBytesResumable(r, it.file, {
        contentType: it.file.type || "image/jpeg",
        contentDisposition: "attachment; filename*=UTF-8''" + encodeURIComponent(it.file.name || "photo.jpg"),
        customMetadata: { originalName: it.file.name || "photo.jpg" }
      });
      await new Promise((resolve, reject) => {
        task.on("state_changed", (s) => {
          it.pct = s.totalBytes ? (s.bytesTransferred / s.totalBytes) * 100 : 0;
          paint(it); refreshBar();
        }, reject, resolve);
      });
      // 서버에 저장된 크기가 원본과 같은지 확인 (0바이트 저장 방지)
      const saved = Number(task.snapshot.metadata.size);
      if (saved !== it.file.size) {
        await deleteObject(r).catch(() => {});
        throw new Error("size-mismatch");
      }
      return;
    } catch (e) {
      lastErr = e;
      const c = e.code || e.message;
      if (c === "storage/unauthorized" || c === "empty-file") break; // 다시 해도 같은 결과
      if (attempt < MAX_TRIES) await sleep(1500 * attempt);
    }
  }
  throw lastErr;
}
let barTimer = 0;
function refreshBar() { // 진행 막대만 가볍게 갱신
  if (barTimer) return;
  barTimer = setTimeout(() => {
    barTimer = 0;
    const sumPct = items.reduce((a, i) => a + (i.state === "done" ? 100 : i.state === "up" ? i.pct : 0), 0);
    $("barFill").style.width = items.length ? sumPct / items.length + "%" : "0";
  }, 150);
}
function explain(e) {
  const c = e.code || e.message || "";
  if (c === "empty-file") return "사진 파일이 비어 있습니다.";
  if (c === "size-mismatch") return "올라간 크기가 원본과 달라 취소했습니다.";
  if (c === "storage/unauthorized") return "저장소 규칙이 올리기를 막고 있습니다. (Firebase Storage 규칙 확인)";
  if (c === "storage/retry-limit-exceeded") return "인터넷이 불안정합니다.";
  if (c === "storage/quota-exceeded") return "저장 공간 한도를 넘었습니다.";
  return "올리지 못했습니다. (" + c + ")";
}

$("uploadBtn").addEventListener("click", () => {
  items.forEach((i) => { if (i.state === "ready") i.state = "wait"; });
  refresh(); pump();
});
$("retryBtn").addEventListener("click", () => {
  items.forEach((i) => { if (i.state === "fail") i.state = "wait"; });
  refresh(); pump();
});

// 올리는 중에 화면을 닫으려 하면 경고
window.addEventListener("beforeunload", (e) => {
  if (items.some((i) => i.state === "up" || i.state === "wait")) { e.preventDefault(); e.returnValue = ""; }
});
refresh();
