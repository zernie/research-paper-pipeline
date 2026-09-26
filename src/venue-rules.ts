/**
 * THE VENUE RULES — a built PDF judged against the format its venue's call for papers sets.
 *
 *   pdf/fresh      error  the facts describe the PDF on disk (not an earlier build)
 *   pdf/profile    error  the preset the paper extends resolves, and the kind it names exists
 *   pdf/fonts      error  every font is embedded, none is Type 3, the venue's families are present
 *   pdf/geometry   error  page size and column count match the preset
 *   pdf/limits     error  body and reference pages within the kind's limit; reference font size
 *   pdf/body-size  warn   body font size within the preset's tolerance
 *   pdf/measured   warn   the venue checks ran at all (a preset is named, facts exist, geometry measured)
 *
 * ── WHAT THEY READ ───────────────────────────────────────────────────────────────
 * Like `pdf/last-page-balance`, they run on a paper's `paper.tex` and judge the files beside it:
 * `paperlint.json` (which preset, which kind), `_build/paper.facts.json` (what `paperlint build`
 * measured) and the PDF the facts name (hashed, never measured). The preset is resolved by
 * `paperPreset` in `src/presets.ts` — the same resolution the build, the toolchain and the lint
 * config use — so there is one answer to "which venue is this paper judged against".
 *
 * The venue is taken from `paperlint.json`, not from the facts: the facts are venue-independent
 * measurements, and a paper whose `paperlint.json` changed after the build is judged against the venue
 * it names now.
 *
 * ── WHO SPEAKS WHEN THE INPUT CANNOT BE JUDGED ───────────────────────────────────
 * One rule per reason, and the others are silent — so a paper gets one finding that says what to
 * do, not six that say the same thing:
 *
 *   no paperlint.json       every rule silent (`paperlint new` writes one)
 *   extends null / absent   pdf/measured (warn) — no venue chosen yet; it names the file to set
 *   preset does not resolve pdf/profile (error) — a typo would otherwise switch every check off
 *   not built / no facts    pdf/measured (warn) — lint often runs before or without a build (the
 *                           CI action only lints); a warning is printed and does not fail
 *   facts about another PDF pdf/fresh (error) — judging them would judge an earlier build
 *   no geometry (no banal)  pdf/measured (warn); geometry, limits, body-size silent; fonts still judge
 *   kind does not resolve   pdf/profile (error); limits silent; everything else still judges
 */
import { dirname, isAbsolute, join, basename, relative } from "node:path";
import {
  FACTS_DIR,
  FACTS_FILE,
  factsPath,
  parseFactsText,
  type FontEntry,
  type ReadFacts,
} from "./facts-file.ts";
import type { KindLimits, VenueFormat } from "./tex-requirements.ts";
import { paperPreset, presetProblemText } from "./presets.ts";
import type { FlatGeometry } from "./domain/geometry.ts";
import type { AbsolutePath } from "./domain/paths.ts";
import { sha256Hex } from "./domain/sha256.ts";
import type { Files } from "./ports/files.ts";
import { CONFIG_FILE } from "../lib/paper-config.mjs";

// ── the verdict's vocabulary ─────────────────────────────────────────────────────────

/** One finding: the message it prints and the values it fills in. */
export interface Finding {
  readonly messageId: string;
  readonly data: Readonly<Record<string, string | number>>;
}

const finding = (
  messageId: string,
  data: Readonly<Record<string, string | number>> = {},
): Finding => ({ messageId, data });

/** A venue that resolved to a profile: its name, its format, and the kind's limits or why not. */
export interface Resolved {
  readonly venue: string;
  readonly format: VenueFormat;
  readonly kind: { readonly name: string; readonly limits: KindLimits } | null;
  /** Why the kind did not resolve — `pdf/profile` reports it — or null. */
  readonly kindProblem: Finding | null;
}

/** Everything the rules need to know about one paper, decided once. */
export type Assessment =
  | { readonly kind: "no-venue" }
  /** A `paperlint.json` that extends no preset yet — `pdf/measured` names the file to set. */
  | { readonly kind: "no-preset"; readonly file: string }
  | { readonly kind: "unresolved"; readonly finding: Finding }
  | { readonly kind: "unbuilt"; readonly venue: Resolved }
  | { readonly kind: "stale"; readonly finding: Finding }
  | {
      readonly kind: "ready";
      readonly venue: Resolved;
      readonly facts: ReadFacts;
    };

