// fileio.js — export / import d'une partie sous forme de vrai fichier (.rpgmap.json)
// Utilise le téléchargement classique (fonctionne partout, y compris Android Chrome).
// Le fichier contient toutes les données de la partie, images incluses (en base64).

function blobToDataURL(blob) {
  if (!blob) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

async function dataURLToBlob(dataURL) {
  if (!dataURL) return null;
  const res = await fetch(dataURL);
  return await res.blob();
}

export async function exportCampaignToFile(campaign) {
  const exportable = {
    ...campaign,
    mapImageBlob: undefined,
    fogBlob: undefined,
    mapImageDataURL: await blobToDataURL(campaign.mapImageBlob),
    fogDataURL: await blobToDataURL(campaign.fogBlob),
    _fileFormat: "rpgmap-v1",
  };
  delete exportable.mapImageBlob;
  delete exportable.fogBlob;

  const json = JSON.stringify(exportable);
  const blob = new Blob([json], { type: "application/json" });
  const filename = `${(campaign.name || "partie").replace(/[^a-z0-9_\-]+/gi, "_")}.rpgmap.json`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return filename;
}

export async function importCampaignFromFile(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  if (data._fileFormat !== "rpgmap-v1") {
    throw new Error("Ce fichier ne semble pas être une sauvegarde de carte JdR valide.");
  }
  data.mapImageBlob = await dataURLToBlob(data.mapImageDataURL);
  data.fogBlob = await dataURLToBlob(data.fogDataURL);
  delete data.mapImageDataURL;
  delete data.fogDataURL;
  delete data._fileFormat;
  return data;
}
