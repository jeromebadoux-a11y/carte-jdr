// symbols.js — symboles posés sur la carte (PJ, PNJ, lieux, dangers…)
import { App, worldToScreen, screenToWorld, markDirty } from "./state.js";
import { fogOpacityAt } from "./fog.js";

// Petits SVG monochromes dessinés à la main pour les symboles sans bon équivalent Unicode dans
// un univers médiéval-fantastique (pas de tour de pierre, pont ancien, navire d'époque, sac en
// cuir ou entrée de caverne explicite parmi les émojis standards — les alternatives disponibles
// sont soit trop modernes (pont suspendu, sac à dos en nylon, voilier de régate), soit trop
// abstraites (🕳️ pour une grotte)). Couleur "currentColor" pour bien se fondre avec le style du
// pin (y compris le rendu noir & blanc des symboles posés par les joueurs, voir style.css).
// Pont : un tablier plat posé sur des piles, au-dessus d'une ligne d'eau ondulée — volontairement
// différent de la voûte de la caverne (ci-dessous) pour ne pas les confondre à petite taille.
const SVG_PONT = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <line x1="2" y1="9" x2="22" y2="9" />
  <line x1="7" y1="9" x2="7" y2="17" />
  <line x1="17" y1="9" x2="17" y2="17" />
  <path d="M2 19 Q7 16.3 12 19 Q17 21.7 22 19" />
</svg>`;
const SVG_BATEAU = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
  <path d="M4 16 L20 16 L17 20.5 L7 20.5 Z" fill="currentColor" stroke="none"/>
  <line x1="12" y1="16" x2="12" y2="3.5" />
  <path d="M12.3 4.5 L18.5 15 L12.3 15 Z" fill="currentColor" stroke="none"/>
</svg>`;
// Caverne : un monticule rocheux avec une ouverture sombre creusée dedans (remplie en foncé,
// pas "currentColor", pour bien lire comme un TROU même sur un fond clair) — plus explicite
// que l'ancien 🕳️ (un simple point noir, trop abstrait pour se voir comme une grotte).
const SVG_CAVERNE = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">
  <path d="M2.5 20.5 Q1.5 10.5 12 8.5 Q22.5 10.5 21.5 20.5 Z" />
  <path d="M8.5 20.5 Q8.5 12.5 12 12.5 Q15.5 12.5 15.5 20.5 Z" fill="#000000" fill-opacity="0.92" stroke="none"/>
</svg>`;
const SVG_SAC = `<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round">
  <path d="M9 9.5 L9 6.8 Q9 3.8 12 3.8 Q15 3.8 15 6.8 L15 9.5" />
  <path d="M6 10 Q6 8.7 7.3 8.5 L16.7 8.5 Q18 8.7 18.2 10 L19.3 19.3 Q19.4 20.7 18 20.7 L6 20.7 Q4.6 20.7 4.7 19.3 Z" />
  <line x1="9.5" y1="12.5" x2="9" y2="17.5" />
  <line x1="14.5" y1="12.5" x2="15" y2="17.5" />