export interface VenueRuleDeps {
  readonly files: Files;
  /** The package's venues directory (`packageVenuesDir()`): the shipped presets and their schema. */
  readonly venuesDir: string;
}

const at = (p: string): AbsolutePath => p as AbsolutePath;
const text = (files: Files, p: string): string | null => {
  const b = files.readBytes(at(p));
  return b === null ? null : new TextDecoder().decode(b);
};

// ── resolving the declaration ────────────────────────────────────────────────────────

function kindOf(
  venue: string,
  format: VenueFormat,
  kind: string | null,
): Pick<Resolved, "kind" | "kindProblem"> {
  const known = [...format.kinds.keys()].join(", ") || "(none)";
  // A preset with no kinds (`acm-sigconf`, a family a paper for an unprofiled venue extends
  // directly) has no page limit to pick, so naming no kind is the only valid declaration. A kind
  // named against it is still `kindUnknown`, whose "its kinds: (none)" says why.
  if (kind === null && format.kinds.size === 0)
    return { kind: null, kindProblem: null };
  if (kind === null)
    return {
      kind: null,
      kindProblem: finding("kindMissing", { venue, known }),
    };
  const limits = format.kinds.get(kind);
  return limits
    ? { kind: { name: kind, limits }, kindProblem: null }
    : {
        kind: null,
        kindProblem: finding("kindUnknown", { venue, kind, known }),
      };
}

/** The facts about the PDF on disk, or the `pdf/fresh` finding that says why they are not. */
function freshFacts(
  files: Files,
  paperDir: string,
  body: string,
): ReadFacts | Finding {
  const parsed = parseFactsText(body);
  if (!parsed.ok)
    return parsed.error.kind === "schema"
      ? finding("schema", { got: parsed.error.got })
      : finding("factsBroken", { why: parsed.error.why });
  const f = parsed.value;
  const pdf = files.readBytes(
    at(isAbsolute(f.pdf) ? f.pdf : join(paperDir, f.pdf)),
  );
  if (pdf === null) return finding("pdfMissing", { pdf: f.pdf });
  return sha256Hex(pdf) === f.sha ? f : finding("stale", { pdf: f.pdf });
}

const isFinding = (v: object): v is Finding => "messageId" in v;

/** One paper, assessed. Reads through `deps.files` only; never throws on a paper's files. */
export function assessPaper(paperDir: string, deps: VenueRuleDeps): Assessment {
  const p = paperPreset(paperDir, deps);
  if (p.kind === "none")
    return p.settings === null
      ? { kind: "no-venue" }
      : { kind: "no-preset", file: join(paperDir, CONFIG_FILE) };
  if (p.kind === "settings-problem")
    return {
      kind: "unresolved",
      finding: finding("settingsBroken", { why: p.problem.why }),
    };
  if (p.kind === "preset-problem")
    return {
      kind: "unresolved",
      finding: finding("preset", { why: presetProblemText(p.problem) }),
    };
  const label = p.preset.label;
  const venue: Resolved = {
    venue: label,
    format: p.preset.format,
    ...kindOf(label, p.preset.format, p.settings.kind),
  };
  const factsText = text(deps.files, factsPath(paperDir));
  if (factsText === null) return { kind: "unbuilt", venue };
  const facts = freshFacts(deps.files, paperDir, factsText);
  return isFinding(facts)
    ? { kind: "stale", finding: facts }
    : { kind: "ready", venue, facts };
}

// ── the judges: typed facts + typed format → findings. Pure. ─────────────────────────

/** Type 3, not embedded, and each family the venue names missing from every font. */
export function judgeFonts(
  fonts: readonly FontEntry[],
  format: VenueFormat,
  venue: string,
): Finding[] {
  const out: Finding[] = [];
  for (const f of fonts) {
    if (f.program === "Type3") out.push(finding("type3", { name: f.name }));
    if (!f.embedded) out.push(finding("notEmbedded", { name: f.name }));
  }
  const names = [...new Set(fonts.map((f) => f.name))];
  const families: [string | null, string][] = [
    [format.fontsText, "body text"],
    [format.fontsTitle, "headings"],
  ];
  for (const [prefix, what] of families)
    if (prefix !== null && !names.some((n) => n.startsWith(prefix)))
      out.push(
        finding("noFamily", {
          prefix,
          what,
          venue,
          have: names.slice(0, 8).join(", ") || "(no fonts)",
        }),
      );
  return out;
}

