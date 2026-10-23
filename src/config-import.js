import { appendAdvancedText } from "./model.js";

const supportedExtensions = new Set(["ngc", "ngr", "ngl"]);

export async function prepareConfigurationImport(files) {
  const contents = new Map();
  for (const file of files) {
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!supportedExtensions.has(extension)) {
      throw new Error(`${file.name} n’est pas un fichier NGC, NGR ou NGL.`);
    }
    const content = (await file.text()).replace(/^\uFEFF/, "");
    if (!content.trim()) throw new Error(`${file.name} est vide; aucun fichier n’a été importé.`);
    const previous = contents.get(extension);
    contents.set(extension, previous ? `${previous}\n${content}` : content);
  }
  if (!contents.size) throw new Error("Sélectionnez au moins un fichier NGC, NGR ou NGL.");
  return Object.fromEntries(contents);
}

export function mergeConfigurationImport(advanced, imported) {
  const merged = { ...advanced };
  for (const [extension, content] of Object.entries(imported)) {
    merged[extension] = appendAdvancedText(merged[extension] ?? "", content);
  }
  return merged;
}
