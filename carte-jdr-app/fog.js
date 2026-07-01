// fog.js — masque de brouillard de guerre : création, pinceau (révéler/recouvrir), lecture d'opacité.
import { App, MAX_FOG_DIM, FOG_SCALE_DEFAULT, markDirty } from "./state.js";

export function initFogForMap(width, height, fullyCovered = true) {
  const scale = Math.min(FOG_SCALE_DEFAULT, MAX_FOG_DIM / Math.max(width, height));
  const fw = Math.max(1, Math.round(width * scale));
  const fh = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = fw;
  canvas.height = fh;
  const ctx = canvas.getContext("2d");
  if (fullyCovered) {
    ctx.fillStyle = "#0b0b0e";
    ctx.fillRect(0, 0, fw, fh);
  }
  App.fogCanvas = canvas;
  App.fogCtx = ctx;
  App.campaign.fogWidth = fw;
  App.campaign.fogHeight = fh;
  App.campaign.fogScale = scale;
}

export function loadFogFromBlob(blob, width, height, scale) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      App.fogCanvas = canvas;
      App.fogCtx = ctx;
      URL.revokeObjectURL(img.src);
      resolve();
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(blob);
  });
}

export async function persistFogToBlob() {
  if (!App.fogCanvas) return;
  const blob = await new Promise((res) => App.fogCanvas.toBlob(res, "image/png"));
  App.campaign.fogBlob = blob;
}

function toFogCoords(worldX, worldY) {
  const s = App.campaign.fogScale;
  return { x: worldX * s, y: worldY * s };
}

// dessine un coup de pinceau (segment de last -> cur) en coordonnées MONDE
export function brushStroke(lastWorld, curWorld, radiusWorld, shape, reveal) {
  if (!App.fogCtx) return;
  const ctx = App.fogCtx;
  const s = App.campaign.fogScale;
  const r = Math.max(1, radiusWorld * s);

  ctx.save();
  ctx.globalCompositeOperation = reveal ? "destination-out" : "source-over";

  const from = toFogCoords(lastWorld.x, lastWorld.y);
  const to = toFogCoords(curWorld.x, curWorld.y);
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const step = Math.max(2, r * 0.35);
  const steps = Math.max(1, Math.ceil(dist / step));

  for (let i = 0; i <= steps; i++) {
    const t = steps === 0 ? 0 : i / steps;
    const px = from.x + (to.x - from.x) * t;
    const py = from.y + (to.y - from.y) * t;
    stampBrush(ctx, px, py, r, shape, reveal);
  }
  ctx.restore();
}

function stampBrush(ctx, x, y, r, shape, reveal) {
  if (shape === "square") {
    if (reveal) {
      ctx.fillStyle = "rgba(0,0,0,1)";
    } else {
      ctx.fillStyle = "#0b0b0e";
    }
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  } else {
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    if (reveal) {
      grad.addColorStop(0, "rgba(0,0,0,1)");
      grad.addColorStop(0.75, "rgba(0,0,0,1)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
    } else {
      grad.addColorStop(0, "rgba(11,11,14,1)");
      grad.addColorStop(0.75, "rgba(11,11,14,1)");
      grad.addColorStop(1, "rgba(11,11,14,0)");
    }
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function coverAll() {
  if (!App.fogCtx) return;
  const c = App.fogCanvas;
  App.fogCtx.save();
  App.fogCtx.globalCompositeOperation = "source-over";
  App.fogCtx.fillStyle = "#0b0b0e";
  App.fogCtx.fillRect(0, 0, c.width, c.height);
  App.fogCtx.restore();
}

export function clearAll() {
  if (!App.fogCtx) return;
  const c = App.fogCanvas;
  App.fogCtx.save();
  App.fogCtx.globalCompositeOperation = "destination-out";
  App.fogCtx.fillRect(0, 0, c.width, c.height);
  App.fogCtx.restore();
}

// opacité du brouillard (0-255) à une coordonnée MONDE donnée
export function fogOpacityAt(worldX, worldY) {
  if (!App.fogCtx || !App.fogCanvas) return 0;
  const { x, y } = toFogCoords(worldX, worldY);
  const fx = Math.min(App.fogCanvas.width - 1, Math.max(0, Math.round(x)));
  const fy = Math.min(App.fogCanvas.height - 1, Math.max(0, Math.round(y)));
  try {
    const data = App.fogCtx.getImageData(fx, fy, 1, 1).data;
    return data[3];
  } catch (e) {
    return 0;
  }
}

export function onFogChanged() {
  persistFogToBlob().then(markDirty);
}
