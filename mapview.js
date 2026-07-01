// mapview.js — rendu de la carte (image + brouillard) et gestion des gestes
// (pan / zoom / pincement, pinceau de brouillard, outil de recadrage régional).
import { App, worldToScreen, screenToWorld, clampView, markDirty, resetViewToBounds } from "./state.js";
import { brushStroke, onFogChanged, getFogPattern } from "./fog.js";
import { refreshSymbolVisibility, placeSymbolAt, renderSymbols } from "./symbols.js";
import { refreshLabelVisibility, placeLabelAt, renderLabels } from "./labels.js";
import { updateScaleBar } from "./scalebar.js";
import { scheduleDetailUpdate } from "./detail.js";

// dès qu'une vignette haute résolution finit de se charger en arrière-plan, on redessine
// pour l'afficher (sans quoi il faudrait attendre un prochain pan/zoom pour la voir apparaître).
document.addEventListener("app:detail-ready", () => { render(); });

let canvas, ctx, viewport, cropOverlay;
let fogScratch, fogScratchCtx; // buffer intermédiaire pour recolorer le masque de brouillard avec la texture nuageuse
const pointers = new Map(); // pointerId -> {x,y}
let pinch = null;           // {startDist, startZoom, startCx, startCy, midWorld}
let brushing = null;        // {last: worldPoint}
let cropDrag = null;        // {mode:'move'|'nw'|'ne'|'sw'|'se', startRect, startWorld}

export function initMapView() {
  canvas = App.els.mapCanvas;
  ctx = canvas.getContext("2d");
  viewport = App.els.viewport;
  cropOverlay = App.els.cropOverlay;

  const ro = new ResizeObserver(() => { resizeCanvas(); clampView(); renderAll(); });
  ro.observe(viewport);
  resizeCanvas();

  viewport.addEventListener("pointerdown", onPointerDown);
  viewport.addEventListener("pointermove", onPointerMove);
  viewport.addEventListener("pointerup", onPointerUp);
  viewport.addEventListener("pointercancel", onPointerUp);
  viewport.addEventListener("pointerleave", onPointerUp);
  viewport.addEventListener("wheel", onWheel, { passive: false });
}

function resizeCanvas() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = viewport.clientWidth, h = viewport.clientHeight;
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";

  if (!fogScratch) {
    fogScratch = document.createElement("canvas");
    fogScratchCtx = fogScratch.getContext("2d");
  }
  fogScratch.width = Math.max(1, w);
  fogScratch.height = Math.max(1, h);
}

export function render() {
  if (!ctx) return;
  const dpr = canvas.width / Math.max(1, viewport.clientWidth);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = viewport.clientWidth, h = viewport.clientHeight;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#05070a";
  ctx.fillRect(0, 0, w, h);

  if (!App.mapImage || !App.campaign) return;

  const topLeft = screenToWorld(0, 0);
  const bottomRight = screenToWorld(w, h);
  const sx = topLeft.x, sy = topLeft.y;
  const sw = bottomRight.x - topLeft.x, sh = bottomRight.y - topLeft.y;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  drawMapLayer(ctx, sx, sy, sw, sh, 0, 0, w, h);
  scheduleDetailUpdate();

  if (App.fogCanvas && fogScratch) {
    const fs = App.campaign.fogScale;
    const fw = fogScratch.width, fh = fogScratch.height;

    // 1) reconstitue la forme du brouillard (masque alpha) telle que vue dans le viewport
    fogScratchCtx.setTransform(1, 0, 0, 1, 0, 0);
    fogScratchCtx.clearRect(0, 0, fw, fh);
    fogScratchCtx.globalCompositeOperation = "source-over";
    safeDrawImage(fogScratchCtx, App.fogCanvas, sx * fs, sy * fs, sw * fs, sh * fs, 0, 0, fw, fh);

    // 2) recolore uniquement cette forme avec une texture "nuageuse", ancrée aux coordonnées
    //    de la carte (donc fixe par rapport à la carte quand on déplace/zoome la vue).
    //    On transforme le CONTEXTE (translate+scale, une API canvas basique et fiable
    //    partout) plutôt que le pattern lui-même (CanvasPattern.setTransform s'est avéré
    //    peu fiable sur certains navigateurs/tablettes, provoquant un motif étiré pendant
    //    le zoom au lieu de rester ancré à la carte).
    fogScratchCtx.save();
    fogScratchCtx.globalCompositeOperation = "source-in";
    fogScratchCtx.fillStyle = getFogPattern();
    const origin = worldToScreen(0, 0);
    fogScratchCtx.setTransform(App.view.zoom, 0, 0, App.view.zoom, origin.x, origin.y);
    fogScratchCtx.fillRect(sx, sy, sw, sh);
    fogScratchCtx.restore();

    // En Mode MJ, le brouillard est semi-transparent : le MJ voit toujours la carte
    // en dessous pour s'orienter. En Mode Jeu, il est totalement opaque pour les joueurs.
    ctx.save();
    ctx.globalAlpha = App.mode === "gm" ? 0.45 : 1;
    ctx.drawImage(fogScratch, 0, 0, fw, fh, 0, 0, w, h);
    ctx.restore();
  }

  updateCropOverlay();
}