/** Page width and height within `dimTol` inches, and the column count, against the preset. */
export function judgeGeometry(
  g: FlatGeometry,
  format: VenueFormat,
  venue: string,
  dimTol: number,
): Finding[] {
  const out: Finding[] = [];
  const dims: [number | null, number | null, string, string][] = [
    [format.pageWidthIn, g.page_w_in, "page width", "page_w_in"],
    [format.pageHeightIn, g.page_h_in, "page height", "page_h_in"],
  ];
  for (const [want, got, what, key] of dims) {
    if (want === null) continue;
    if (got === null) out.push(finding("dimMissing", { key, venue, want }));
    else if (Math.abs(got - want) > dimTol)
      out.push(finding("dim", { what, got, want, tol: dimTol, venue }));
  }
  if (
    format.columns !== null &&
    g.columns !== null &&
    g.columns !== format.columns
  )
    out.push(
      finding("columns", { got: g.columns, want: format.columns, venue }),
    );
  return out;
}

/**
 * Body and reference pages against the kind's limits, and the reference font size against the
 * profile's range. The range is about the DECLARED size and banal measures the rendered mode, so
 * it is widened by `body_pt_tol` — the drift the preset itself names — or a correct paper fails.
 */
export function judgeLimits(g: FlatGeometry, resolved: Resolved): Finding[] {
  return [...judgePages(g, resolved), ...judgeRefPt(g, resolved)];
}

function judgePages(g: FlatGeometry, resolved: Resolved): Finding[] {
  const kind = resolved.kind;
  if (kind === null) return [];
  const pages: [number | null, number, string][] = [
    [kind.limits.bodyPagesMax, g.body_pages, "body pages"],
    [kind.limits.refPagesMax, g.ref_pages, "reference pages"],
  ];
  return pages
    .filter(([max, got]) => max !== null && got > max)
    .map(([max, got, what]) =>
      finding("pages", {
        what,
        got,
        max: max ?? 0,
        venue: resolved.venue,
        kind: kind.name,
      }),
    );
}

function judgeRefPt(g: FlatGeometry, resolved: Resolved): Finding[] {
  const f = resolved.format;
  const slop = f.bodyPtTol ?? 0;
  if (f.refPtMin === null || f.refPtMax === null || g.ref_pt === null)
    return [];
  return g.ref_pt < f.refPtMin - slop || g.ref_pt > f.refPtMax + slop
    ? [
        finding("refPt", {
          got: g.ref_pt,
          min: f.refPtMin,
          max: f.refPtMax,
          slop,
          venue: resolved.venue,
        }),
      ]
    : [];
}

/** The body font size against `body_pt ± body_pt_tol`. */
export function judgeBodySize(
  g: FlatGeometry,
  format: VenueFormat,
  venue: string,
): Finding[] {
  const want = format.bodyPt;
  const tol = format.bodyPtTol;
  if (want === null || tol === null) return [];
  if (g.body_pt === null) return [finding("bodyMissing")];
  return Math.abs(g.body_pt - want) > tol
    ? [finding("body", { got: g.body_pt, want, tol, venue })]
    : [];
}

// ── the ESLint rules ────────────────────────────────────────────────────────────────

/** The slice of ESLint's rule context these rules use. */
export interface VenueRuleContext {
  readonly filename: string;
  /** ESLint's working directory; file names in messages are shown relative to it. */
  readonly cwd?: string;
  readonly sourceCode: { readonly text: string };
  readonly options: readonly unknown[];
  report(d: {
    readonly loc: {
      readonly start: { line: number; column: number };
      readonly end: { line: number; column: number };
    };
    readonly messageId: string;
    readonly data?: Readonly<Record<string, string | number>>;
  }): void;
}

export interface VenueRuleModule {
  readonly meta: {
    readonly type: "problem" | "suggestion";
    readonly docs: { readonly description: string };
    readonly schema: readonly object[];
    readonly messages: Readonly<Record<string, string>>;
  };
  create(context: VenueRuleContext): { root?: () => void };
}

/** What a judge may take from its rule context: the rule's options and how to show a path. */
interface JudgeContext {
  readonly options: readonly unknown[];
  readonly shown: (path: string) => string;
}
type Judge = (a: Assessment, ctx: JudgeContext) => Finding[];

const REBUILD = "rebuild the paper (`paperlint build`) to rewrite it";

