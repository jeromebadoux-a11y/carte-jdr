// main.js — point d'entrée : écran des parties, ouverture/fermeture d'une partie, bascule MJ/Jeu.
import { App, resetViewToBounds, doAutosave } from "./state.js";
import { listCampaignsMeta, getCampaign, saveCampaign, newCampaign, deleteCampaign, uid } from "./db.js";
import { importCampaignFromFile } from "./fileio.js";
import { initMapView, renderAll, zoomBy, zoomFit } from "./mapview.js";
import { initFogForMap, loadFogFromBlob } from "./fog.js";
import { loadMapImageFromBlob } from "./mapload.js";
import { initGmUI, refreshRegionsList, updateMapInfo, renderSymbolPalette } from "./ui-gm.js";
import { initPlayUI, resetPlaySafety } from "./ui-play.js";
import { resetDetailState } from "./detail.js";
import { toast, confirmModal } from "./ui-common.js";

let uiInitialized = false;

function grabEls() {
  App.els = {
    viewport: document.getElementById("map-viewport"),
    mapCanvas: document.getElementById("map-canvas"),
    symbolLayer: document.getElementById("symbol-layer"),
    cropOverlay: document.getElementById("crop-overlay"),
    scaleBar: document.getElementById("scale-bar"),
    saveIndicator: document.getElementById("save-indicator"),
    campaignNameLabel: document.getElementById("campaign-name-label"),
    noMapHint: document.getElementById("no-map-hint"),
    regionsList: document.getElementById("regions-list"),
  };
}

async function init() {
  grabEls();
  registerServiceWorker();
  wireCampaignScreen();
  wireUpdateCheck();
  wireTopbar();
  wireZoomControls();
  await refreshCampaignScreen();
}

// ============ écran liste des parties ============
async function refreshCampaignScreen() {
  const list = document.getElementById("campaigns-list");
  list.innerHTML = "";
  const metas = await listCampaignsMeta();
  if (metas.length === 0) {
    list.innerHTML = `<p class="empty-hint">Aucune partie pour l'instant — crée-en une nouvelle.</p>`;
    return;
  }
  for (const m of metas) {
    const card = document.createElement("div");
    card.className = "campaign-card";
    const date = new Date(m.updatedAt).toLocaleString("fr-FR");
    card.innerHTML = `
      <div class="cc-info">
        <div class="cc-name">${escapeHtml(m.name)}</div>
        <div class="cc-meta">Modifiée le ${date}${m.hasMap ? "" : " · pas encore de carte"}</div>
      </div>
      <div class="cc-actions"><button class="icon-btn" data-act="del" title="Supprimer">🗑️</button></div>`;
    card.addEventListener("click", (ev) => {
      if (ev.target.closest("button")) return;
      openCampaign(m.id);
    });
    card.querySelector('[data-act="del"]').addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const ok = await confirmModal("Supprimer la partie", `Supprimer définitivement « ${m.name} » ?`);
      if (ok) { await deleteCampaign(m.id); refreshCampaignScreen(); }
    });
    list.appendChild(card);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function wireCampaignScreen() {
  document.getElementById("btn-new-campaign").addEventListener("click", async () => {
    const c = newCampaign("Nouvelle partie");
    await saveCampaign(c);
    openCampaign(c.id);
  });
  document.getElementById("btn-import-campaign").addEventListener("click", () => {
    document.getElementById("input-import-campaign").click();
  });
  document.getElementById("input-import-campaign").addEventListener("change", async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    try {
      const data = await importCampaignFromFile(file);
      data.id = uid();
      data.updatedAt = Date.now();
      await saveCampaign(data);
      toast("Partie importée ✔");
      refreshCampaignScreen();
    } catch (e) {
      console.error(e);
      toast("Fichier invalide : " + e.message);
    }
    ev.target.value = "";
  });
}

// ============ ouverture / fermeture d'une partie ============
async function openCampaign(id) {
  const campaign = await getCampaign(id);
  if (!campaign) { toast("Partie introuvable."); return; }
  App.campaign = campaign;
  App.mapImage = null;
  App.fogCanvas = null; App.fogCtx = null;
  App.selectedSymbolId = null; App.selectedLabelId = null;
  App.armedSymbolType = null; App.armedLabel = false;
  resetDetailState(); // une vignette haute résolution d'une autre partie ne doit jamais s'afficher ici

  document.getElementById("screen-campaigns").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");
  App.els.campaignNameLabel.textContent = campaign.name;

  if (!uiInitialized) {
    initMapView();
    initGmUI();
    initPlayUI();
    uiInitialized = true;
  }

  if (campaign.mapImageBlob) {
    await loadMapImageFromBlob(campaign.mapImageBlob);
    if (campaign.fogBlob) {
      await loadFogFromBlob(campaign.fogBlob, campaign.fogWidth, campaign.fogHeight, campaign.fogScale);
    } else {
      initFogForMap(campaign.mapWidth, campaign.mapHeight, true);
    }
    App.els.noMapHint.classList.add("hidden");
  } else {
    App.els.noMapHint.classList.remove("hidden");
  }
  updateMapInfo();

  setMode("gm");
  resetViewToBounds();
  App.syncScalePanel?.();
  refreshRegionsList();
  renderSymbolPalette(); // reconstruit le "top 10" selon l'usage propre à CETTE partie
  renderAll();
}