// rendu complet : carte+brouillard, pins de symboles/labels repositionnés, barre d'échelle.
export function renderAll() {
  render();
  renderSymbols();
  renderLabels();
  updateScaleBar();
}

// Choisit la meilleure source pour dessiner la zone (sx,sy,sw,sh) [coordonnées "monde"] :
// la vignette haute résolution (App.detail) si elle couvre entièrement cette zone, sinon la
// vue d'ensemble. Voir detail.js pour le mécanisme de chargement de la vignette.
function drawMapLayer(ctx2d, sx, sy, sw, sh, dx, dy, dw, dh) {
  const d = App.detail;
  if (d && d.image && d.rect.w > 0 && d.rect.h > 0 && rectContainsWorld(d.rect, sx, sy, sw, sh)) {
    const r = d.rect, img = d.image;
    const scaleX = img.width / r.w, scaleY = img.height / r.h;
    const lsx = (sx - r.x) * scaleX, lsy = (sy - r.y) * scaleY;
    const lsw = sw * scaleX, lsh = sh * scaleY;
    safeDrawImage(ctx2d, img, lsx, lsy, lsw, lsh, dx, dy, dw, dh);
    return;
  }
  safeDrawImage(ctx2d, App.mapImage, sx, sy, sw, sh, dx, dy, dw, dh);
}

function rectContainsWorld(outer, x, y, w, h) {
  const eps = 0.5;
  return x >= outer.x - eps && y >= outer.y - eps &&
    (x + w) <= outer.x + outer.w + eps && (y + h) <= outer.y + outer.h + eps;
}

// drawImage protégé contre des rectangles source hors bornes (bords de carte)
function safeDrawImage(ctx2d, img, sx, sy, sw, sh, dx, dy, dw, dh) {
  const imgW = img.width, imgH = img.height;
  let clipSx = Math.max(0, sx), clipSy = Math.max(0, sy);
  let clipEx = Math.min(imgW, sx + sw), clipEy = Math.min(imgH, sy + sh);
  if (clipEx <= clipSx || clipEy <= clipSy) return;
  const ratioX = dw / sw, ratioY = dh / sh;
  const ddx = dx + (clipSx - sx) * ratioX;
  const ddy = dy + (clipSy - sy) * ratioY;
  const ddw = (clipEx - clipSx) * ratioX;
  const ddh = (clipEy - clipSy) * ratioY;
  try {
    ctx2d.drawImage(img, clipSx, clipSy, clipEx - clipSx, clipEy - clipSy, ddx, ddy, ddw, ddh);
  } catch (e) { /* image pas prête */ }
}