/** Which rule reports what: each takes the assessment and returns its own findings. */
const JUDGES: Readonly<Record<VenueRuleName, Judge>> = {
  profile: (a) =>
    a.kind === "unresolved"
      ? [a.finding]
      : a.kind === "ready" && a.venue.kindProblem
        ? [a.venue.kindProblem]
        : a.kind === "unbuilt" && a.venue.kindProblem
          ? [a.venue.kindProblem]
          : [],
  fresh: (a) => (a.kind === "stale" ? [a.finding] : []),
  measured: (a, { shown }) =>
    a.kind === "no-preset"
      ? [finding("noPreset", { file: shown(a.file) })]
      : a.kind === "unbuilt"
        ? [
            finding("unbuilt", {
              file: `${FACTS_DIR}/${FACTS_FILE}`,
              venue: a.venue.venue,
            }),
          ]
        : a.kind === "ready" && a.facts.geometry === null
          ? [finding("noGeometry")]
          : [],
  fonts: (a) =>
    a.kind === "ready"
      ? judgeFonts(a.facts.fonts, a.venue.format, a.venue.venue)
      : [],
  geometry: (a, { options }) =>
    a.kind === "ready" && a.facts.geometry
      ? judgeGeometry(
          a.facts.geometry,
          a.venue.format,
          a.venue.venue,
          (options[0] as { dimTol?: number } | undefined)?.dimTol ??
            DEFAULT_DIM_TOL_IN,
        )
      : [],
  limits: (a) =>
    a.kind === "ready" && a.facts.geometry
      ? judgeLimits(a.facts.geometry, a.venue)
      : [],
  "body-size": (a) =>
    a.kind === "ready" && a.facts.geometry
      ? judgeBodySize(a.facts.geometry, a.venue.format, a.venue.venue)
      : [],
};

/** How far, in inches, a measured page dimension may be from the preset's. */
export const DEFAULT_DIM_TOL_IN = 0.05;

type Meta = Pick<VenueRuleModule["meta"], "docs" | "messages"> & {
  readonly type?: "suggestion";
  readonly schema?: readonly object[];
};

const META: Readonly<Record<VenueRuleName, Meta>> = {
  fresh: {
    docs: {
      description:
        "the build facts describe the PDF on disk, not an earlier build",
    },
    messages: {
      factsBroken: `_build/paper.facts.json cannot be read: {{why}} — ${REBUILD}`,
      schema: `_build/paper.facts.json has schema {{got}}; the venue rules read schema 2 — ${REBUILD}`,
      pdfMissing:
        "_build/paper.facts.json describes {{pdf}}, which is not on disk (a failed build removes it) — rebuild the paper",
      stale:
        "_build/paper.facts.json describes a DIFFERENT {{pdf}} than the one on disk (its SHA-256 differs), so the venue checks would judge an earlier build — rebuild the paper",
    },
  },
  profile: {
    docs: {
      description:
        "the venue preset a paper's paperlint.json extends resolves, and the kind it names exists",
    },
    messages: {
      settingsBroken: `${CONFIG_FILE} cannot be read: {{why}}`,
      preset:
        "{{why}} — so this paper's page limit, fonts and format are not checked. Fix `extends` in its paperlint.json, or turn pdf/profile off for this paper",
      kindMissing: `${CONFIG_FILE} names no \`kind\`, so the page limit of \`{{venue}}\` is not checked; its kinds: {{known}}`,
      kindUnknown:
        "`{{venue}}` has no kind `{{kind}}`, so the page limit is not checked; its kinds: {{known}}",
    },
  },
  measured: {
    type: "suggestion",
    docs: {
      description:
        "the venue checks ran: the paper names a venue preset, and it was built and measured",
    },
    messages: {
      unbuilt:
        "not built yet, so `{{venue}}`'s page limit, fonts and format are not checked — run `paperlint build`",
      noPreset:
        'this paper names no venue preset yet, so its page limit, fonts and format are not checked — set "extends" in {{file}} (e.g. "paperlint:agenticdev"; see docs/rules.md)',
      noGeometry:
        "the build measured no page geometry (banal was not found or failed), so page size, columns, page limits and font sizes were NOT checked — run `paperlint toolchain`, then `paperlint build`",
    },
  },
  fonts: {
    docs: {
      description:
        "every font is embedded and none is Type 3, and the venue's font families are present",
    },
    messages: {
      type3:
        "the font {{name}} is Type 3 (a bitmap or procedure font); ACM and ACL reject such a PDF",
      notEmbedded:
        "the font {{name}} is not embedded, so the reader's viewer substitutes another",
      noFamily:
        "no font starts with `{{prefix}}` ({{what}} of {{venue}}); the PDF has: {{have}}. Usually a font package is missing and the class silently fell back to Computer Modern — run `paperlint toolchain`",
    },
  },
  geometry: {
    schema: [
      {
        type: "object",
        properties: { dimTol: { type: "number", minimum: 0 } },
        additionalProperties: false,
      },
    ],
    docs: {
      description: "page size and column count match the venue's profile",
    },
    messages: {
      dim: "{{what}} is {{got}} in, {{venue}} requires {{want}} in (tolerance {{tol}}) — the template sets the wrong paper size",
      dimMissing:
        "{{venue}} sets `{{key}}` = {{want}}, and the build did not measure it — rebuild the paper",
      columns:
        "{{got}} column(s), {{venue}} requires {{want}} — the wrong document class or class option",
    },
  },
  limits: {
    docs: {
      description:
        "body and reference pages within the limit of the paper's kind; reference font size in range",
    },
    messages: {
      pages:
        "{{what}}: {{got}}, over the limit {{max}} for {{venue}}/{{kind}} — a desk reject; cut the text",
      refPt:
        "the reference font size is {{got}} pt, outside {{min}}–{{max}} pt for {{venue}} (allowing ±{{slop}} pt for the measuring drift) — fix the bibliography's font size",
    },
  },
  "body-size": {
    type: "suggestion",
    docs: {
      description:
        "body font size within the venue preset's tolerance (a measured mode, so a warning)",
    },
    messages: {
      body: "the body font size measures {{got}} pt against {{want}} ± {{tol}} pt for {{venue}}. The measurement is the mode of the rendered text, not the declared size — check \\documentclass and its options",
      bodyMissing:
        "the build did not measure a body font size — rebuild the paper",
    },
  },
};