</svg>`;

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
  { key: "croix", icon: "✖️", label: "Repère (croix sur la carte)" },
  { key: "tente", icon: "⛺", label: "Tente de camping" },
  { key: "arbre", icon: "🌲", label: "Arbre" },
  { key: "montagne", icon: "⛰️", label: "Montagne" },
  { key: "maison", icon: "🏚️", label: "Maison médiévale" },
  // ♜ (tour d'échecs) ressemble bien à une tour de pierre crénelée — bien plus adapté qu'un
  // émoji "tour" moderne (🗼 = tour de télécom/Tokyo Tower).
  { key: "tour", icon: "♜", label: "Tour médiévale" },
  { key: "pont", svg: SVG_PONT, label: "Pont (bois/pierre)" },
  { key: "bateau", svg: SVG_BATEAU, label: "Bateau (voile d'époque)" },
  { key: "caverne", svg: SVG_CAVERNE, label: "Entrée de caverne" },
  { key: "sac", svg: SVG_SAC, label: "Sac en cuir" },
];

function uidSym() { return "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// Rendu d'un symbole : soit un émoji (info.icon), soit un petit SVG dessiné à la main
// (info.svg) pour les cas où aucun émoji adapté à un univers médiéval-fantastique n'existe.
export function symbolGlyphHTML(info) {
  return info.svg || info.icon || "";
}

// Renvoie le catalogue trié par nombre d'utilisations décroissant (les plus posés en premier),
// à égalité on garde l'ordre du catalogue — utilisé pour la palette compacte "10 plus utilisés".
export function getTopSymbolTypes(limit = 10) {
  const usage = App.campaign?.symbolUsage || {};
  return SYMBOL_TYPES
    .map((t, i) => ({ t, i, count: usage[t.key] || 0 }))
    .sort((a, b) => b.count - a.count || a.i - b.i)
    .slice(0, limit)
    .map((e) => e.t);
}

function recordSymbolUsage(type) {
  if (!App.campaign) return;
  if (!App.campaign.symbolUsage) App.campaign.symbolUsage = {};
  App.campaign.symbolUsage[type] = (App.campaign.symbolUsage[type] || 0) + 1;
}

// opts.placedByPlayer : posé par un joueur en Mode Jeu (au lieu du MJ) — déplaçable et effaçable
// par ce joueur, toujours visible (au-dessus du brouillard), affiché en noir & blanc sur la carte
// pour bien le distinguer des symboles posés par le MJ (voir renderSymbols / style.css).
export function placeSymbolAt(x, y, type, opts = {}) {
  const placedByPlayer = !!opts.placedByPlayer;
  const sym = {
    id: uidSym(),
    type,
    x, y,
    label: opts.label || "",
    fogMode: placedByPlayer ? "above" : "hidden",
    movableInPlay: placedByPlayer ? true : false,
    placedByPlayer,
  };
  App.campaign.symbols.push(sym);
  App.selectedSymbolId = sym.id;
  recordSymbolUsage(type);
  markDirty();
  renderSymbols();
  document.dispatchEvent(new CustomEvent("app:symbol-selected", { detail: sym }));
  document.dispatchEvent(new CustomEvent("app:symbol-placed", { detail: sym }));
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

export function setSelectedSymbolLabel(text) {
  const sym = getSelectedSymbol();
  if (!sym) return;
  sym.label = text;
  markDirty();
  renderSymbols();
}

// Un joueur ne peut effacer QUE les symboles qu'il a lui-même posés en Mode Jeu (pas ceux du MJ).
// Le MJ, lui, peut toujours tout supprimer via l'onglet Symboles (deleteSelectedSymbol), sans
// cette restriction — voir le bouton 🗑️ qui apparaît directement sur le pin en Mode Jeu.
export function deleteSymbolIfAllowedInPlay(id) {
  const sym = App.campaign?.symbols.find((s) => s.id === id);
  if (!sym || !sym.placedByPlayer) return;
  App.campaign.symbols = App.campaign.symbols.filter((s) => s.id !== id);
  if (App.selectedSymbolId === id) App.selectedSymbolId = null;
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
      el.innerHTML = `<div class="pin-icon"></div><div class="pin-badge"></div><div class="pin-delete">🗑️</div><div class="pin-label"></div>`;
      layer.appendChild(el);
      attachPinDrag(el, sym);
      el.querySelector(".pin-delete").addEventListener("pointerdown", (ev) => {
        ev.stopPropagation();
        deleteSymbolIfAllowedInPlay(sym.id);
      });
    } else {
      existing.delete(sym.id);
    }
    const info = typeInfo(sym.type);
    el.querySelector(".pin-icon").innerHTML = symbolGlyphHTML(info);
    // le badge "visible/caché par le brouillard" est une info de RÉGLAGE utile au MJ — les
    // joueurs n'ont pas à la voir (elle n'a d'ailleurs pas de sens pour eux : ils ne choisissent
    // pas ce réglage), donc masqué entièrement en Mode Jeu.
    const badgeEl = el.querySelector(".pin-badge");
    badgeEl.textContent = sym.fogMode === "above" ? "👁️" : "🌫️";
    badgeEl.style.display = App.mode === "gm" ? "" : "none";
    el.querySelector(".pin-label").textContent = sym.label || "";
    el.querySelector(".pin-label").style.display = sym.label ? "block" : "none";
    el.classList.toggle("selected", sym.id === App.selectedSymbolId);
    el.classList.toggle("fogmode-hidden", sym.fogMode !== "above");
    el.classList.toggle("fogmode-above", sym.fogMode === "above");
    el.classList.toggle("player-placed", !!sym.placedByPlayer);

    // le bouton d'effacement sur le pin lui-même n'a de sens qu'en Mode Jeu, et uniquement pour
    // un symbole que CE joueur a posé (pas un symbole du MJ) ; le MJ efface via son propre panneau.
    const showDeleteBadge = App.mode === "play" && sym.placedByPlayer && sym.id === App.selectedSymbolId;
    el.querySelector(".pin-delete").style.display = showDeleteBadge ? "flex" : "none";

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
