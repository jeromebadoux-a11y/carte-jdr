// mapload.js — import/redimensionnement d'une image de carte, chargement en mémoire pour le rendu.
import { App } from "./state.js";

// Préréglages de qualité proposés au MJ à l'import (taille max du plus grand côté, en px).
// "original" (Infinity) ne réduit jamais l'image, mais consomme davantage de mémoire sur
// la tablette pour de très grandes images (ex: 16000px de large) — à réserver aux tablettes
// récentes / puissantes, ou si vraiment aucune perte de détail n'est acceptable.
export const MAP_QUALITY_PRESETS = {
  fast: 4096,
  high: 8192,
  veryhigh: 12288,
  original: Infinity,
};

// Détecte la taille de texture maximale que la puce graphique de CET appareil peut gérer.
// Au-delà, le navigateur peut corrompre/déformer l'affichage au lieu d'afficher une erreur
// propre — d'où l'importance de ne jamais la dépasser, quel que soit le réglage de qualité
// choisi par le MJ. On retire une marge de sécurité car certains navigateurs se comportent
// mal juste en dessous de leur limite théorique.
let _maxSafeDim = null;
export function getMaxSafeTextureSize() {
  if (_maxSafeDim) return _maxSafeDim;
  let detected = 4096; // repli prudent si la détection échoue
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (gl) {
      const size = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      if (size && size > 0) detected = size;
    }
  } catch (e) { /* on garde le repli */ }
  _maxSafeDim = Math.max(2048, Math.round(detected * 0.85)); // marge de sécurité de 15%
  return _maxSafeDim;
}

export async function resizeImageToBlob(file, maxDim = MAP_QUALITY_PRESETS.high) {
  const bitmap = await loadBitmap(file);
  const w = bitmap.width, h = bitmap.height;
  const largest = Math.max(w, h);
  const effectiveMaxDim = Math.min(maxDim, getMaxSafeTextureSize());

  if (largest <= effectiveMaxDim) {
    bitmap.close?.();
    return { blob: file, width: w, height: h, originalWidth: w, originalHeight: h, cappedByDevice: false };
  }

  const scale = effectiveMaxDim / largest;
  const nw = Math.round(w * scale), nh = Math.round(h * scale);
  const canvas = document.createElement("canvas");
  canvas.width = nw; canvas.height = nh;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, nw, nh);
  bitmap.close?.();
  const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.92));
  return { blob, width: nw, height: nh, originalWidth: w, originalHeight: h, cappedByDevice: effectiveMaxDim < maxDim };
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
