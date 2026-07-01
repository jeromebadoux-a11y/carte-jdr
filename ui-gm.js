// ui-gm.js — câblage de tout le panneau "Mode MJ".
import { App, markDirty, resetViewToBounds } from "./state.js";
import { render, zoomFit, startCropMode, cancelCropMode, getCropRect } from "./mapview.js";
import { initFogForMap, coverAll, clearAll, onFogChanged } from "./fog.js";
import {
  SYMBOL_TYPES, getSelectedSymbol, deleteSelectedSymbol,
  setSelectedSymbolFogMode, setSelectedSymbolMovable, renderSymbols,
} from "./symbols.js";
import { getSelectedLabel, deleteSelectedLabel, setSelectedLabelLayer, renderLabels } from "./labels.js";
import { createRegionFromRect, setActiveRegion, renameRegion, deleteRegion } from "./regions.js";
import { updateScaleBar } from "./scalebar.js";
import { toast, promptModal, confirmModal } from "./ui-common.js";
import { loadMapImageFromBlob, resizeImageToBlob, MAP_QUALITY_PRESETS } from "./mapload.js";
import { resetDetailState } from "./detail.js";
import { exportCampaignToFile } from "./fileio.js";
import { goBackToCampaignList } from "./main.js";

export function initGmUI() {
  initTabs();
  initCarteTab();
  initBrouillardTab();
  initSymbolesTab();
  initLabelsTab();
  initRegionsTab();
  initEchelleTab();
  initFichierTab();

  document.addEventListener("app:symbol-selected", refreshSymbolPanel);
  document.addEventListener("app:label-selected", refreshLabelPanel);
  document.addEventListener("app:armed-changed", () => {
    document.querySelectorAll(".symbol-swatch").forEach((b) => b.classList.toggle("active", b.dataset.type === App.armedSymbolType));
  });
}

export function refreshRegionsList() {
  const list = App.els.regionsList;
  list.innerHTML = "";
  const allCard = document.createElement("div");
  allCard.className = "region-card" + (!App.campaign.activeRegionId ? " active" : "");
  allCard.innerHTML = `<div class="rc-name">🌍 Carte globale entière</div>`;
  allCard.onclick = () => { setActiveRegion(null); render(); refreshRegionsList(); };
  list.appendChild(allCard);

  for (const r of App.campaign.regions) {
    const card = document.createElement("div");
    card.className = "region-card" + (App.campaign.activeRegionId === r.id ? " active" : "");
    card.innerHTML = `<div class="rc-name">${escapeHtml(r.name)}</div>
      <div class="rc-actions"><button data-act="rename">✏️</button><button data-act="del">🗑️</button></div>`;
    card.addEventListener("click", (ev) => {
      if (ev.target.closest("button")) return;
      setActiveRegion(r.id); render(); refreshRegionsList();
    });
    card.querySelector('[data-act="rename"]').onclick = async (ev) => {
      ev.stopPropagation();
      const name = await promptModal("Renommer la région", { initial: r.name });
      if (name) { renameRegion(r.id, name); refreshRegionsList(); }
    };
    card.querySelector('[data-act="del"]').onclick = async (ev) => {
      ev.stopPropagation();
      const ok = await confirmModal("Supprimer la région", `Supprimer « ${r.name} » ? La carte globale n'est pas affectée.`);
      if (ok) { deleteRegion(r.id); render(); refreshRegionsList(); }
    };
    list.appendChild(card);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function initTabs() {
  const tabs = document.querySelectorAll(".gm-tab");
  tabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabs.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(".gm-tab-panel").forEach((p) => p.classList.remove("active"));
      document.querySelector(`.gm-tab-panel[data-panel="${btn.dataset.tab}"]`).classList.add("active");
      App.gmTab = btn.dataset.tab;
      if (App.cropMode && btn.dataset.tab !== "carte") { cancelCropMode(); }
      App.armedSymbolType = null;
      App.armedLabel = false;
      document.dispatchEvent(new CustomEvent("app:armed-changed"));
    });
  });
}

