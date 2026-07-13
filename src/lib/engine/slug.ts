/** Slugify a process name for output filenames (PRD §8). */
export function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")// strip combining diacritical marks U+0300–U+036F
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "process";
}

export function outputFilenames(processName: string): {
  drawio: string;
  xlsx: string;
} {
  const slug = slugify(processName);
  return {
    drawio: `${slug}-process-map.drawio`,
    xlsx: `${slug}-process-register.xlsx`,
  };
}
