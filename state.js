// state.js — état central partagé de l'application.
import { saveCampaign } from "./db.js";

export const MAX_MAP_DIM = 4096;   // taille max (px) à laquelle une image de carte importée est redimensionnée
export const FOG_SCALE_DEFAULT = 0.5; // résolution du masque de brouillard relative à la carte
export const MAX_FOG_DIM = 2048;

export const App = {
  campaign: null,        // objet campagne courant (voir db.js:newCampaign)
  mapImage: null,        // HTMLImageElement (image native complète de la carte globale)
  fogCanvas: null,       // OffscreenCanvas/canvas mémoire contenant le masque de brouillard complet
  fogCtx: null,

  mode: "gm",            // 'gm' | 'play'
  gmTab: "carte",

  view: { zoom: 1, cx: 0, cy: 0 }, // cx/cy = coordonnées "monde" (px carte globale) au centre du viewport
  bounds: { x: 0, y: 0, w: 0, h: 0 }, // zone monde actuellement "active" (région recadrée ou carte entière)

  cropMode: false,
  cropRect: null,        // {x,y,w,h} en coordonnées monde, pendant l'édition du recadrage

  selectedSymbolId: null,
  selectedLabelId: null,
  armedSymbolType: null, // type de symbole "armé" prêt à être posé au prochain tap
  armedLabel: false,     // prochain tap pose un label

  fogLiftActive: false,  // mode Jeu : bouton "lever le brouillard" activé ?

  dirty: false,
  saveTimer: null,

  els: {}, // refs DOM peuplées par main.js
};

export function markDirty() {
  App.dirty = true;
  scheduleAutosave();
}

let saveInFlight = false;
export function scheduleAutosave() {
  if (App.saveTimer) clearTimeout(App.saveTimer);
  App.saveTimer = setTimeout(doAutosave, 900);
  setSaveIndicator("saving");
}

export async function doAutosave() {
  if (!App.campaign) return;
  if (saveInFlight) { App.saveTimer = setTimeout(doAutosave, 400); return; }
  saveInFlight = true;
  try {
    const thumb = makeThumbnail();
    await saveCampaign(App.campaign, thumb);
    App.dirty = false;
    setSaveIndicator("saved");
  } catch (e) {
    console.error("Échec sauvegarde", e);
    setSaveIndicator("error");
  } finally {
    saveInFlight = false;
  }
}

function makeThumbnail() {
  try {
    if (!App.mapImage) return null;
    const c = document.createElement("canvas");
    const maxDim = 220;
    const ratio = Math.min(maxDim / App.mapImage.width, maxDim / App.mapImage.height);
    c.width = Math.max(1, Math.round(App.mapImage.width * ratio));
    c.height = Math.max(1, Math.round(App.mapImage.height * ratio));
    const ctx = c.getContext("2d");
    ctx.drawImage(App.mapImage, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.6);
  } catch (e) {
    return null;
  }
}

function setSaveIndicator(status) {
  const el = App.els.saveIndicator;
  if (!el) return;
  el.classList.remove("saving");
  if (status === "saving") { el.textContent = "💾 sauvegarde…"; el.classList.add("saving"); }
  else if (status === "saved") { el.textContent = "💾 à jour"; }
  else if (status === "error") { el.textContent = "⚠️ erreur sauvegarde"; }
}

// ---- conversions écran <-> monde ----
export function worldToScreen(x, y) {
  const vp = App.els.viewport;
  const w = vp.clientWidth, h = vp.clientHeight;
  return {
    x: (x - App.view.cx) * App.view.zoom + w / 2,
    y: (y - App.view.cy) * App.view.zoom + h / 2,
  };
}

export function screenToWorld(x, y) {
  const vp = App.els.viewport;
  const w = vp.clientWidth, h = vp.clientHeight;
  return {
    x: (x - w / 2) / App.view.zoom + App.view.cx,
    y: (y - h / 2) / App.view.zoom + App.view.cy,
  };
}

export function currentBounds() {
  const c = App.campaign;
  if (!c) return { x: 0, y: 0, w: 1, h: 1 };
  const region = c.regions.find((r) => r.id === c.activeRegionId);
  if (region) return { x: region.cropX, y: region.cropY, w: region.cropW, h: region.cropH };
  return { x: 0, y: 0, w: c.mapWidth, h: c.mapHeight };
}

export function fitZoomFor(bounds) {
  const vp = App.els.viewport;
  const w = vp.clientWidth || 1, h = vp.clientHeight || 1;
  return Math.min(w / bounds.w, h / bounds.h);
}

export function clampView() {
  const b = App.bounds;
  const fitZoom = fitZoomFor(b);
  const minZoom = fitZoom;
  const maxZoom = Math.max(fitZoom * 16, 6);
  App.view.zoom = Math.min(maxZoom, Math.max(minZoom, App.view.zoom));

  const vp = App.els.viewport;
  const halfW = (vp.clientWidth / App.view.zoom) / 2;
  const halfH = (vp.clientHeight / App.view.zoom) / 2;

  // si la zone visible est plus grande que les bounds, centrer
  if (halfW * 2 >= b.w) App.view.cx = b.x + b.w / 2;
  else App.view.cx = Math.min(b.x + b.w - halfW, Math.max(b.x + halfW, App.view.cx));

  if (halfH * 2 >= b.h) App.view.cy = b.y + b.h / 2;
  else App.view.cy = Math.min(b.y + b.h - halfH, Math.max(b.y + halfH, App.view.cy));
}

export function resetViewToBounds() {
  App.bounds = currentBounds();
  const b = App.bounds;
  App.view.zoom = fitZoomFor(b);
  App.view.cx = b.x + b.w / 2;
  App.view.cy = b.y + b.h / 2;
  clampView();
}
