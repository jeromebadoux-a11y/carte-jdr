// mapload.js — import/redimensionnement d'une image de carte, chargement en mémoire pour le rendu.
import { App, MAX_MAP_DIM } from "./state.js";

export async function resizeImageToBlob(file) {
  const bitmap = await loadBitmap(file);
  const w = bitmap.width, h = bitmap.height;
  const maxDim = Math.max(w, h);

  if (maxDim <= MAX_MAP_DIM) {
    bitmap.close?.();
    return { blob: file, width: w, height: h };
  }

  const scale = MAX_MAP_DIM / maxDim;
  const nw = Math.round(w * scale), nh = Math.round(h * scale);
  const canvas = document.createElement("canvas");
  canvas.width = nw; canvas.height = nh;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, nw, nh);
  bitmap.close?.();
  const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.9));
  return { blob, width: nw, height: nh };
}

function loadBitmap(file) {
  if (window.createImageBitmap) {
    return createImageBitmap(file);
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

let currentUrl = null;

export function loadMapImageFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      App.mapImage = img;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
      currentUrl = img.src;
      resolve(img);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(blob);
  });
}
