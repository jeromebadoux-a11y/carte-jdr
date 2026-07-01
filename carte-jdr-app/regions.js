// regions.js — régions = portions recadrées de la carte globale, utilisées pour un scénario/lieu donné.
import { App, markDirty, resetViewToBounds } from "./state.js";

function uidRegion() { return "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

export function createRegionFromRect(rect, name) {
  const region = {
    id: uidRegion(),
    name: name || `Région ${App.campaign.regions.length + 1}`,
    cropX: rect.x, cropY: rect.y, cropW: rect.w, cropH: rect.h,
  };
  App.campaign.regions.push(region);
  App.campaign.activeRegionId = region.id;
  markDirty();
  resetViewToBounds();
  return region;
}

export function setActiveRegion(id) {
  App.campaign.activeRegionId = id || null;
  markDirty();
  resetViewToBounds();
}

export function renameRegion(id, name) {
  const r = App.campaign.regions.find((x) => x.id === id);
  if (!r) return;
  r.name = name;
  markDirty();
}

export function deleteRegion(id) {
  App.campaign.regions = App.campaign.regions.filter((r) => r.id !== id);
  if (App.campaign.activeRegionId === id) App.campaign.activeRegionId = null;
  markDirty();
  resetViewToBounds();
}
