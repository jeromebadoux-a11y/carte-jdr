// detail.js — "zoom haute résolution à la demande" (façon tuiles de carte / deep-zoom).
//
// Problème résolu : sur une tablette, la carte globale est stockée à une résolution "vue
// d'ensemble" plafonnée (getMaxSafeTextureSize) pour ne jamais dépasser ce que le GPU de
// l'appareil peut afficher d'un bloc sans corruption visuelle. Mais quand le MJ recadre une
// région ou zoome fort sur une petite zone, cette vue d'ensemble devient floue alors que
// l'appareil pourrait très bien afficher cette PETITE zone à sa pleine résolution d'origine.
//
// Solution : on conserve le fichier original importé tel quel (campaign.originalImageBlob).
// Quand le zoom dépasse un seuil, on découpe uniquement la portion actuellement visible
// (avec une marge) directement dans ce fichier original via createImageBitmap(blob, x,y,w,h)
// — cette API ne décode QUE le rectangle demandé, jamais l'image entière — puis on l'affiche
// par-dessus la vue d'ensemble. Cette vignette reste elle aussi plafonnée à une taille sûre
// pour le GPU, mais comme elle ne couvre qu'une petite zone du monde, sa résolution effective
// (pixels par unité de carte) est bien plus fine que celle de la vue d'ensemble.
import { App } from "./state.js";
import { getMaxSafeTextureSize } from "./mapload.js";

const ENGAGE_ZOOM = 1.3;     // au-delà, la vue d'ensemble serait agrandie de +30% : on charge du détail
const DISENGAGE_ZOOM = 1.05; // en dessous, on relâche le détail (hystérésis pour éviter les allers-retours)
const MARGIN_FACTOR = 0.4;   // marge autour du viewport visible, en fraction de sa taille (pan sans recharger)
const DEBOUNCE_MS = 200;     // attend que le geste (pincement/pan) se stabilise avant de décoder

let debounceTimer = null;
let requestGen = 0;

export function scheduleDetailUpdate() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(evaluateDetailNeed, DEBOUNCE_MS);
}

// À appeler quand la carte/l'original change (nouvel import, changement de partie) pour ne
// pas laisser une vignette d'une ancienne carte s'afficher, ni un décodage périmé se terminer
// plus tard et écraser l'état courant.
export function resetDetailState() {
  requestGen++;
  if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
  releaseDetailImage(App.detail);
  App.detail = null;
}

function releaseDetailImage(detail) {
  if (detail && detail.image && typeof detail.image.close === "function") {
    try { detail.image.close(); } catch (e) { /* déjà fermé / pas grave */ }
  }
}

function getVisibleWorldRect() {
  const vp = App.els.viewport;
  const w = vp.clientWidth, h = vp.clientHeight;
  const halfW = (w / App.view.zoom) / 2, halfH = (h / App.view.zoom) / 2;
  return {
    x: App.view.cx - halfW, y: App.view.cy - halfH,
    w: halfW * 2, h: halfH * 2,
  };
}

function rectContains(outer, x, y, w, h) {
  const eps = 0.5;
  return x >= outer.x - eps && y >= outer.y - eps &&
    (x + w) <= outer.x + outer.w + eps && (y + h) <= outer.y + outer.h + eps;
}

async function evaluateDetailNeed() {
  const c = App.campaign;
  if (!c || !c.originalImageBlob || !App.mapImage) {
    if (App.detail) { releaseDetailImage(App.detail); App.detail = null; }
    return;
  }

  if (App.view.zoom < DISENGAGE_ZOOM) {
    if (App.detail) {
      releaseDetailImage(App.detail);
      App.detail = null;
      requestRender();
    }
    return;
  }
  if (App.view.zoom < ENGAGE_ZOOM) return; // zone intermédiaire : on ne touche pas à l'état actuel

  const visible = getVisibleWorldRect();
  if (App.detail && rectContains(App.detail.rect, visible.x, visible.y, visible.w, visible.h)) {
    return; // la vignette actuelle couvre déjà largement ce qui est affiché
  }

  const padded = {
    x: visible.x - visible.w * MARGIN_FACTOR,
    y: visible.y - visible.h * MARGIN_FACTOR,
    w: visible.w * (1 + 2 * MARGIN_FACTOR),
    h: visible.h * (1 + 2 * MARGIN_FACTOR),
  };

  const myGen = ++requestGen;
  const loaded = await loadDetailPatch(padded, c);
  if (!loaded || myGen !== requestGen) {
    // requête périmée (une région/carte a changé entre-temps) ou échec : on jette silencieusement
    if (loaded) releaseDetailImage(loaded);
    return;
  }
  releaseDetailImage(App.detail);
  App.detail = loaded;
  requestRender();
}

async function loadDetailPatch(worldRect, campaign) {
  const mapW = campaign.mapWidth, mapH = campaign.mapHeight;
  const origW = campaign.mapOriginalWidth || mapW, origH = campaign.mapOriginalHeight || mapH;
  if (!mapW || !mapH || !origW || !origH) return null;

  const scaleX = origW / mapW, scaleY = origH / mapH;
  // Si la vue d'ensemble est déjà à la résolution d'origine (pas de perte à l'import), une
  // vignette "détail" n'apporterait rien de plus net : on ne décode pas pour rien.
  if (scaleX <= 1.001 && scaleY <= 1.001) return null;

  let ox = worldRect.x * scaleX, oy = worldRect.y * scaleY;
  let ow = worldRect.w * scaleX, oh = worldRect.h * scaleY;
  // recadre aux bornes réelles de l'image d'origine
  const ex = Math.min(origW, ox + ow), ey = Math.min(origH, oy + oh);
  ox = Math.max(0, ox); oy = Math.max(0, oy);
  ow = Math.max(1, Math.round(ex - ox)); oh = Math.max(1, Math.round(ey - oy));
  ox = Math.round(ox); oy = Math.round(oy);
  if (ow < 1 || oh < 1) return null;

  let bitmap;
  try {
    bitmap = await createImageBitmap(campaign.originalImageBlob, ox, oy, ow, oh);
  } catch (e) {
    console.warn("Découpe haute résolution impossible :", e);
    return null;
  }

  // la vignette obtenue doit elle aussi rester dans les clous du GPU de l'appareil
  const safeDim = getMaxSafeTextureSize();
  let image = bitmap;
  const largest = Math.max(bitmap.width, bitmap.height);
  if (largest > safeDim) {
    const scale = safeDim / largest;
    const cw = Math.max(1, Math.round(bitmap.width * scale));
    const ch = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = cw; canvas.height = ch;
    const cctx = canvas.getContext("2d");
    cctx.drawImage(bitmap, 0, 0, cw, ch);
    bitmap.close?.();
    image = canvas;
  }

  // rectangle "monde" réellement couvert (après recadrage aux bornes de l'image d'origine)
  const rect = { x: ox / scaleX, y: oy / scaleY, w: ow / scaleX, h: oh / scaleY };
  return { image, rect };
}

// évite une dépendance circulaire avec mapview.js : on déclenche juste un ré-affichage léger
// (la vignette est déjà posée dans App.detail, mapview.js lira son état au prochain render()).
function requestRender() {
  document.dispatchEvent(new CustomEvent("app:detail-ready"));
}
