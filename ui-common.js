// ui-common.js — petites aides UI partagées : modales et toasts.

export function toast(msg, ms = 2200) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), ms);
}

// Affiche une modale simple avec un champ texte, retourne une Promise<string|null>
export function promptModal(title, { placeholder = "", initial = "", okLabel = "OK", type = "text" } = {}) {
  return new Promise((resolve) => {
    const overlay = document.getElementById("modal-overlay");
    const box = document.getElementById("modal-box");
    box.innerHTML = `
      <h3>${escapeHtml(title)}</h3>
      <input type="${type}" id="modal-input" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(initial)}">
      <div class="modal-actions">
        <button class="btn btn-outline" id="modal-cancel">Annuler</button>
        <button class="btn btn-primary" id="modal-ok">${escapeHtml(okLabel)}</button>
      </div>`;
    overlay.classList.remove("hidden");
    const input = box.querySelector("#modal-input");
    input.focus();
    input.select();

    const close = (val) => { overlay.classList.add("hidden"); resolve(val); };
    box.querySelector("#modal-ok").onclick = () => close(input.value);
    box.querySelector("#modal-cancel").onclick = () => close(null);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") close(input.value); });
  });
}

// Modale générique "grille de choix" (ex. la liste complète des symboles) : affiche une carte
// cliquable par élément (rendu personnalisable via renderFn), résout avec l'élément choisi ou
// null si l'utilisateur ferme sans choisir. Réutilisée par le panneau MJ ET le Mode Jeu.
export function gridPickerModal(title, items, { renderFn, itemClass = "" } = {}) {
  return new Promise((resolve) => {
    const overlay = document.getElementById("modal-overlay");
    const box = document.getElementById("modal-box");
    box.innerHTML = `
      <h3>${escapeHtml(title)}</h3>
      <div class="modal-picker-grid" id="modal-picker-grid"></div>
      <div class="modal-actions">
        <button class="btn btn-outline" id="modal-cancel">Fermer</button>
      </div>`;
    overlay.classList.remove("hidden");
    const grid = box.querySelector("#modal-picker-grid");
    const close = (val) => { overlay.classList.add("hidden"); resolve(val); };
    items.forEach((item) => {
      const btn = document.createElement("div");
      btn.className = "symbol-swatch modal-picker-item" + (itemClass ? " " + itemClass : "");
      btn.title = item.label || "";
      btn.innerHTML = renderFn ? renderFn(item) : escapeHtml(String(item));
      btn.addEventListener("click", () => close(item));
      grid.appendChild(btn);
    });
    box.querySelector("#modal-cancel").onclick = () => close(null);
  });
}

export function confirmModal(title, message) {
  return new Promise((resolve) => {
    const overlay = document.getElementById("modal-overlay");
    const box = document.getElementById("modal-box");
    box.innerHTML = `
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(message)}</p>
      <div class="modal-actions">
        <button class="btn btn-outline" id="modal-cancel">Annuler</button>
        <button class="btn btn-danger" id="modal-ok">Confirmer</button>
      </div>`;
    overlay.classList.remove("hidden");
    const close = (val) => { overlay.classList.add("hidden"); resolve(val); };
    box.querySelector("#modal-ok").onclick = () => close(true);
    box.querySelector("#modal-cancel").onclick = () => close(false);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