// ---------- Onglet Carte ----------
function initCarteTab() {
  const input = document.getElementById("input-map-file");
  input.addEventListener("change", async () => {
    const file = input.files[0];
    if (!file) return;
    toast("Import de la carte en cours…");
    try {
      const qualityKey = document.getElementById("map-quality").value;
      const maxDim = MAP_QUALITY_PRESETS[qualityKey] ?? MAP_QUALITY_PRESETS.high;
      const { blob, width, height, originalWidth, originalHeight, cappedByDevice } = await resizeImageToBlob(file, maxDim);
      resetDetailState(); // une nouvelle carte invalide toute vignette haute résolution de l'ancienne
      App.campaign.mapImageBlob = blob;
      App.campaign.mapWidth = width;
      App.campaign.mapHeight = height;
      App.campaign.mapOriginalWidth = originalWidth;
      App.campaign.mapOriginalHeight = originalHeight;
      App.campaign.mapCappedByDevice = cappedByDevice;
      // Conserve le fichier importé tel quel (même s'il est réduit pour l'affichage d'ensemble
      // ci-dessus) afin de pouvoir en découper des portions en pleine résolution plus tard,
      // quand le MJ zoome fort ou recadre une région (voir detail.js). Inutile de le garder
      // en double si l'image d'ensemble est déjà à la résolution native (rien à gagner).
      App.campaign.originalImageBlob = width < originalWidth || height < originalHeight ? file : null;
      App.campaign.regions = [];
      App.campaign.activeRegionId = null;
      await loadMapImageFromBlob(blob);
      initFogForMap(width, height, true);
      onFogChanged();
      resetViewToBounds();
      renderSymbols(); renderLabels(); updateScaleBar(); render();
      updateMapInfo();
      refreshRegionsList();
      markDirty();
      if (cappedByDevice) {
        toast("Réduite en dessous du réglage choisi : la puce graphique de cet appareil ne gère pas plus grand ✔");
      } else {
        toast(width < originalWidth ? "Carte importée (réduite pour rester fluide) ✔" : "Carte importée à sa résolution d'origine ✔");
      }
      App.els.noMapHint.classList.add("hidden");
    } catch (e) {
      console.error(e);
      toast("Échec de l'import de l'image — essaie une qualité inférieure si l'image est très grande.");
    }
    input.value = "";
  });

  document.getElementById("btn-crop-mode").addEventListener("click", () => {
    beginCropFromUI();
  });
  document.getElementById("btn-crop-confirm").addEventListener("click", async () => {
    const rect = getCropRect();
    cancelCropMode();
    resetCropButtons();
    if (rect) {
      const name = await promptModal("Nom de la région / du scénario", { initial: `Région ${App.campaign.regions.length + 1}` });
      createRegionFromRect(rect, name || undefined);
      render(); updateScaleBar(); refreshRegionsList();
    }
  });
  document.getElementById("btn-crop-cancel").addEventListener("click", () => {
    cancelCropMode();
    resetCropButtons();
    render();
  });
  document.getElementById("btn-crop-reset").addEventListener("click", () => {
    setActiveRegion(null);
    render(); updateScaleBar(); refreshRegionsList();
  });
}

function resetCropButtons() {
  document.getElementById("btn-crop-mode").classList.remove("hidden");
  document.getElementById("btn-crop-confirm").classList.add("hidden");
  document.getElementById("btn-crop-cancel").classList.add("hidden");
}

// Point d'entrée unique pour démarrer le recadrage, utilisable depuis l'onglet Carte
// ET depuis l'onglet Régions : bascule vers l'onglet Carte (où se trouvent les boutons
// Valider/Annuler) puis active réellement le mode recadrage sur la carte.
function beginCropFromUI() {
  if (!App.campaign?.mapWidth) { toast("Importe d'abord une carte (onglet « Carte »)."); return; }
  const carteTabBtn = document.querySelector('.gm-tab[data-tab="carte"]');
  if (App.gmTab !== "carte") carteTabBtn.click();
  startCropMode();
  document.getElementById("btn-crop-mode").classList.add("hidden");
  document.getElementById("btn-crop-confirm").classList.remove("hidden");
  document.getElementById("btn-crop-cancel").classList.remove("hidden");
}

// ---------- Onglet Régions ----------
function initRegionsTab() {
  document.getElementById("btn-region-new-from-crop").addEventListener("click", () => {
    beginCropFromUI();
    toast("Dessine le rectangle sur la carte, puis valide en bas du panneau.");
  });
}