// ============ zoom molette (desktop, pratique aussi sur tablette avec souris) ============
function onWheel(ev) {
  ev.preventDefault();
  const rect = viewport.getBoundingClientRect();
  const sx = ev.clientX - rect.left, sy = ev.clientY - rect.top;
  const worldBefore = screenToWorld(sx, sy);
  const factor = ev.deltaY < 0 ? 1.1 : 0.9;
  App.view.zoom *= factor;
  clampView();
  const worldAfter = screenToWorld(sx, sy);
  App.view.cx += worldBefore.x - worldAfter.x;
  App.view.cy += worldBefore.y - worldAfter.y;
  clampView();
  renderAll();
}

export function zoomBy(factor) {
  const rect = viewport.getBoundingClientRect();
  const cx = rect.width / 2, cy = rect.height / 2;
  const worldBefore = screenToWorld(cx, cy);
  App.view.zoom *= factor;
  clampView();
  const worldAfter = screenToWorld(cx, cy);
  App.view.cx += worldBefore.x - worldAfter.x;
  App.view.cy += worldBefore.y - worldAfter.y;
  clampView();
  renderAll();
}

export function zoomFit() {
  resetViewToBounds();
  renderAll();
}

// ============ gestion pointeurs (souris + tactile multi-doigts) ============
// Deux doigts posés pour zoomer ne touchent jamais l'écran à la microseconde près : le
// premier déclenchait aussitôt l'outil actif (pinceau de brouillard, pose de symbole/label…)
// avant que le second doigt n'arrive et transforme le geste en pincement. On retarde donc
// légèrement le démarrage d'une action à un seul doigt, le temps de voir si un second doigt
// rejoint le geste — sauf si le premier doigt bouge déjà nettement, auquel cas on démarre
// tout de suite (pour qu'un vrai geste à un doigt — pan, pinceau, glisser — reste réactif).
const MULTITOUCH_GRACE_MS = 140;
const PENDING_MOVE_THRESHOLD = 10;
let pendingGesture = null; // { pointerId, sx, sy, timer }

function onPointerDown(ev) {
  if (ev.target !== canvas && ev.target !== viewport) return; // laisse les pins/labels gérer leur propre drag
  try { viewport.setPointerCapture?.(ev.pointerId); } catch (e) { /* pointeur non "actif" pour le navigateur : sans conséquence, on continue */ }
  pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

  if (pointers.size === 1) {
    const rect = viewport.getBoundingClientRect();
    const sx = ev.clientX - rect.left, sy = ev.clientY - rect.top;
    pendingGesture = {
      pointerId: ev.pointerId, sx, sy,
      timer: setTimeout(() => { pendingGesture = null; beginSingleGesture(sx, sy); }, MULTITOUCH_GRACE_MS),
    };
  } else if (pointers.size === 2) {
    if (pendingGesture) { clearTimeout(pendingGesture.timer); pendingGesture = null; }
    endSingleGesture();
    beginPinch();
  }
}

function onPointerMove(ev) {
  if (!pointers.has(ev.pointerId)) return;
  pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

  if (pointers.size >= 2) {
    if (pendingGesture) { clearTimeout(pendingGesture.timer); pendingGesture = null; }
    updatePinch();
    return;
  }

  const rect = viewport.getBoundingClientRect();
  const sx = ev.clientX - rect.left, sy = ev.clientY - rect.top;

  if (pendingGesture && pendingGesture.pointerId === ev.pointerId) {
    const dist = Math.hypot(sx - pendingGesture.sx, sy - pendingGesture.sy);
    if (dist > PENDING_MOVE_THRESHOLD) {
      clearTimeout(pendingGesture.timer);
      const { sx: startSx, sy: startSy } = pendingGesture;
      pendingGesture = null;
      beginSingleGesture(startSx, startSy);
      moveSingleGesture(sx, sy);
    }
    return; // geste encore en attente : pas de mouvement appliqué tant qu'il n'a pas démarré
  }

  moveSingleGesture(sx, sy);
}

function onPointerUp(ev) {
  if (pendingGesture && pendingGesture.pointerId === ev.pointerId) {
    // le doigt est levé avant la fin du délai, sans qu'un second doigt ne rejoigne le
    // geste : on le traite comme un petit geste rapide (tap), démarré puis aussitôt terminé.
    clearTimeout(pendingGesture.timer);
    const { sx, sy } = pendingGesture;
    pendingGesture = null;
    beginSingleGesture(sx, sy);
  }
  pointers.delete(ev.pointerId);
  if (pointers.size < 2) pinch = null;
  if (pointers.size === 0) endSingleGesture();
}

