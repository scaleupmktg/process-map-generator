import { z } from "zod";

/**
 * Zod schema for the skill bundle (PRD §7). Every opinionated value the app
 * needs — caps, colours, fonts, shape styles, label rules, and the extraction
 * prompt — is validated here on load, whether it comes from the committed
 * /skill copy or a remote SKILL_BUNDLE_URL override. A bundle that fails this
 * schema is rejected and the loader falls back to the bundled copy.
 */

const ColorTriple = z.object({
  fill: z.string(),
  text: z.string(),
  stroke: z.string(),
});

/** The diagram colours a renderer reads (one per selectable theme). */
const DiagramPalette = z.object({
  task: ColorTriple,
  decision: ColorTriple,
  startend: ColorTriple,
  document: ColorTriple,
  offpage: ColorTriple,
  subprocess: ColorTriple,
  laneHeader: ColorTriple,
  laneBody: ColorTriple,
  title: ColorTriple,
  legend: ColorTriple,
  footer: ColorTriple,
  edge: ColorTriple,
  canvas: ColorTriple,
});
export type PaletteColors = z.infer<typeof DiagramPalette>;

const ThemeSchema = z.object({ label: z.string(), palette: DiagramPalette });

const PageSize = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
});

export const ManifestSchema = z.object({
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, "version must be semver x.y.z"),
  schemaVersion: z.number().int().positive(),
  updated: z.string().min(1),
  changelog: z.array(z.string()),
});

export const ModelingSchema = z.object({
  caps: z.object({
    maxLanes: z.number().int().positive(),
    maxTasks: z.number().int().positive(),
    maxDecisions: z.number().int().nonnegative(),
    maxEndEvents: z.number().int().positive(),
    maxPhases: z.number().int().positive(),
    minInputChars: z.number().int().nonnegative(),
    maxInputChars: z.number().int().positive(),
  }),
  labels: z.object({
    maxLabelChars: z.number().int().positive(),
    maxLabelWords: z.number().int().positive(),
    maxDecisionChars: z.number().int().positive(),
  }),
  layout: z.object({
    gridColumns: z.number().int().positive(),
    snakeLayout: z.boolean(),
    pageOrientation: z.enum(["landscape", "portrait"]),
    showTitle: z.boolean(),
    showLegend: z.boolean(),
    showPhaseHeaders: z.boolean(),
    showStepIdPrefixes: z.boolean(),
    // When true, a phased model that overflows one page is split into an
    // overview page + one page per phase (multi-page .drawio).
    decomposePages: z.boolean(),
  }),
  type: z.object({
    fontFamily: z.string().min(1),
    minFontPt: z.number().positive(),
    titleFontPt: z.number().positive(),
    smallFontPt: z.number().positive(),
  }),
  geometry: z.object({
    colWidth: z.number().positive(),
    rowHeight: z.number().positive(),
    taskWidth: z.number().positive(),
    taskHeight: z.number().positive(),
    decisionWidth: z.number().positive(),
    decisionHeight: z.number().positive(),
    startEndWidth: z.number().positive(),
    startEndHeight: z.number().positive(),
    documentWidth: z.number().positive(),
    documentHeight: z.number().positive(),
    offpageWidth: z.number().positive(),
    offpageHeight: z.number().positive(),
    leftMargin: z.number().nonnegative(),
    laneHeaderBand: z.number().nonnegative(),
    colOffset: z.number().nonnegative(),
    rowTopPad: z.number().nonnegative(),
    laneHeightBase: z.number().nonnegative(),
    bannerHeight: z.number().nonnegative(),
    bannerGap: z.number().nonnegative(),
    phaseHeight: z.number().nonnegative(),
    gridSnap: z.number().positive(),
    pages: z.object({
      landscape: PageSize,
      portrait: PageSize,
    }),
  }),
});

export const StyleSchema = z.object({
  // Colours are the single source of truth for BOTH renderers (SVG + drawio).
  palette: z
    .object({
      task: ColorTriple,
      decision: ColorTriple,
      startend: ColorTriple,
      document: ColorTriple,
      offpage: ColorTriple,
      subprocess: ColorTriple,
      laneHeader: ColorTriple,
      tableHeader: ColorTriple,
      laneBody: ColorTriple,
      title: ColorTriple,
      legend: ColorTriple,
      footer: ColorTriple,
      edge: ColorTriple,
      canvas: ColorTriple,
    })
    .catchall(ColorTriple),
  // mxGraph structural style fragments per node kind (drawio only; colours are
  // composed in from the palette at render time).
  shapes: z.object({
    task: z.string(),
    decision: z.string(),
    startend: z.string(),
    document: z.string(),
    offpage: z.string(),
    subprocess: z.string(),
  }),
  laneStyle: z.string(),
  laneBodyStyle: z.string(),
  titleStyle: z.string(),
  legendStyle: z.string(),
  footerStyle: z.string(),
  edgeStyle: z.string(),
  roleLabels: z.object({
    task: z.string(),
    decision: z.string(),
    startend: z.string(),
    document: z.string(),
    offpage: z.string(),
    subprocess: z.string(),
  }),
  legendTitle: z.string(),
  branding: z.object({
    footer: z.string(),
    company: z.string(),
    site: z.string(),
  }),
  // Labels for multi-page decomposition.
  pages: z.object({
    overviewName: z.string(),
    overviewLane: z.string(),
    toPrefix: z.string(),
    fromPrefix: z.string(),
  }),
  // Selectable colour schemes for the diagram (preview + .drawio export). The
  // top-level `palette` above is the default/muted scheme and drives the Excel
  // register; these drive the diagram and the on-screen theme toggle.
  defaultTheme: z.string(),
  themes: z
    .object({ muted: ThemeSchema, corporate: ThemeSchema, bold: ThemeSchema })
    .catchall(ThemeSchema),
});

export const SkillBundleSchema = z.object({
  manifest: ManifestSchema,
  modeling: ModelingSchema,
  style: StyleSchema,
  extraction: z.string().min(1),
});

export type Manifest = z.infer<typeof ManifestSchema>;
export type Modeling = z.infer<typeof ModelingSchema>;
export type Style = z.infer<typeof StyleSchema>;
export type SkillBundle = z.infer<typeof SkillBundleSchema>;

/** The subset of the bundle safe to ship to the browser (no server prompt). */
export type ClientSkill = Pick<SkillBundle, "manifest" | "modeling" | "style">;

export function toClientSkill(skill: SkillBundle): ClientSkill {
  return { manifest: skill.manifest, modeling: skill.modeling, style: skill.style };
}

/** The node kinds the layout engine and renderers understand. */
export type NodeKind =
  | "task"
  | "decision"
  | "startend"
  | "document"
  | "offpage"
  | "subprocess";