export function updateMapInfo() {
  const box = document.getElementById("map-info");
  const c = App.campaign;
  if (!c?.mapWidth) { box.classList.add("hidden"); return; }
  box.classList.remove("hidden");
  const reduced = c.mapOriginalWidth && c.mapOriginalWidth > c.mapWidth;
  const deviceNote = c.mapCappedByDevice ? " — limité par la puce graphique de cet appareil, pas par le réglage choisi" : "";
  const zoomNote = reduced && c.originalImageBlob
    ? " · le détail d'origine est automatiquement rechargé en zoomant ou en recadrant une région"
    : "";
  box.textContent = reduced
    ? `Carte : ${c.mapWidth} × ${c.mapHeight} px (réduite depuis l'original ${c.mapOriginalWidth} × ${c.mapOriginalHeight} px${deviceNote})${zoomNote}`
    : `Carte : ${c.mapWidth} × ${c.mapHeight} px (résolution d'origine conservée)`;
}

// ---------- Onglet Brouillard ----------
function initBrouillardTab() {
  App.fogToolMode = "reveal";
  App.fogBrushSize = 80;
  App.fogBrushShape = "round";

  const seg = document.getElementById("fog-tool-mode");
  seg.querySelectorAll(".seg-btn").forEach((b) => {
    b.addEventListener("click", () => {
      seg.querySelectorAll(".seg-btn").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      App.fogToolMode = b.dataset.fogtool;
    });
  });

  const sizeInput = document.getElementById("fog-brush-size");
  const sizeVal = document.getElementById("fog-brush-size-val");
  sizeInput.addEventListener("input", () => {
    App.fogBrushSize = Number(sizeInput.value);
    sizeVal.textContent = App.fogBrushSize + " px";
  });

  document.getElementById("fog-brush-shape").addEventListener("change", (ev) => {
    App.fogBrushShape = ev.target.value;
  });

  document.getElementById("btn-fog-cover-all").addEventListener("click", async () => {
    const ok = await confirmModal("Tout recouvrir", "Recouvrir toute la carte globale de brouillard ?");
    if (!ok) return;
    coverAll(); onFogChanged(); renderSymbols(); renderLabels(); render();
  });
  document.getElementById("btn-fog-clear-all").addEventListener("click", async () => {
    const ok = await confirmModal("Tout révéler", "Révéler tout le brouillard de la carte globale ?");
    if (!ok) return;
    clearAll(); onFogChanged(); renderSymbols(); renderLabels(); render();
  });
}

// ---------- Onglet Symboles ----------
function initSymbolesTab() {
  const palette = document.getElementById("symbol-palette");
  for (const t of SYMBOL_TYPES) {
    const btn = document.createElement("div");
    btn.className = "symbol-swatch";
    btn.dataset.type = t.key;
    btn.title = t.label;
    btn.textContent = t.icon;
    btn.addEventListener("click", () => {
      App.armedSymbolType = App.armedSymbolType === t.key ? null : t.key;
      App.armedLabel = false;
      document.dispatchEvent(new CustomEvent("app:armed-changed"));
    });
    palette.appendChild(btn);
  }

  const fogSeg = document.getElementById("symbol-fogmode");
  fogSeg.querySelectorAll(".seg-btn").forEach((b) => {
    b.addEventListener("click", () => {
      setSelectedSymbolFogMode(b.dataset.fogmode);
      refreshSymbolPanel();
    });
  });

  document.getElementById("symbol-movable-toggle").addEventListener("change", (ev) => {
    setSelectedSymbolMovable(ev.target.checked);
  });
  document.getElementById("btn-delete-symbol").addEventListener("click", async () => {
    if (!getSelectedSymbol()) return;
    const ok = await confirmModal("Supprimer", "Supprimer ce symbole ?");
    if (ok) deleteSelectedSymbol();
  });
}

function refreshSymbolPanel() {
  const sym = getSelectedSymbol();
  const fogSeg = document.getElementById("symbol-fogmode");
  fogSeg.querySelectorAll(".seg-btn").forEach((b) => b.classList.toggle("active", !!sym && sym.fogMode === b.dataset.fogmode));
  document.getElementById("symbol-movable-toggle").checked = !!sym && sym.movableInPlay;
}