// ============ pincement (pan + zoom à 2 doigts) ============
function beginPinch() {
  const pts = [...pointers.values()];
  const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  const midScreen = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
  const rect = viewport.getBoundingClientRect();
  const midWorld = screenToWorld(midScreen.x - rect.left, midScreen.y - rect.top);
  pinch = { startDist: Math.max(1, dist), startZoom: App.view.zoom, midWorld };
}

function updatePinch() {
  if (!pinch) return;
  const pts = [...pointers.values()];
  const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  const midScreen = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
  const rect = viewport.getBoundingClientRect();

  App.view.zoom = pinch.startZoom * (dist / pinch.startDist);
  clampView();
  const midWorldNow = screenToWorld(midScreen.x - rect.left, midScreen.y - rect.top);
  App.view.cx += pinch.midWorld.x - midWorldNow.x;
  App.view.cy += pinch.midWorld.y - midWorldNow.y;
  clampView();
  renderAll();
}

// ============ geste 1 doigt : dépend de l'outil actif ============
function currentSinglePointerTool() {
  if (App.cropMode) return "crop";
  if (App.mode === "play") return App.fogLiftActive ? "fog-reveal" : "pan";
  // mode GM
  if (App.gmTab === "brouillard") return App.fogToolMode === "hide" ? "fog-hide" : "fog-reveal";
  if (App.gmTab === "symboles" && App.armedSymbolType) return "place-symbol";
  if (App.gmTab === "labels" && App.armedLabel) return "place-label";
  return "pan";
}

let panStart = null;

function beginSingleGesture(sx, sy) {
  const tool = currentSinglePointerTool();
  const world = screenToWorld(sx, sy);

  if (tool === "crop") { beginCropGesture(sx, sy); return; }
  if (tool === "fog-reveal" || tool === "fog-hide") {
    brushing = { last: world, reveal: tool === "fog-reveal" };
    doBrush(world);
    return;
  }
  if (tool === "place-symbol") {
    placeSymbolAt(world.x, world.y, App.armedSymbolType);
    App.armedSymbolType = null;
    document.dispatchEvent(new CustomEvent("app:armed-changed"));
    render();
    return;
  }
  if (tool === "place-label") {
    placeLabelAt(world.x, world.y);
    App.armedLabel = false;
    document.dispatchEvent(new CustomEvent("app:armed-changed"));
    render();
    return;
  }
  // pan : essaie d'abord de sélectionner un symbole/label si mode GM (tap simple = sélection),
  // sinon démarre un pan
  if (App.mode === "gm" && (App.gmTab === "symboles" || App.gmTab === "labels")) {
    // laisse la sélection se faire via le clic direct sur le pin (géré par symbols.js/labels.js)
  }
  panStart = { sx, sy, cx: App.view.cx, cy: App.view.cy };
}

function moveSingleGesture(sx, sy) {
  const tool = currentSinglePointerTool();
  if (tool === "crop") { moveCropGesture(sx, sy); return; }
  if (tool === "fog-reveal" || tool === "fog-hide") {
    if (!brushing) return;
    const world = screenToWorld(sx, sy);
    doBrush(world);
    return;
  }
  if (!panStart) return;
  const dx = (sx - panStart.sx) / App.view.zoom;
  const dy = (sy - panStart.sy) / App.view.zoom;
  App.view.cx = panStart.cx - dx;
  App.view.cy = panStart.cy - dy;
  clampView();
  renderAll();
}

function endSingleGesture() {
  if (brushing) {
    brushing = null;
    onFogChanged();
    refreshSymbolVisibility();
    refreshLabelVisibility();
    render();
  }
  if (cropDrag) { cropDrag = null; }
  panStart = null;
}