export type VenueRuleName =
  | "fresh"
  | "profile"
  | "measured"
  | "fonts"
  | "geometry"
  | "limits"
  | "body-size";

/**
 * The level each venue rule is on at in paperlint's own config, for every `paper.tex`. One owner:
 * the config reads it, the docs describe it, a consumer overrides it in `rules`.
 */
export const VENUE_RULE_LEVELS: Readonly<
  Record<`pdf/${VenueRuleName}`, "error" | "warn">
> = {
  "pdf/fresh": "error",
  "pdf/profile": "error",
  "pdf/fonts": "error",
  "pdf/geometry": "error",
  "pdf/limits": "error",
  "pdf/body-size": "warn",
  "pdf/measured": "warn",
};

/** The line of `\documentclass`, where the class and its options — most of the fixes — live. */
function reportLine(source: string): number {
  const i = source
    .split("\n")
    .findIndex((l) => l.trimStart().startsWith("\\documentclass"));
  return i >= 0 ? i + 1 : 1;
}

function rule(name: VenueRuleName, deps: VenueRuleDeps): VenueRuleModule {
  const meta = META[name];
  return {
    meta: {
      type: meta.type ?? "problem",
      docs: meta.docs,
      schema: meta.schema ?? [],
      messages: meta.messages,
    },
    create(context) {
      // Judged once per paper, on its paper.tex: the paper directory is the file's directory.
      if (basename(context.filename) !== "paper.tex") return {};
      return {
        root() {
          const a = assessPaper(dirname(context.filename), deps);
          const line = reportLine(context.sourceCode.text);
          const loc = {
            start: { line, column: 1 },
            end: { line, column: 2 },
          };
          const cwd = context.cwd;
          const shown = (p: string) => (cwd ? relative(cwd, p) || p : p);
          for (const f of JUDGES[name](a, { options: context.options, shown }))
            context.report({ loc, messageId: f.messageId, data: f.data });
        },
      };
    },
  };
}

/** The venue rules, as the rules of the `pdf` plugin (beside `last-page-balance`). */
export function venueRules(
  deps: VenueRuleDeps,
): Record<VenueRuleName, VenueRuleModule> {
  const names = Object.keys(META) as VenueRuleName[];
  return Object.fromEntries(names.map((n) => [n, rule(n, deps)])) as Record<
    VenueRuleName,
    VenueRuleModule
  >;
}
