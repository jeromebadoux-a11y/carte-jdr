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
import { App, screenToWorld } from "./state.js";
import { getMaxSafeTextureSize } from "./mapload.js";
import { toast } from "./ui-common.js";

// Diagnostic temporaire et visible à l'écran (pas seulement dans la console, inaccessible sur
// tablette) : montrait ce que faisait réellement le système de détail pendant qu'on zoome/recadre,
// pour identifier une éventuelle panne silencieuse sur un appareil donné. Le bon fonctionnement a
// été confirmé sur le terrain (tablette réelle) — désactivé pour une app propre en usage normal.
// Remettre à true (et voir DIAG_BUILD_TAG plus bas) pour ré-enquêter un jour si besoin.
const DIAG_TOASTS = false;
const DIAG_BUILD_TAG = "detail-diag-v11";

// Bandeau PERMANENT (ne disparaît jamais tout seul, contrairement à un toast) pour ne plus
// jamais rater un message par manque de timing — il affiche en continu les derniers messages
// de diagnostic, consultable à tout moment en regardant simplement l'écran.
let diagBanner = null;
const diagLines = [];
function ensureDiagBanner() {
  if (diagBanner || !document.body) return diagBanner;
  diagBanner = document.createElement("div");
  diagBanner.id = "diag-banner";
  diagBanner.style.cssText = [
    "position:fixed", "left:6px", "bottom:6px", "z-index:99999",
    "max-width:92vw", "background:rgba(0,0,0,0.82)", "color:#7CFC9A",
    "font:11px/1.4 monospace", "padding:6px 8px", "border-radius:6px",
    "white-space:pre-wrap", "pointer-events:none", "box-shadow:0 2px 8px rgba(0,0,0,0.4)",
  ].join(";");
  document.body.appendChild(diagBanner);
  return diagBanner;
}
export function diag(msg) {
  if (!DIAG_TOASTS) return;
  toast("🔍 " + msg, 3500);
  const b = ensureDiagBanner();
  if (!b) return;
  diagLines.push(msg);
  if (diagLines.length > 6) diagLines.shift();
  b.textContent = "🔍 " + DIAG_BUILD_TAG + "\n" + diagLines.join("\n");
}

// Marqueur INCONDITIONNEL affiché dès que ce fichier est chargé par le navigateur — sans
// attendre le moindre zoom/recadrage, et qui RESTE affiché (pas juste un toast fugace). Sert
// uniquement à vérifier, de façon certaine, que cette version du code tourne bien sur
// l'appareil (et pas une version mise en cache plus ancienne).
if (DIAG_TOASTS) {
  const showBuildMarker = () => diag(`build « ${DIAG_BUILD_TAG} » chargé ✔ (${new Date().toISOString().slice(11, 19)})`);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", showBuildMarker);
  } else {
    showBuildMarker();
  }
}

const ENGAGE_ZOOM = 1.3;      // zoom (monde -> CSS px) au-delà duquel on charge une vignette détail
const DISENGAGE_ZOOM = 1.05;  // en dessous, on relâche la vignette et revient à la vue d'ensemble
const MARGIN_FACTOR = 0.4;    // marge tout autour de la zone visible, pour pouvoir paner un peu sans recharger
const THROTTLE_MS = 250;      // fréquence max de ré-évaluation pendant un geste continu (pincement tenu…)

let throttleTimer = null, lastRunAt = 0, evaluating = false, requestGen = 0;

// À appeler après CHAQUE rendu (pan/zoom/recadrage) : décide s'il faut charger/relâcher une
// vignette détail. Utilise un THROTTLE (pas un debounce) : un debounce ne se déclenche jamais
// tant que les évènements continuent d'arriver, ce qui le rendait invisible pendant un
// pincement tenu avec micro-tremblement (le cas réel le plus courant sur tablette).
export function scheduleDetailUpdate() {
  const now = Date.now();
  const elapsed = now - lastRunAt;
  if (elapsed >= THROTTLE_MS) {
    lastRunAt = now;
    evaluateDetailNeed();
  } else if (!throttleTimer) {
    throttleTimer = setTimeout(() => {
      throttleTimer = null;
      lastRunAt = Date.now();
      evaluateDetailNeed();
    }, THROTTLE_MS - elapsed);
  }
}

