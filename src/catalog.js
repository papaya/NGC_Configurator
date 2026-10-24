export async function loadCatalog() {
  const response = await fetch('./data/modules.json');
  if (!response.ok) throw new Error(`Impossible de charger la bibliothèque (${response.status}).`);
  return response.json();
}