function doBrush(world) {
  const size = App.fogBrushSize || 80;
  const shape = App.fogBrushShape || "round";
  brushStroke(brushing.last, world, size / 2, shape, brushing.reveal);
  brushing.last = world;
  render();
}

// ============ outil de recadrage régional ============
export function startCropMode() {
  App.cropMode = true;
  const b = App.bounds;
  const w = b.w * 0.6, h = b.h * 0.6;
  App.cropRect = { x: b.x + (b.w - w) / 2, y: b.y + (b.h - h) / 2, w, h };
  cropOverlay.classList.remove("hidden");
  render();
}

export function cancelCropMode() {
  App.cropMode = false;
  App.cropRect = null;
  cropOverlay.classList.add("hidden");
  render();
}

export function getCropRect() {
  return App.cropRect;
}

function beginCropGesture(sx, sy) {
  const world = screenToWorld(sx, sy);
  const r = App.cropRect;
  const handles = cropHandleScreenPositions(r);
  const HIT = 26;
  for (const key of ["nw", "ne", "sw", "se"]) {
    const h = handles[key];
    if (Math.hypot(h.x - sx, h.y - sy) < HIT) {
      cropDrag = { mode: key, startRect: { ...r } };
      return;
    }
  }
  if (world.x >= r.x && world.x <= r.x + r.w && world.y >= r.y && world.y <= r.y + r.h) {
    cropDrag = { mode: "move", startRect: { ...r }, startWorld: world };
  } else {
    cropDrag = null;
  }
}

function moveCropGesture(sx, sy) {
  if (!cropDrag) return;
  const world = screenToWorld(sx, sy);
  const r = App.cropRect;
  const b = App.bounds;
  const sr = cropDrag.startRect;

  if (cropDrag.mode === "move") {
    const dx = world.x - cropDrag.startWorld.x;
    const dy = world.y - cropDrag.startWorld.y;
    r.x = Math.min(b.x + b.w - sr.w, Math.max(b.x, sr.x + dx));
    r.y = Math.min(b.y + b.h - sr.h, Math.max(b.y, sr.y + dy));
    r.w = sr.w; r.h = sr.h;
  } else {
    let { x, y, w, h } = sr;
    const minSize = 20;
    if (cropDrag.mode.includes("w")) { const nx = Math.min(x + w - minSize, world.x); w = x + w - nx; x = nx; }
    if (cropDrag.mode.includes("e")) { w = Math.max(minSize, world.x - x); }
    if (cropDrag.mode.includes("n")) { const ny = Math.min(y + h - minSize, world.y); h = y + h - ny; y = ny; }
    if (cropDrag.mode.includes("s")) { h = Math.max(minSize, world.y - y); }
    r.x = Math.max(b.x, x); r.y = Math.max(b.y, y);
    r.w = Math.min(w, b.x + b.w - r.x);
    r.h = Math.min(h, b.y + b.h - r.y);
  }
  render();
}

function cropHandleScreenPositions(r) {
  return {
    nw: worldToScreen(r.x, r.y),
    ne: worldToScreen(r.x + r.w, r.y),
    sw: worldToScreen(r.x, r.y + r.h),
    se: worldToScreen(r.x + r.w, r.y + r.h),
  };
}

function updateCropOverlay() {
  if (!App.cropMode || !App.cropRect) return;
  cropOverlay.innerHTML = "";
  const r = App.cropRect;
  const tl = worldToScreen(r.x, r.y);
  const br = worldToScreen(r.x + r.w, r.y + r.h);
  const div = document.createElement("div");
  div.className = "crop-rect";
  div.style.left = tl.x + "px";
  div.style.top = tl.y + "px";
  div.style.width = (br.x - tl.x) + "px";
  div.style.height = (br.y - tl.y) + "px";
  cropOverlay.appendChild(div);

  const handles = cropHandleScreenPositions(r);
  for (const key of ["nw", "ne", "sw", "se"]) {
    const h = document.createElement("div");
    h.className = "crop-handle";
    h.style.left = handles[key].x + "px";
    h.style.top = handles[key].y + "px";
    cropOverlay.appendChild(h);
  }
}
