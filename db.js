// db.js — persistance locale via IndexedDB (fonctionne 100% hors ligne).
// Deux object stores :
//  - "meta"       : petites fiches pour lister les parties rapidement (sans charger les images)
//  - "campaigns"  : données complètes d'une partie (carte, brouillard, symboles, labels, régions…)

const DB_NAME = "rpgmap-db";
const DB_VERSION = 1;

let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("campaigns")) {
        db.createObjectStore("campaigns", { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function tx(storeNames, mode) {
  return openDB().then((db) => db.transaction(storeNames, mode));
}

export function uid() {
  return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export async function listCampaignsMeta() {
  const t = await tx(["meta"], "readonly");
  return new Promise((resolve, reject) => {
    const store = t.objectStore("meta");
    const req = store.getAll();
    req.onsuccess = () => {
      const items = req.result || [];
      items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      resolve(items);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getCampaign(id) {
  const t = await tx(["campaigns"], "readonly");
  return new Promise((resolve, reject) => {
    const req = t.objectStore("campaigns").get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveCampaign(campaign, thumbnailDataURL) {
  campaign.updatedAt = Date.now();
  const t = await tx(["meta", "campaigns"], "readwrite");
  return new Promise((resolve, reject) => {
    t.objectStore("campaigns").put(campaign);
    t.objectStore("meta").put({
      id: campaign.id,
      name: campaign.name,
      createdAt: campaign.createdAt,
      updatedAt: campaign.updatedAt,
      thumbnail: thumbnailDataURL || null,
      hasMap: !!campaign.mapImageBlob,
    });
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function deleteCampaign(id) {
  const t = await tx(["meta", "campaigns"], "readwrite");
  return new Promise((resolve, reject) => {
    t.objectStore("meta").delete(id);
    t.objectStore("campaigns").delete(id);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export function newCampaign(name) {
  const now = Date.now();
  return {
    id: uid(),
    name: name || "Nouvelle partie",
    createdAt: now,
    updatedAt: now,
    mapWidth: 0,
    mapHeight: 0,
    mapImageBlob: null,
    mapOriginalWidth: 0,
    mapOriginalHeight: 0,
    mapCappedByDevice: false,
    // fichier original conservé tel quel (si la carte a été réduite à l'import) pour permettre
    // le zoom haute résolution à la demande sur une petite zone — voir detail.js.
    originalImageBlob: null,
    fogWidth: 0,
    fogHeight: 0,
    fogScale: 0.5,
    fogBlob: null,
    symbols: [],
    labels: [],
    symbolUsage: {}, // { [typeKey]: nombre de fois posé } — sert à afficher les symboles les plus utilisés en premier
    regions: [],
    activeRegionId: null,
    scaleBar: {
      visible: true,
      realDistance: 10,
      unit: "km",
      position: "bottom-left",
    },
    view: { zoom: 1, panX: 0, panY: 0 },
  };
}
