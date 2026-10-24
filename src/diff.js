export function createGenerationDiff(previous, next) {
  const names = [...new Set([...Object.keys(previous), ...Object.keys(next)])].sort();
  const output = [];
  for (const name of names) {
    const oldContent = previous[name];
    const newContent = next[name];
    if (oldContent === newContent) continue;
    output.push(`diff -- ${name}`);
    if (oldContent == null) output.push('--- /dev/null');
    else output.push(`--- previous/${name}`);
    if (newContent == null) output.push('+++ /dev/null');
    else output.push(`+++ generated/${name}`);
    const oldLines = oldContent?.split(/\r?\n/) ?? [];
    const newLines = newContent?.split(/\r?\n/) ?? [];
    if (oldLines.length * newLines.length > 1_000_000) {
      output.push(
        `! Diff omis (${oldLines.length} lignes avant, ${newLines.length} après ; aperçu intégral disponible).`
      );
      continue;
    }
    const width = newLines.length + 1;
    const lcs = new Uint32Array((oldLines.length + 1) * width);
    for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex--) {
      for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex--) {
        const index = oldIndex * width + newIndex;
        lcs[index] =
          oldLines[oldIndex] === newLines[newIndex]
            ? lcs[(oldIndex + 1) * width + newIndex + 1] + 1
            : Math.max(
                lcs[(oldIndex + 1) * width + newIndex],
                lcs[oldIndex * width + newIndex + 1]
              );
      }
    }
    let oldIndex = 0;
    let newIndex = 0;
    while (oldIndex < oldLines.length || newIndex < newLines.length) {
      if (
        oldIndex < oldLines.length &&
        newIndex < newLines.length &&
        oldLines[oldIndex] === newLines[newIndex]
      ) {
        output.push(` ${oldLines[oldIndex++]}`);
        newIndex++;
      } else if (
        oldIndex < oldLines.length &&
        (newIndex >= newLines.length ||
          lcs[(oldIndex + 1) * width + newIndex] >= lcs[oldIndex * width + newIndex + 1])
      ) {
        output.push(`-${oldLines[oldIndex++]}`);
      } else {
        output.push(`+${newLines[newIndex++]}`);
      }
    }
  }
  return output.join('\n') || 'Aucune différence avec la génération précédente.';
}