// ---------- Onglet Labels ----------
function initLabelsTab() {
  App.labelDraftText = "Nouveau texte";
  App.labelDraftSize = 18;
  App.labelDraftColor = "#ffffff";

  const textInput = document.getElementById("label-text-input");
  textInput.value = App.labelDraftText;
  textInput.addEventListener("input", () => {
    App.labelDraftText = textInput.value;
    const sel = getSelectedLabel();
    if (sel) { sel.text = textInput.value; markDirty(); renderLabels(); }
  });

  document.getElementById("btn-add-label").addEventListener("click", () => {
    App.armedLabel = !App.armedLabel;
    App.armedSymbolType = null;
    document.dispatchEvent(new CustomEvent("app:armed-changed"));
    toast(App.armedLabel ? "Touche la carte pour poser le texte" : "Pose de texte annulée");
  });

  const layerSeg = document.getElementById("label-layer");
  layerSeg.querySelectorAll(".seg-btn").forEach((b) => {
    b.addEventListener("click", () => { setSelectedLabelLayer(b.dataset.layer); refreshLabelPanel(); });
  });

  document.getElementById("label-size").addEventListener("input", (ev) => {
    const sel = getSelectedLabel();
    if (sel) { sel.size = Number(ev.target.value); markDirty(); renderLabels(); }
  });
  document.getElementById("label-color").addEventListener("input", (ev) => {
    const sel = getSelectedLabel();
    if (sel) { sel.color = ev.target.value; markDirty(); renderLabels(); }
  });
  document.getElementById("btn-delete-label").addEventListener("click", async () => {
    if (!getSelectedLabel()) return;
    const ok = await confirmModal("Supprimer", "Supprimer ce texte ?");
    if (ok) deleteSelectedLabel();
  });
}

function refreshLabelPanel() {
  const lab = getSelectedLabel();
  const layerSeg = document.getElementById("label-layer");
  layerSeg.querySelectorAll(".seg-btn").forEach((b) => b.classList.toggle("active", !!lab && lab.layer === b.dataset.layer));
  if (lab) {
    document.getElementById("label-size").value = lab.size;
    document.getElementById("label-color").value = lab.color;
    document.getElementById("label-text-input").value = lab.text;
  }
}

// ---------- Onglet Échelle ----------
function initEchelleTab() {
  const visible = document.getElementById("scale-visible-toggle");
  const dist = document.getElementById("scale-real-distance");
  const unit = document.getElementById("scale-unit");
  const pos = document.getElementById("scale-position");

  function sync() {
    const sb = App.campaign.scaleBar;
    visible.checked = sb.visible;
    dist.value = sb.realDistance;
    unit.value = sb.unit;
    pos.value = sb.position;
  }
  App.syncScalePanel = sync;

  visible.addEventListener("change", () => { App.campaign.scaleBar.visible = visible.checked; markDirty(); updateScaleBar(); });
  dist.addEventListener("input", () => { App.campaign.scaleBar.realDistance = Number(dist.value) || 1; markDirty(); updateScaleBar(); });
  unit.addEventListener("change", () => { App.campaign.scaleBar.unit = unit.value; markDirty(); updateScaleBar(); });
  pos.addEventListener("change", () => { App.campaign.scaleBar.position = pos.value; markDirty(); updateScaleBar(); });
}

// ---------- Onglet Fichier ----------
function initFichierTab() {
  document.getElementById("btn-save-now").addEventListener("click", async () => {
    markDirty();
    toast("Sauvegarde en cours…");
  });
  document.getElementById("btn-export-file").addEventListener("click", async () => {
    try {
      const name = await exportCampaignToFile(App.campaign);
      toast("Fichier exporté : " + name);
    } catch (e) {
      console.error(e);
      toast("Échec de l'export.");
    }
  });
  document.getElementById("btn-rename-campaign").addEventListener("click", async () => {
    const name = await promptModal("Renommer la partie", { initial: App.campaign.name });
    if (name) {
      App.campaign.name = name;
      App.els.campaignNameLabel.textContent = name;
      markDirty();
    }
  });
  document.getElementById("btn-delete-campaign").addEventListener("click", async () => {
    const ok = await confirmModal("Supprimer la partie", `Supprimer définitivement « ${App.campaign.name} » ? Cette action est irréversible.`);
    if (ok) {
      const { deleteCampaign } = await import("./db.js");
      await deleteCampaign(App.campaign.id);
      toast("Partie supprimée");
      goBackToCampaignList();
    }
  });
}
