// ui-play.js — câblage du "Mode Jeu" (joueurs) : zoom/pan, déplacement des symboles autorisés,
// et levée du brouillard sécurisée par un bouton d'activation explicite.
import { App } from "./state.js";
import { render } from "./mapview.js";
import { renderSymbols } from "./symbols.js";

export function initPlayUI() {
  const btn = document.getElementById("btn-fog-lift-toggle");
  btn.addEventListener("click", () => {
    App.fogLiftActive = !App.fogLiftActive;
    updateFogLiftButton();
  });
  updateFogLiftButton();
}

function updateFogLiftButton() {
  const btn = document.getElementById("btn-fog-lift-toggle");
  const stateEl = document.getElementById("fog-lift-state");
  btn.classList.toggle("active", App.fogLiftActive);
  stateEl.textContent = App.fogLiftActive ? "ON" : "OFF";
}

export function resetPlaySafety() {
  App.fogLiftActive = false;
  updateFogLiftButton();
  renderSymbols();
  render();
}
