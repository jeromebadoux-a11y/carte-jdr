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
import { toast } from "./ui-common.js";

// Diagnostic temporaire et visible à l'écran (pas seulement dans la console, inaccessible sur
// tablette) : montre ce que fait réellement le système de détail pendant qu'on zoome/recadre,
// pour identifier une éventuelle panne silencieuse sur un appareil donné. Peut être désactivé
// une fois le bon fonctionnement confirmé sur le terrain (mettre DIAG_TOASTS à false).
const DIAG_TOASTS = true;
const DIAG_BUILD_TAG = "detail-diag-v7";

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

const ENGAGE_ZOOM = 1.3;     // au-delà, la vue d'ensemble serait agrandie de +30% : on charge du détail
const DISENGAGE_ZOOM = 1.05; // en dessous, on relâche le détail (hystérésis pour éviter les allers-retours)
const MARGIN_FACTOR = 0.4;   // marge autour du viewport visible, en fraction de sa taille (pan sans recharger)
const THROTTLE_MS = 250;     // fréquence max de vérification pendant un geste en cours

// Important : ceci est un THROTTLE (exécution périodique garantie), PAS un debounce.
// Un debounce classique (retarder tant que des évènements arrivent, n'exécuter qu'au silence)
// ne fonctionne pas ici : pendant un pincement à deux doigts réellement tenu sur un écran
// tactile, de minuscules micro-tremblements génèrent un flux quasi continu de pointermove —
// un debounce ne verrait donc JAMAIS 200ms de silence tant que les doigts restent posés, et la
// vignette haute résolution ne se chargerait qu'après avoir complètement relâché les doigts
// (et parfois même pas, selon l'enchaînement des évènements). Avec un throttle, la vérification
// s'exécute au moins une fois toutes les THROTTLE_MS, y compris PENDANT le geste — la carte
// s'affine donc progressivement au fur et à mesure qu'on zoome, sans attendre la fin du geste.
let throttleTimer = null;
let lastRunAt = 0;
let evaluating = false; // évite d'empiler plusieurs décodages concurrents (coûteux) si un est déjà en cours
let requestGen = 0;

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

