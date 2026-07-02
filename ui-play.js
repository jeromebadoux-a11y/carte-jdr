// ui-play.js — câblage du "Mode Jeu" (joueurs) : zoom/pan, déplacement des symboles autorisés,
// levée du brouillard sécurisée par un bouton d'activation explicite, et ajout de symboles par
// les joueurs eux-mêmes (palette restreinte au même catalogue que le MJ, affichée en noir & blanc
// dans un cercle pour bien distinguer un symbole posé par un joueur de ceux posés par le MJ).
import { App } from "./state.js";
import { render } from "./mapview.js";
import { renderSymbols, getTopSymbolTypes, SYMBOL_TYPES } from "./symbols.js";
import { gridPickerModal } from "./ui-common.js";

export function initPlayUI() {
  const btn = document.getElementById("btn-fog-lift-toggle");
  btn.addEventListener("click", () => {
    App.fogLiftActive = !App.fogLiftActive;
    updateFogLiftButton();
  });
  updateFogLiftButton();

  initPlaySymbolPalette();

  document.addEventListener("app:armed-changed", updatePlayAddSymbolUI);
}

function updateFogLiftButton() {
  const btn = document.getElementById("btn-fog-lift-toggle");
  const stateEl = document.getElementById("fog-lift-state");
  btn.classList.toggle("active", App.fogLiftActive);
  stateEl.textContent = App.fogLiftActive ? "ON" : "OFF";
}

// ---------- Ajout de symboles par les joueurs ----------
function initPlaySymbolPalette() {
  const toggleBtn = document.getElementById("btn-play-add-symbol");
  const popup = document.getElementById("play-symbol-palette");

  toggleBtn.addEventListener("click", () => {
    if (popup.classList.contains("hidden")) {
      openPlaySymbolPopup();
    } else {
      closePlaySymbolPopup();
    }
  });

  document.getElementById("btn-play-more-symbols").addEventListener("click", async () => {
    const picked = await gridPickerModal("Choisis un symbole à poser", SYMBOL_TYPES, {
      renderFn: (t) => t.icon,
      itemClass: "play-style",
    });
    if (picked) armPlaySymbol(picked.key);
  });
}

function openPlaySymbolPopup() {
  const popup = document.getElementById("play-symbol-palette");
  const grid = document.getElementById("play-symbol-grid");
  grid.innerHTML = "";
  for (const t of getTopSymbolTypes(10)) {
    const btn = document.createElement("div");
    btn.className = "symbol-swatch play-style";
    btn.dataset.type = t.key;
    btn.title = t.label;
    btn.textContent = t.icon;
    btn.classList.toggle("active", App.armedSymbolTypePlay === t.key);
    btn.addEventListener("click", () => armPlaySymbol(t.key));
    grid.appendChild(btn);
  }
  popup.classList.remove("hidden");
  document.getElementById("btn-play-add-symbol").classList.add("active");
}

function closePlaySymbolPopup() {
  document.getElementById("play-symbol-palette").classList.add("hidden");
  document.getElementById("btn-play-add-symbol").classList.remove("active");
}

function armPlaySymbol(key) {
  App.armedSymbolTypePlay = App.armedSymbolTypePlay === key ? null : key;
  document.dispatchEvent(new CustomEvent("app:armed-changed"));
}

function updatePlayAddSymbolUI() {
  const popup = document.getElementById("play-symbol-palette");
  if (!popup) return;
  popup.querySelectorAll(".symbol-swatch[data-type]").forEach((b) => {
    b.classList.toggle("active", b.dataset.type === App.armedSymbolTypePlay);
  });
  // une fois un symbole posé (l'armement retombe à null), on referme la petite palette
  if (!App.armedSymbolTypePlay && !popup.classList.contains("hidden")) {
    closePlaySymbolPopup();
  }
}

export function resetPlaySafety() {
  App.fogLiftActive = false;
  App.armedSymbolTypePlay = null;
  updateFogLiftButton();
  closePlaySymbolPopup();
  renderSymbols();
  render();
}
