// scalebar.js — barre d'échelle graduée, recalculée selon le zoom et paramétrable par le MJ.
import { App } from "./state.js";

const UNIT_LABELS = { m: "m", km: "km", mi: "mi", ft: "ft" };

function niceNumber(raw) {
  if (raw <= 0 || !isFinite(raw)) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const fraction = raw / magnitude;
  let niceFraction;
  if (fraction >= 5) niceFraction = 5;
  else if (fraction >= 2) niceFraction = 2;
  else niceFraction = 1;
  return niceFraction * magnitude;
}

export function updateScaleBar() {
  const el = App.els.scaleBar;
  if (!el || !App.campaign) return;
  const sb = App.campaign.scaleBar;
  if (!sb || !sb.visible || !App.campaign.mapWidth) {
    el.classList.add("hidden");
    return;
  }
  el.classList.remove("hidden");
  el.className = "scale-bar pos-" + sb.position;

  const unitsPerWorldPx = sb.realDistance / App.campaign.mapWidth;
  const unitsPerScreenPx = unitsPerWorldPx / App.view.zoom;

  const targetScreenPx = 150;
  const rawUnits = targetScreenPx * unitsPerScreenPx;
  const niceUnits = niceNumber(rawUnits);
  const barScreenPx = niceUnits / unitsPerScreenPx;

  const line = el.querySelector(".scale-bar-line");
  line.innerHTML = "";
  const segments = 4;
  for (let i = 0; i < segments; i++) {
    const seg = document.createElement("span");
    seg.className = "scale-seg" + (i % 2 === 1 ? " alt" : "");
    seg.style.flex = "1";
    line.appendChild(seg);
  }
  line.style.width = Math.max(30, barScreenPx) + "px";

  const label = el.querySelector(".scale-bar-label");
  const unitLabel = UNIT_LABELS[sb.unit] || sb.unit;
  const formatted = niceUnits >= 100 ? Math.round(niceUnits) : (Math.round(niceUnits * 100) / 100);
  label.textContent = `0 — ${formatted} ${unitLabel}`;
}
