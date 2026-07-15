import type { ClientSkill, NodeKind, PaletteColors } from "@/lib/skill/schema";

/** Resolve the diagram palette for a theme, defaulting to the bundle's default. */
export function paletteFor(style: ClientSkill["style"], theme?: string): PaletteColors {
  const chosen = style.themes[theme ?? style.defaultTheme];
  return chosen ? chosen.palette : style.palette;
}

/** XML/SVG-safe escaping for attribute and text content. */
export function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Round to 3 decimals and drop trailing zeros — keeps golden files tidy. */
export function num(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

export function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Compose the full mxGraph style string for a node kind from the skill bundle. */
export function drawioNodeStyle(kind: NodeKind, skill: ClientSkill, theme?: string): string {
  const { style, modeling } = skill;
  const c = paletteFor(style, theme)[kind];
  const t = modeling.type;
  return (
    `${style.shapes[kind]}` +
    `fillColor=${c.fill};fontColor=${c.text};strokeColor=${c.stroke};` +
    `fontFamily=${t.fontFamily};fontSize=${t.minFontPt};`
  );
}
