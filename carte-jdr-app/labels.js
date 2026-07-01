// labels.js — textes libres posés sur la carte, sous ou au-dessus du brouillard.
import { App, worldToScreen, markDirty } from "./state.js";
import { fogOpacityAt } from "./fog.js";

function uidLabel() { return "l" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

export function placeLabelAt(x, y) {
  const text = (App.labelDraftText || "Nouveau texte").trim() || "Nouveau texte";
  const label = {
    id: uidLabel(),
    x, y,
    text,
    layer: "above",
    size: App.labelDraftSize || 18,
    color: App.labelDraftColor || "#ffffff",
  };
  App.campaign.labels.push(label);
  App.selectedLabelId = label.id;
  markDirty();
  renderLabels();
  document.dispatchEvent(new CustomEvent("app:label-selected", { detail: label }));
  return label;
}

export function getSelectedLabel() {
  return App.campaign?.labels.find((l) => l.id === App.selectedLabelId) || null;
}

export function deleteSelectedLabel() {
  const lab = getSelectedLabel();
  if (!lab) return;
  App.campaign.labels = App.campaign.labels.filter((l) => l.id !== lab.id);
  App.selectedLabelId = null;
  markDirty();
  renderLabels();
}

export function setSelectedLabelLayer(layer) {
  const lab = getSelectedLabel();
  if (!lab) return;
  lab.layer = layer;
  markDirty();
  renderLabels();
}

export function setSelectedLabelStyle({ size, color }) {
  const lab = getSelectedLabel();
  if (!lab) return;
  if (size != null) lab.size = size;
  if (color != null) lab.color = color;
  markDirty();
  renderLabels();
}

export function renderLabels() {
  const layerEl = App.els.symbolLayer; // même couche DOM que les symboles
  if (!layerEl || !App.campaign) return;

  const existing = new Map();
  layerEl.querySelectorAll(".map-label").forEach((el) => existing.set(el.dataset.id, el));

  for (const lab of App.campaign.labels) {
    let el = existing.get(lab.id);
    if (!el) {
      el = document.createElement("div");
      el.className = "map-label";
      el.dataset.id = lab.id;
      layerEl.appendChild(el);
      attachLabelDrag(el, lab);
    } else {
      existing.delete(lab.id);
    }
    el.textContent = lab.text;
    el.style.color = lab.color;
    el.style.fontSize = lab.size + "px";
    el.classList.toggle("selected", lab.id === App.selectedLabelId);

    const pos = worldToScreen(lab.x, lab.y);
    el.style.left = pos.x + "px";
    el.style.top = pos.y + "px";

    let visible = true;
    if (lab.layer !== "above") {
      visible = fogOpacityAt(lab.x, lab.y) < 140;
    }
    el.style.display = visible ? "block" : "none";
  }

  existing.forEach((el) => el.remove());
}

export function refreshLabelVisibility() {
  renderLabels();
}

function attachLabelDrag(el, labRef) {
  let dragging = false;
  let startScreen = null;
  let startWorld = null;

  el.addEventListener("pointerdown", (ev) => {
    ev.stopPropagation();
    if (App.mode !== "gm") return; // labels non déplaçables en mode Jeu
    App.selectedLabelId = labRef.id;
    document.dispatchEvent(new CustomEvent("app:label-selected", { detail: labRef }));
    renderLabels();
    dragging = true;
    el.setPointerCapture(ev.pointerId);
    startScreen = { x: ev.clientX, y: ev.clientY };
    startWorld = { x: labRef.x, y: labRef.y };
  });
  el.addEventListener("pointermove", (ev) => {
    if (!dragging) return;
    ev.stopPropagation();
    const dx = (ev.clientX - startScreen.x) / App.view.zoom;
    const dy = (ev.clientY - startScreen.y) / App.view.zoom;
    labRef.x = startWorld.x + dx;
    labRef.y = startWorld.y + dy;
    renderLabels();
  });
  const endDrag = (ev) => {
    if (!dragging) return;
    ev.stopPropagation();
    dragging = false;
    markDirty();
    renderLabels();
  };
  el.addEventListener("pointerup", endDrag);
  el.addEventListener("pointercancel", endDrag);
}
