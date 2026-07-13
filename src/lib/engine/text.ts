/**
 * Label helpers shared by the layout engine and the SVG renderer.
 *
 * The golden rule from the skill: never shrink the font to make a label fit —
 * shorten the label instead. `truncateLabel` enforces the character cap;
 * `wrapText` breaks a label into lines that fit a box width at a fixed font
 * size (the SVG renderer needs explicit line breaks; draw.io wraps natively).
 */

/** Average glyph advance as a fraction of the font size (the default face runs wide). */
const GLYPH_WIDTH_FACTOR = 0.62;

export function estimateTextWidth(text: string, fontPt: number): number {
  return text.length * fontPt * GLYPH_WIDTH_FACTOR;
}

/** Trim a label to at most `maxChars`, breaking on a word boundary when close. */
export function truncateLabel(text: string, maxChars: number): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= maxChars) return t;
  const slice = t.slice(0, Math.max(1, maxChars - 1));
  const lastSpace = slice.lastIndexOf(" ");
  const base = lastSpace > maxChars * 0.6 ? slice.slice(0, lastSpace) : slice;
  return base.trimEnd() + "…";
}

/**
 * Greedy word-wrap into lines that each fit `maxWidthPx` at `fontPt`. A single
 * word longer than the box is kept on its own line (the box will clip it rather
 * than the font shrinking).
 */
export function wrapText(
  text: string,
  maxWidthPx: number,
  fontPt: number,
  maxLines = 4,
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const trial = current ? `${current} ${word}` : word;
    if (!current || estimateTextWidth(trial, fontPt) <= maxWidthPx) {
      current = trial;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = truncateLabel(
      `${kept[maxLines - 1]} ${lines.slice(maxLines).join(" ")}`,
      Math.floor(maxWidthPx / (fontPt * GLYPH_WIDTH_FACTOR)),
    );
    return kept;
  }
  return lines;
}
