// symbols.js — symboles posés sur la carte (PJ, PNJ, lieux, dangers…)
import { App, worldToScreen, screenToWorld, markDirty } from "./state.js";
import { fogOpacityAt } from "./fog.js";

// Petits SVG dessinés à la main pour les symboles sans bon équivalent Unicode dans un univers
// médiéval-fantastique (pas de maison médiévale, tour de pierre, pont ancien, navire d'époque,
// sac en cuir ou entrée de caverne explicite parmi les émojis standards). Contrairement au
// premier essai (traits blancs fins façon icône), ceux-ci sont dessinés EN COULEURS PLEINES,
// façon petite illustration plate, pour rester dans le même registre visuel que les émojis
// (🧙💰🏰🔥…) plutôt que de trancher avec eux comme des pictogrammes de style différent.
// Maison à pans de bois (colombage) : base en pierre, étage à colombage avec croix de
// Saint-André, toit à pignon plus haut/pentu, porte cintrée en bois — d'après la référence
// fournie par l'utilisateur, simplifiée pour rester au même niveau de détail que les autres.
const SVG_MAISON = `<svg viewBox="0 0 24 24" width="20" height="20">
  <path d="M2 12.3 L12 2.8 L22 12.3 L19.3 12.3 L12 5.6 L4.7 12.3 Z" fill="#4a3624"/>
  <path d="M4.7 12 L12 5.2 L19.3 12 L19.3 14.3 L4.7 14.3 Z" fill="#7a5c40"/>
  <line x1="7.3" y1="9" x2="9.4" y2="12" stroke="#4a3624" stroke-width=".35" opacity=".6"/>
  <line x1="14.7" y1="9" x2="12.6" y2="12" stroke="#4a3624" stroke-width=".35" opacity=".6"/>
  <rect x="4.7" y="14.3" width="14.6" height="3.8" fill="#e8dcc4"/>
  <rect x="4.7" y="18.1" width="14.6" height="3.4" fill="#9a9488"/>
  <path d="M4.7 14.3 L9 18.1 M9 14.3 L4.7 18.1" stroke="#5c4630" stroke-width=".5"/>
  <path d="M15 14.3 L19.3 18.1 M19.3 14.3 L15 18.1" stroke="#5c4630" stroke-width=".5"/>
  <line x1="9" y1="14.3" x2="9" y2="18.1" stroke="#5c4630" stroke-width=".55"/>
  <line x1="15" y1="14.3" x2="15" y2="18.1" stroke="#5c4630" stroke-width=".55"/>
  <line x1="4.7" y1="16.2" x2="19.3" y2="16.2" stroke="#5c4630" stroke-width=".45"/>
  <path d="M9.6 21.5 L9.6 19 Q9.6 17.6 11 17.6 L13 17.6 Q14.4 17.6 14.4 19 L14.4 21.5 Z" fill="#3a2718"/>
</svg>`;
// Pont : tablier en arc de bois surélevé, avec garde-corps à claire-voie, posé sur deux
// piles à croix de Saint-André plantées dans la rivière — l'eau passe bien SOUS le tablier
// ET entre les deux piles (pas un pont posé à plat directement sur l'eau).
// Pont : la rivière ne traverse plus toute la largeur de la vignette — on voit la berge
// (herbe) de chaque côté, avec l'eau seulement au centre, sous le tablier et entre les piles.
const SVG_PONT = `<svg viewBox="0 0 24 24" width="20" height="20">
  <rect x="1" y="17" width="22" height="5" fill="#8fbf7a"/>
  <rect x="5" y="17" width="14" height="5" fill="#4a90c2"/>
  <path d="M3 15.3 Q12 5.8 21 15.3" fill="none" stroke="#6b4f34" stroke-width="2.6" stroke-linecap="round"/>
  <path d="M3.6 13 Q12 4 20.4 13" fill="none" stroke="#8a6a48" stroke-width="1.3" stroke-linecap="round"/>
  <line x1="6" y1="14.6" x2="6" y2="21" stroke="#5c4227" stroke-width=".8"/>
  <line x1="9" y1="12.4" x2="9" y2="21" stroke="#5c4227" stroke-width=".8"/>
  <line x1="15" y1="12.4" x2="15" y2="21" stroke="#5c4227" stroke-width=".8"/>
  <line x1="18" y1="14.6" x2="18" y2="21" stroke="#5c4227" stroke-width=".8"/>
  <path d="M6 16.5 L9 19 M9 16.5 L6 19" stroke="#5c4227" stroke-width=".6" fill="none"/>
  <path d="M15 16.5 L18 19 M18 16.5 L15 19" stroke="#5c4227" stroke-width=".6" fill="none"/>
</svg>`;
// Tente : même silhouette en A qu'avant (toile, rabat d'entrée, cordages tendus jusqu'aux
// piquets), entièrement en tons bruns — aucune trace de vert ni de lune dans ce dessin.
const SVG_TENTE = `<svg viewBox="0 0 24 24" width="20" height="20">
  <path d="M12 3.5 L21 20 L3 20 Z" fill="#8a5a2b"/>
  <path d="M12 3.5 L16.5 20 L7.5 20 Z" fill="#6b4321"/>
  <rect x="11.3" y="3.5" width="1.4" height="1.8" fill="#5c3a1a"/>
  <path d="M9.6 20 Q9.6 14.5 12 13.2 Q14.4 14.5 14.4 20 Z" fill="#3a2718"/>
  <circle cx="1.2" cy="21.9" r=".55" fill="#3a2718"/>
  <circle cx="22.8" cy="21.9" r=".55" fill="#3a2718"/>
  <line x1="3" y1="20" x2="1.2" y2="21.9" stroke="#5c3a1a" stroke-width=".6" stroke-linecap="round"/>
  <line x1="21" y1="20" x2="22.8" y2="21.9" stroke="#5c3a1a" stroke-width=".6" stroke-linecap="round"/>
</svg>`;
// Montagne : deux pics rocheux qui se chevauchent avec des sommets enneigés — remplace
// l'ancien émoji ⛰️ pour garder le même registre visuel que les autres symboles dessinés.
const SVG_MONTAGNE = `<svg viewBox="0 0 24 24" width="20" height="20">
  <path d="M14 5 L21.5 20 L6.5 20 Z" fill="#8a8578"/>
  <path d="M14 5 L16.8 10.5 L11.2 10.5 Z" fill="#eef2f5"/>
  <path d="M7 10 L13.5 20 L1.5 20 Z" fill="#6b6759"/>
  <path d="M7 10 L9.4 14.5 L4.6 14.5 Z" fill="#eef2f5"/>
</svg>`;
// Arbre : conifère à trois étages, remplace l'ancien émoji 🌲 pour garder le même registre
// visuel plat que les autres symboles dessinés.
const SVG_ARBRE = `<svg viewBox="0 0 24 24" width="20" height="20">
  <rect x="10.8" y="17" width="2.4" height="4" fill="#5c4630"/>
  <path d="M12 3 L17 11 L7 11 Z" fill="#3f7a42"/>
  <path d="M12 7.5 L18.2 15.5 L5.8 15.5 Z" fill="#4f8f4f"/>
  <path d="M12 11.5 L19.3 19 L4.7 19 Z" fill="#5fa657"/>
</svg>`;
// Tour : tour de château ronde/conique en pierre, légèrement évasée à la base, crénelée,
// avec une meurtrière et une porte cintrée en bois — d'après la référence (tour ronde).
const SVG_TOUR = `<svg viewBox="0 0 24 24" width="20" height="20">
  <ellipse cx="12" cy="21.4" rx="7.6" ry="1" fill="#00000022"/>
  <path d="M7 9 L6 21 L18 21 L17 9 Z" fill="#c7bfae"/>
  <path d="M6.3 9.3 L6.3 6.6 L7.6 6.6 L7.6 7.9 L9 7.9 L9 6.6 L10.3 6.6 L10.3 7.9 L11.6 7.9 L11.6 6.6 L12.4 6.6 L12.4 7.9 L13.7 7.9 L13.7 6.6 L15 6.6 L15 7.9 L16.4 7.9 L16.4 6.6 L17.7 6.6 L17.7 9.3 Z" fill="#a89e89"/>
  <path d="M7 9 L6 21 L18 21 L17 9 Z" fill="none" stroke="#7a7362" stroke-width=".35"/>
  <path d="M7.2 12 Q12 13 16.8 12 M6.8 15.5 Q12 16.4 17.2 15.5 M6.3 19 Q12 19.8 17.7 19" fill="none" stroke="#7a7362" stroke-width=".35"/>
  <rect x="11.1" y="10.8" width="1.6" height="4.6" rx=".7" fill="#2e2016"/>
  <path d="M9.7 21 L9.7 18.3 Q9.7 16.8 12 16.8 Q14.3 16.8 14.3 18.3 L14.3 21 Z" fill="#4a2f1c"/>
</svg>`;
const SVG_BATEAU = `<svg viewBox="0 0 24 24" width="20" height="20">
  <path d="M3 16 L21 16 L18 20.5 L6 20.5 Z" fill="#8a6d4b"/>
  <line x1="12" y1="16" x2="12" y2="3.5" stroke="#5c4630" stroke-width="1.4"/>
  <path d="M12.3 4.3 L18.6 15 L12.3 15 Z" fill="#eee3cf"/>
  <path d="M11.7 7 L11.7 15 L7 15 Z" fill="#eee3cf" opacity=".85"/>
</svg>`;
// Caverne : massif rocheux au sommet pointu avec des veines de roche stratifiées et une
// entrée sombre en arc — d'après la référence (montagne rocheuse avec bouche de grotte).
const SVG_CAVERNE = `<svg viewBox="0 0 24 24" width="20" height="20">
  <path d="M2 21 Q1 9.5 12 6.5 Q23 9.5 22 21 Z" fill="#8f8a7c"/>
  <path d="M6 21 Q6.5 12 12 9.5 Q17.5 12 18 21 Z" fill="#a89a7c" opacity=".55"/>
  <path d="M12 6.5 L9.5 21 M12 6.5 L14.5 21" stroke="#6b6152" stroke-width=".4" opacity=".5"/>
  <path d="M8.7 21 Q8.7 13.5 12 13 Q15.3 13.5 15.3 21 Z" fill="#15100c"/>
</svg>`;
// Sac à dos en cuir : poignée de portage, corps arrondi, poches latérales galbées et grand
// rabat arrondi avec boucle — d'après la référence (sac à dos en cuir avec rabat et poches).
const SVG_SAC = `<svg viewBox="0 0 24 24" width="19" height="19">
  <path d="M10.3 4.3 Q10.3 3 12 3 Q13.7 3 13.7 4.3" fill="none" stroke="#4a2f1c" stroke-width="1.1" stroke-linecap="round"/>
  <rect x="6.3" y="7.5" width="11.4" height="13.5" rx="3" fill="#8a5a2b"/>
  <path d="M4.8 12.5 Q4 12.6 4.1 14.5 L4.5 18 Q4.6 19.2 6.1 19 L6.6 19 L6.2 12.3 Z" fill="#7a4d24"/>
  <path d="M19.2 12.5 Q20 12.6 19.9 14.5 L19.5 18 Q19.4 19.2 17.9 19 L17.4 19 L17.8 12.3 Z" fill="#7a4d24"/>
  <path d="M7 8 Q12 5.6 17 8 L16.4 13.2 Q12 15 7.6 13.2 Z" fill="#9c6a37"/>
  <rect x="10.8" y="10.2" width="2.4" height="1.8" rx=".4" fill="#c9a876" stroke="#4a2f1c" stroke-width=".3"/>
  <line x1="12" y1="12" x2="12" y2="14" stroke="#c9a876" stroke-width="1"/>
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
  { key: "tente", svg: SVG_TENTE, label: "Tente de camping" },
  { key: "arbre", svg: SVG_ARBRE, label: "Arbre" },
  { key: "montagne", svg: SVG_MONTAGNE, label: "Montagne" },
  // 🏚️ ressemblait à une bâtisse en ruine à l'abandon, pas vraiment "médiévale" — remplacée par
  // une petite maison à toit pentu/chaume, plus proche d'une chaumière médiévale.
  { key: "maison", svg: SVG_MAISON, label: "Maison médiévale" },
  { key: "tour", svg: SVG_TOUR, label: "Tour de château" },
  { key: "pont", svg: SVG_PONT, label: "Pont en arc (pierre)" },
  { key: "bateau", svg: SVG_BATEAU, label: "Bateau (voile d'époque)" },
  { key: "caverne", svg: SVG_CAVERNE, label: "Entrée de caverne" },
  { key: "sac", svg: SVG_SAC, label: "Sac à dos en cuir" },
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