// À appeler quand la carte/l'original change (nouvel import, changement de partie) pour ne
// pas laisser une vignette d'une ancienne carte s'afficher, ni un décodage périmé se terminer
// plus tard et écraser l'état courant.
export function resetDetailState() {
  requestGen++;
  if (throttleTimer) { clearTimeout(throttleTimer); throttleTimer = null; }
  lastRunAt = 0;
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

// Ajoute une marge autour du rectangle strictement visible (pour ne pas devoir recharger au
// moindre petit pan) — MAIS seulement dans la mesure où il reste de la place sous le plafond
// de texture sûr pour l'appareil. Sans ça, à fort zoom, la marge fixe (MARGIN_FACTOR) pouvait
// gonfler la zone demandée au point de dépasser la taille sûre, forçant un downscale qui rendait
// la vignette moins nette que la zone réellement visible ne l'aurait permis — d'où le constat
// "moins net qu'en zoomant pareil sur l'image d'origine directement". On donne donc la priorité
// à la netteté de ce qui est réellement à l'écran, quitte à recharger plus souvent en pannant.
export function computeAdaptivePaddedRect(visible, campaign, safeDim = getMaxSafeTextureSize()) {
  const mapW = campaign.mapWidth, mapH = campaign.mapHeight;
  const origW = campaign.mapOriginalWidth || mapW, origH = campaign.mapOriginalHeight || mapH;
  const desiredFactor = 1 + 2 * MARGIN_FACTOR;
  if (!mapW || !mapH || !origW || !origH) {
    // pas assez d'info pour calculer le budget pixel : on retombe sur la marge fixe habituelle
    return padRect(visible, desiredFactor);
  }
  const scaleX = origW / mapW, scaleY = origH / mapH;
  const coreOw = visible.w * scaleX, coreOh = visible.h * scaleY;
  const largestCore = Math.max(coreOw, coreOh);
  // facteur maximal d'agrandissement encore possible sans dépasser le plafond GPU sûr
  const maxFactor = largestCore > 0 ? safeDim / largestCore : desiredFactor;
  const actualFactor = Math.max(1, Math.min(desiredFactor, maxFactor));
  return padRect(visible, actualFactor);
}

function padRect(visible, factor) {
  const extra = (factor - 1) / 2;
  return {
    x: visible.x - visible.w * extra,
    y: visible.y - visible.h * extra,
    w: visible.w * factor,
    h: visible.h * factor,
  };
}

async function evaluateDetailNeed() {
  const c = App.campaign;
  if (!c || !c.originalImageBlob || !App.mapImage) {
    if (App.detail) { requestGen++; releaseDetailImage(App.detail); App.detail = null; }
    return;
  }

  if (App.view.zoom < DISENGAGE_ZOOM) {
    if (App.detail) {
      // annule aussi tout décodage encore en vol (ex : l'utilisateur a dézoomé pendant qu'une
      // vignette pour un zoom précédent finissait de se charger) pour qu'il ne vienne pas
      // réafficher une vignette périmée une fois résolu.
      requestGen++;
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

  // un décodage est déjà en cours (probable pendant un geste tenu, avec le throttle qui
  // retente toutes les THROTTLE_MS) : on ne relance pas par-dessus, la prochaine passe du
  // throttle réévaluera la situation une fois celui-ci terminé.
  if (evaluating) return;
  evaluating = true;

  const padded = computeAdaptivePaddedRect(visible, c);

  diag(`Détail : chargement (zoom ${App.view.zoom.toFixed(2)})…`);
  const myGen = ++requestGen;
  try {
    const loaded = await loadDetailPatch(padded, c);
    if (!loaded || myGen !== requestGen) {
      // requête périmée (une région/carte a changé entre-temps) ou échec : on jette silencieusement
      if (loaded) releaseDetailImage(loaded);
      return;
    }
    // Chiffres clés pour distinguer un vrai bug (on pourrait faire mieux) d'un plafond matériel
    // incontournable (le "natif idéal" pour la zone visible dépasse déjà ce que le GPU accepte) :
    // "natif idéal" = résolution qu'aurait la zone strictement visible à la résolution d'origine
    // du fichier importé ; "plafond GPU" = limite sûre détectée pour cet appareil.
    const origW = c.mapOriginalWidth || c.mapWidth, origH = c.mapOriginalHeight || c.mapHeight;
    const scaleX = origW / c.mapWidth, scaleY = origH / c.mapHeight;
    const idealW = Math.round(visible.w * scaleX), idealH = Math.round(visible.h * scaleY);
    const safeDim = getMaxSafeTextureSize();
    diag(`Détail : chargé ${loaded.image.width}×${loaded.image.height}px (natif idéal pour l'écran : ${idealW}×${idealH}px, plafond GPU : ${safeDim}px)`);
    releaseDetailImage(App.detail);
    App.detail = loaded;
    requestRender();
  } finally {
    evaluating = false;
  }
}

async function loadDetailPatch(worldRect, campaign) {
  if (typeof createImageBitmap !== "function") {
    diag("Détail : indisponible — ce navigateur ne supporte pas le découpage d'image nécessaire");
    return null;
  }

  const mapW = campaign.mapWidth, mapH = campaign.mapHeight;
  const origW = campaign.mapOriginalWidth || mapW, origH = campaign.mapOriginalHeight || mapH;
  if (!mapW || !mapH || !origW || !origH) {
    diag("Détail : dimensions de carte manquantes, impossible de calculer la zone à découper");
    return null;
  }

  const scaleX = origW / mapW, scaleY = origH / mapH;
  // Si la vue d'ensemble est déjà à la résolution d'origine (pas de perte à l'import), une
  // vignette "détail" n'apporterait rien de plus net : on ne décode pas pour rien.
  if (scaleX <= 1.001 && scaleY <= 1.001) {
    diag("Détail : inutile ici, la vue d'ensemble est déjà à la résolution d'origine");
    return null;
  }

  let ox = worldRect.x * scaleX, oy = worldRect.y * scaleY;
  let ow = worldRect.w * scaleX, oh = worldRect.h * scaleY;
  // recadre aux bornes réelles de l'image d'origine
  const ex = Math.min(origW, ox + ow), ey = Math.min(origH, oy + oh);
  ox = Math.max(0, ox); oy = Math.max(0, oy);
  ow = Math.max(1, Math.round(ex - ox)); oh = Math.max(1, Math.round(ey - oy));
  ox = Math.round(ox); oy = Math.round(oy);
  if (ow < 1 || oh < 1) {
    diag("Détail : zone calculée vide (0px), abandon");
    return null;
  }

  let bitmap;
  try {
    bitmap = await createImageBitmap(campaign.originalImageBlob, ox, oy, ow, oh);
  } catch (e) {
    console.warn("Découpe haute résolution impossible :", e);
    diag("Détail : échec du découpage — " + (e && e.message ? e.message : String(e)));
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
