// main.js — point d'entrée : écran des parties, ouverture/fermeture d'une partie, bascule MJ/Jeu.
import { App, resetViewToBounds, doAutosave } from "./state.js";
import { listCampaignsMeta, getCampaign, saveCampaign, newCampaign, deleteCampaign, uid } from "./db.js";
import { importCampaignFromFile } from "./fileio.js";
import { initMapView, renderAll, zoomBy, zoomFit } from "./mapview.js";
import { initFogForMap, loadFogFromBlob } from "./fog.js";
import { loadMapImageFromBlob } from "./mapload.js";
import { initGmUI, refreshRegionsList } from "./ui-gm.js";
import { initPlayUI, resetPlaySafety } from "./ui-play.js";
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

  setMode("gm");
  resetViewToBounds();
  App.syncScalePanel?.();
  refreshRegionsList();
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
function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").then((reg) => {
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

// sauvegarde avant fermeture / mise en arrière-plan
window.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && App.campaign) doAutosave();
});
window.addEventListener("beforeunload", () => { if (App.campaign) doAutosave(); });

init();
