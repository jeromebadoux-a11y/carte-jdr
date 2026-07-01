// symbols.js — symboles posés sur la carte (PJ, PNJ, lieux, dangers…)
import { App, worldToScreen, screenToWorld, markDirty } from "./state.js";
import { fogOpacityAt } from "./fog.js";

export const SYMBOL_TYPES = [
  { key: "pj", icon: "🧙", label: "Groupe de joueurs" },
  { key: "pnj", icon: "💬", label: "PNJ" },
  { key: "monstre", icon: "👹", label: "Monstre / Danger" },
  { key: "lieu", icon: "📍", label: "Lieu d'intérêt" },
  { key: "tresor", icon: "💰", label: "Trésor" },
  { key: "objectif", icon: "⭐", label: "Objectif" },
  { key: "porte", icon: "🚪", label: "Porte / Passage" },
  { key: "danger", icon: "☠️", label: "Piège / Danger" },
  { key: "perso", icon: "👤", label: "Personnage" },
  { key: "ville", icon: "🏰", label: "Ville / Bâtiment" },
  { key: "feu", icon: "🔥", label: "Campement / Feu" },
  { key: "note", icon: "❓", label: "Point d'intérêt" },
];

function uidSym() { return "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

export function placeSymbolAt(x, y, type) {
  const sym = {
    id: uidSym(),
    type,
    x, y,
    fogMode: "hidden",
    movableInPlay: false,
  };
  App.campaign.symbols.push(sym);
  App.selectedSymbolId = sym.id;
  markDirty();
  renderSymbols();
  document.dispatchEvent(new CustomEvent("app:symbol-selected", { detail: sym }));
  return sym;
}

export function getSelectedSymbol() {
  return App.campaign?.symbols.find((s) => s.id === App.selectedSymbolId) || null;
}

export function deleteSelectedSymbol() {
  const sym = getSelectedSymbol();
  if (!sym) return;
  App.campaign.symbols = App.campaign.symbols.filter((s) => s.id !== sym.id);
  App.selectedSymbolId = null;
  markDirty();
  renderSymbols();
}

export function setSelectedSymbolFogMode(mode) {
  const sym = getSelectedSymbol();
  if (!sym) return;
  sym.fogMode = mode;
  markDirty();
  renderSymbols();
}

export function setSelectedSymbolMovable(val) {
  const sym = getSelectedSymbol();
  if (!sym) return;
  sym.movableInPlay = val;
  markDirty();
  renderSymbols();
}

function typeInfo(type) {
  return SYMBOL_TYPES.find((t) => t.key === type) || SYMBOL_TYPES[0];
}

let dragCtx = null;

export function renderSymbols() {
  const layer = App.els.symbolLayer;
  if (!layer || !App.campaign) return;

  const existing = new Map();
  layer.querySelectorAll(".symbol-pin").forEach((el) => existing.set(el.dataset.id, el));

  for (const sym of App.campaign.symbols) {
    let el = existing.get(sym.id);
    if (!el) {
      el = document.createElement("div");
      el.className = "symbol-pin";
      el.dataset.id = sym.id;
      el.innerHTML = `<div class="pin-icon"></div><div class="pin-badge"></div><div class="pin-label"></div>`;
      layer.appendChild(el);
      attachPinDrag(el, sym);
    } else {
      existing.delete(sym.id);
    }
    const info = typeInfo(sym.type);
    el.querySelector(".pin-icon").textContent = info.icon;
    el.querySelector(".pin-badge").textContent = sym.fogMode === "above" ? "👁️" : "🌫️";
    el.querySelector(".pin-label").textContent = "";
    el.classList.toggle("selected", sym.id === App.selectedSymbolId);
    el.classList.toggle("fogmode-hidden", sym.fogMode !== "above");
    el.classList.toggle("fogmode-above", sym.fogMode === "above");

    const draggable = App.mode === "gm" || (App.mode === "play" && sym.movableInPlay);
    el.classList.toggle("locked-in-play", App.mode === "play" && !sym.movableInPlay);
    el.style.cursor = draggable ? "grab" : "default";

    const pos = worldToScreen(sym.x, sym.y);
    el.style.left = pos.x + "px";
    el.style.top = pos.y + "px";

    // visibilité selon le brouillard
    let visible = true;
    if (sym.fogMode !== "above") {
      const opacity = fogOpacityAt(sym.x, sym.y);
      visible = opacity < 140; // révélé si le brouillard local est suffisamment levé
    }
    el.style.display = visible ? "flex" : "none";
  }

  // supprime les pins obsolètes
  existing.forEach((el) => el.remove());
}

export function refreshSymbolVisibility() {
  renderSymbols();
}

function attachPinDrag(el, symRef) {
  let dragging = false;
  let startScreen = null;
  let startWorld = null;

  el.addEventListener("pointerdown", (ev) => {
    ev.stopPropagation();
    App.selectedSymbolId = symRef.id;
    document.dispatchEvent(new CustomEvent("app:symbol-selected", { detail: symRef }));
    renderSymbols();

    const draggable = App.mode === "gm" || (App.mode === "play" && symRef.movableInPlay);
    if (!draggable) return;
    dragging = true;
    el.setPointerCapture(ev.pointerId);
    startScreen = { x: ev.clientX, y: ev.clientY };
    startWorld = { x: symRef.x, y: symRef.y };
    el.style.cursor = "grabbing";
  });

  el.addEventListener("pointermove", (ev) => {
    if (!dragging) return;
    ev.stopPropagation();
    const dx = (ev.clientX - startScreen.x) / App.view.zoom;
    const dy = (ev.clientY - startScreen.y) / App.view.zoom;
    symRef.x = startWorld.x + dx;
    symRef.y = startWorld.y + dy;
    renderSymbols();
  });

  const endDrag = (ev) => {
    if (!dragging) return;
    ev.stopPropagation();
    dragging = false;
    el.style.cursor = "grab";
    markDirty();
    renderSymbols();
  };
  el.addEventListener("pointerup", endDrag);
  el.addEventListener("pointercancel", endDrag);
}