export function goBackToCampaignList() {
  App.campaign = null;
  document.getElementById("app").classList.add("hidden");
  document.getElementById("screen-campaigns").classList.remove("hidden");
  refreshCampaignScreen();
}

document.getElementById("btn-back-campaigns")?.addEventListener("click", async () => {
  await doAutosave();
  goBackToCampaignList();
});

// ============ barre du haut : bascule Mode MJ / Mode Jeu ============
function wireTopbar() {
  document.getElementById("btn-mode-gm").addEventListener("click", () => setMode("gm"));
  document.getElementById("btn-mode-play").addEventListener("click", () => setMode("play"));
}

function setMode(mode) {
  App.mode = mode;
  const appEl = document.getElementById("app");
  appEl.classList.toggle("mode-gm", mode === "gm");
  appEl.classList.toggle("mode-play", mode === "play");
  document.getElementById("btn-mode-gm").classList.toggle("active", mode === "gm");
  document.getElementById("btn-mode-play").classList.toggle("active", mode === "play");
  if (mode === "play") resetPlaySafety();
  renderAll();
}

// ============ zoom ============
function wireZoomControls() {
  document.getElementById("btn-zoom-in").addEventListener("click", () => zoomBy(1.3));
  document.getElementById("btn-zoom-out").addEventListener("click", () => zoomBy(1 / 1.3));
  document.getElementById("btn-zoom-fit").addEventListener("click", () => zoomFit());
}

// ============ service worker (mise en cache hors ligne) ============
let swRegistration = null;

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").then((reg) => {
      swRegistration = reg;
      // vérifie régulièrement s'il existe une nouvelle version de l'app en cache
      reg.update().catch(() => {});
      setInterval(() => reg.update().catch(() => {}), 60 * 1000);
    }).catch((e) => console.warn("SW non enregistré :", e));

    // dès qu'une nouvelle version prend le contrôle, recharge une seule fois
    // pour que la mise à jour s'applique immédiatement (sans quoi elle resterait
    // en cache jusqu'à une fermeture complète manuelle de l'app).
    let alreadyReloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (alreadyReloaded) return;
      alreadyReloaded = true;
      window.location.reload();
    });
  });
}

// ============ vérification manuelle des mises à jour ============
// Bouton pensé pour lever tout doute sur "ai-je bien la dernière version installée ?" sans
// devoir passer par un nettoyage complet des données du site : force une vérification active
// auprès du serveur (au lieu d'attendre le contrôle périodique automatique toutes les 60s),
// puis recharge la page. Grâce à la stratégie réseau "no-store" du service worker, ce
// rechargement va bien rechercher chaque fichier sur le serveur plutôt que de se contenter
// d'une copie mise en cache par le navigateur lui-même.
function wireUpdateCheck() {
  const btn = document.getElementById("btn-check-updates");
  const statusEl = document.getElementById("update-status");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    if (!("serviceWorker" in navigator)) {
      setStatus("Ce navigateur ne supporte pas la mise à jour automatique de l'app.");
      return;
    }
    if (navigator.onLine === false) {
      setStatus("Pas de connexion détectée — branche-toi au réseau puis réessaie.");
      return;
    }
    btn.disabled = true;
    setStatus("Vérification en cours…");
    try {
      let reg = swRegistration || await navigator.serviceWorker.getRegistration();
      if (!reg) {
        setStatus("Aucune installation détectée — rechargement…");
        window.location.reload();
        return;
      }
      await reg.update();
      // Récupère directement sur le serveur (en contournant tout cache) le nom de la version
      // actuellement publiée, pour que le message affiché à l'utilisateur soit vérifiable
      // (ex. "rpgmap-cache-v17") plutôt qu'un simple "mise à jour vérifiée" vague — utile pour
      // confirmer sans ambiguïté que la tablette a bien récupéré la toute dernière version.
      let versionLabel = "";
      try {
        const res = await fetch("service-worker.js", { cache: "no-store" });
        const text = await res.text();
        const m = text.match(/CACHE_NAME\s*=\s*"([^"]+)"/);
        if (m) versionLabel = m[1];
      } catch (_) { /* pas grave si ça échoue, on affiche juste un message générique */ }
      // laisse une courte fenêtre pour qu'une éventuelle nouvelle version s'installe/active
      // (ce qui déclenchera "controllerchange" et un rechargement automatique de son côté) ;
      // dans tous les cas, on force ensuite un rechargement — avec la politique "no-store" du
      // service worker, ce rechargement seul suffit déjà à garantir des fichiers à jour.
      setStatus(versionLabel
        ? `Dernière version disponible : ${versionLabel} — rechargement de l'app…`
        : "Mise à jour vérifiée — rechargement de l'app…");
      setTimeout(() => window.location.reload(), 900);
    } catch (e) {
      console.error(e);
      setStatus("Échec de la vérification (" + e.message + ") — réessaie plus tard.");
      btn.disabled = false;
    }
  });

  function setStatus(msg) { if (statusEl) statusEl.textContent = msg; }
}

// sauvegarde avant fermeture / mise en arrière-plan
window.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && App.campaign) doAutosave();
});
window.addEventListener("beforeunload", () => { if (App.campaign) doAutosave(); });

init();
