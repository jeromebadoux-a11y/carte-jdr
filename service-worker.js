// service-worker.js — mise en cache complète de l'app pour un fonctionnement 100% hors ligne.
const CACHE_NAME = "rpgmap-cache-v5";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./style.css",
  "./db.js",
  "./fileio.js",
  "./state.js",
  "./fog.js",
  "./detail.js",
  "./mapview.js",
  "./mapload.js",
  "./symbols.js",
  "./labels.js",
  "./regions.js",
  "./scalebar.js",
  "./ui-common.js",
  "./ui-gm.js",
  "./ui-play.js",
  "./main.js",
  "./icon-192.png",
  "./icon-192-maskable.png",
  "./icon-512.png",
  "./icon-512-maskable.png",
  "./favicon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Stratégie "réseau d'abord, cache en secours" : quand la tablette a du réseau, l'app
// récupère toujours la dernière version publiée (et met le cache à jour au passage) —
// donc une mise à jour du site prend effet dès la prochaine ouverture avec connexion,
// sans dépendre d'un changement de ce fichier service-worker.js lui-même. Hors ligne,
// on retombe sur la dernière version mise en cache pour que l'app continue de fonctionner.
//
// Important : { cache: "no-store" } force le navigateur à ignorer complètement son propre
// cache HTTP (basé sur les en-têtes Cache-Control/ETag du serveur) et à vraiment recontacter
// le serveur à chaque requête. Sans ça, "réseau d'abord" pouvait en pratique être servi depuis
// ce cache HTTP interne du navigateur sans jamais recontacter le serveur, malgré l'intention —
// c'est ce qui provoquait des mises à jour invisibles tant qu'un nettoyage complet des données
// du site n'était pas fait manuellement.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // ne gère que les ressources de l'app elle-même

  event.respondWith(
    fetch(event.request, { cache: "no-store" })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