// À appeler quand on change de partie / de carte / de région : une vignette d'une autre carte
// ne doit jamais s'afficher par erreur, et un décodage encore en vol doit être ignoré à son retour.
export function resetDetailState() {
  requestGen++;
  if (throttleTimer) { clearTimeout(throttleTimer); throttleTimer = null; }
  App.detail = null;
}

function padRect(visible, factor) {
  const extra = (factor - 1) / 2;
  return { x: visible.x - visible.w * extra, y: visible.y - visible.h * extra, w: visible.w * factor, h: visible.h * factor };
}

// Calcule le rectangle (monde) à décoder en haute résolution : la zone visible + une marge,
// mais en réduisant automatiquement cette marge si le résultat dépasserait la taille de texture
// sûre pour le GPU de l'appareil — mieux vaut une marge plus courte (rechargements plus fréquents
// en pannant) qu'un rendu forcé à rétrécir toute la vignette (donc moins net) inutilement.
export function computeAdaptivePaddedRect(visible, campaign, safeDim = getMaxSafeTextureSize()) {
  const mapW = campaign.mapWidth, mapH = campaign.mapHeight;
  const origW = campaign.mapOriginalWidth || mapW, origH = campaign.mapOriginalHeight || mapH;
  const desiredFactor = 1 + 2 * MARGIN_FACTOR;
  if (!mapW || !mapH || !origW || !origH) return padRect(visible, desiredFactor);
  const scaleX = origW / mapW, scaleY = origH / mapH;
  const coreOw = visible.w * scaleX, coreOh = visible.h * scaleY;
  const largestCore = Math.max(coreOw, coreOh);
  const maxFactor = largestCore > 0 ? safeDim / largestCore : desiredFactor;
  const actualFactor = Math.max(1, Math.min(desiredFactor, maxFactor));
  return padRect(visible, actualFactor);
}

function getVisibleWorldRect() {
  const vp = App.els.viewport;
  if (!vp) return null;
  const w = vp.clientWidth, h = vp.clientHeight;
  if (!w || !h) return null;
  const topLeft = screenToWorld(0, 0);
  const bottomRight = screenToWorld(w, h);
  return { x: topLeft.x, y: topLeft.y, w: bottomRight.x - topLeft.x, h: bottomRight.y - topLeft.y };
}

function rectContains(outer, x, y, w, h) {
  const eps = 0.5;
  return x >= outer.x - eps && y >= outer.y - eps &&
    (x + w) <= outer.x + outer.w + eps && (y + h) <= outer.y + outer.h + eps;
}

async function evaluateDetailNeed() {
  const c = App.campaign;
  if (!c || !c.originalImageBlob || !c.mapWidth || !c.mapHeight) return;
  const visible = getVisibleWorldRect();
  if (!visible) return;

  const zoom = App.view.zoom;
  const hasDetail = !!App.detail;

  // désengagement : si on dézoome sous le seuil bas, on revient à la vue d'ensemble
  if (zoom < DISENGAGE_ZOOM) {
    if (hasDetail) {
      requestGen++; // invalide tout décodage en vol correspondant à l'ancien niveau de zoom
      App.detail = null;
      document.dispatchEvent(new CustomEvent("app:detail-ready"));
    }
    return;
  }
  if (zoom < ENGAGE_ZOOM) return; // zone "morte" entre les deux seuils : ne change rien (évite un battement)

  // si la vignette déjà chargée couvre encore entièrement la zone visible, rien à refaire
  if (hasDetail && rectContains(App.detail.rect, visible.x, visible.y, visible.w, visible.h)) return;

  if (evaluating) return; // un décodage est déjà en cours ; le prochain throttle réessaiera
  evaluating = true;
  const myGen = requestGen;
  try {
    const paddedRect = computeAdaptivePaddedRect(visible, c);
    const loaded = await loadDetailPatch(paddedRect, c);
    if (!loaded || myGen !== requestGen) return; // périmé : dézoomé/changé de carte entre-temps
    App.detail = loaded;
    document.dispatchEvent(new CustomEvent("app:detail-ready"));

    if (DIAG_TOASTS) {
      const origW = c.mapOriginalWidth || c.mapWidth, origH = c.mapOriginalHeight || c.mapHeight;
      const scaleX = origW / c.mapWidth, scaleY = origH / c.mapHeight;
      const idealW = Math.round(visible.w * scaleX), idealH = Math.round(visible.h * scaleY);
      const safeDim = getMaxSafeTextureSize();
      const realDpr = window.devicePixelRatio || 1;
      const vp = App.els.viewport;
      const screenNeedW = Math.round((vp?.clientWidth || 0) * realDpr);
      const screenNeedH = Math.round((vp?.clientHeight || 0) * realDpr);
      diag(`Détail : chargé ${loaded.image.width}×${loaded.image.height}px | natif idéal ${idealW}×${idealH}px | besoin écran ${screenNeedW}×${screenNeedH}px | plafond GPU ${safeDim}px`);
    }
  } catch (e) {
    console.error("Échec chargement détail :", e);
  } finally {
    evaluating = false;
  }
}

// Découpe UNIQUEMENT le rectangle demandé dans le fichier original (jamais l'image entière),
// borné aux limites réelles de la carte, avec un garde-fou de sécurité GPU en sortie.
async function loadDetailPatch(worldRect, campaign) {
  const origW = campaign.mapOriginalWidth || campaign.mapWidth;
  const origH = campaign.mapOriginalHeight || campaign.mapHeight;
  const scaleX = origW / campaign.mapWidth, scaleY = origH / campaign.mapHeight;

  const clampedX = Math.max(0, worldRect.x), clampedY = Math.max(0, worldRect.y);
  const clampedX2 = Math.min(campaign.mapWidth, worldRect.x + worldRect.w);
  const clampedY2 = Math.min(campaign.mapHeight, worldRect.y + worldRect.h);
  const rect = { x: clampedX, y: clampedY, w: Math.max(1, clampedX2 - clampedX), h: Math.max(1, clampedY2 - clampedY) };
  if (rect.w <= 0 || rect.h <= 0) return null;

  const sx = Math.round(rect.x * scaleX), sy = Math.round(rect.y * scaleY);
  const sw = Math.max(1, Math.round(rect.w * scaleX)), sh = Math.max(1, Math.round(rect.h * scaleY));
  const clampedSw = Math.min(sw, origW - sx), clampedSh = Math.min(sh, origH - sy);
  if (clampedSw <= 0 || clampedSh <= 0) return null;

  let bitmap = await createImageBitmap(campaign.originalImageBlob, sx, sy, clampedSw, clampedSh);

  // garde-fou : si le patch dépasse la taille de texture sûre pour ce GPU (marge large sur un
  // petit écran, par ex.), on le réduit — mieux vaut une vignette un peu moins "native" que de
  // risquer une texture qui échoue/corrompt le rendu sur cet appareil.
  const safeDim = getMaxSafeTextureSize();
  if (bitmap.width > safeDim || bitmap.height > safeDim) {
    const ratio = Math.min(safeDim / bitmap.width, safeDim / bitmap.height);
    const nw = Math.max(1, Math.round(bitmap.width * ratio)), nh = Math.max(1, Math.round(bitmap.height * ratio));
    const c2 = document.createElement("canvas");
    c2.width = nw; c2.height = nh;
    const cctx = c2.getContext("2d");
    cctx.imageSmoothingEnabled = true;
    cctx.imageSmoothingQuality = "high";
    cctx.drawImage(bitmap, 0, 0, nw, nh);
    bitmap.close?.();
    bitmap = await createImageBitmap(c2);
  }

  return { image: bitmap, rect };
}
