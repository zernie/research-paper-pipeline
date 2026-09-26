/**
 * The venue rules (`pdf/fresh` · `pdf/profile` · `pdf/fonts` · `pdf/geometry` · `pdf/limits` ·
 * `pdf/body-size` · `pdf/measured`) over a paper held in memory: `paper.tex`, `paperlint.json`,
 * `_build/paper.facts.json` and the PDF the facts describe. The venue profiles are the SHIPPED
 * ones, read from the package's venues directory, so a profile edit that breaks a check shows here.
 *
 * Every case has both halves in one table: the finding a planted defect must produce, and — in the
 * first rows — the silence a conforming paper must produce.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { memoryFiles } from "./adapters/memory/index.ts";
import { sha256Hex } from "./domain/sha256.ts";
import { packageVenuesDir } from "../skills/paper-pipeline/scripts/consumer.mjs";
import {
  VENUE_RULE_LEVELS,
  venueRules,
  type VenueRuleModule,
} from "./venue-rules.ts";
import { buildConfig, OPTIONAL_RULES, SHIPPED_RULES } from "./cli.ts";

const VENUES = packageVenuesDir();
const PAPER = "/work/papers/p";
const PDF_BYTES = new TextEncoder().encode(
  "%PDF-1.5 a stand-in for the built PDF",
);

/** Every shipped profile and the schema, at their real paths, so the rules read them through Files. */
const shipped = Object.fromEntries(
  readdirSync(VENUES)
    .filter((f) => f.endsWith(".jsonc") || f.endsWith(".json"))
    .map((f) => [join(VENUES, f), readFileSync(join(VENUES, f))]),
);

type Json = Record<string, unknown>;

/** The facts of a short agenticdev paper that meets every number in its profile. */
function goodFacts(): Json {
  return {
    schema: 2,
    pdf: "paper.pdf",
    pdf_sha256: sha256Hex(PDF_BYTES),
    venue: "agenticdev",
    kind: "short",
    npages: 7,
    fonts_source: "pdfjs-drawn",
    fonts: [
      {
        name: "LinLibertineT",
        type: "Type 1",
        embedded: true,
        program: "Type1",
      },
      {
        name: "LinBiolinumTB",
        type: "Type 1",
        embedded: true,
        program: "Type1",
      },
    ],
    last_page: { kind: "stub", words: 12 },
    last_page_cols_pt: null,
    geometry_source: "banal",
    page_w_in: 8.5,
    page_h_in: 11,
    columns: 2,
    body_pt: 9.3,
    ref_pt: 7.3,
    body_pages: 5,
    ref_pages: 2,
    appendix_pages: 0,
    pages_by_type: { body: 5, bib: 2 },
  };
}

const TEX =
  "% a comment\n\\documentclass[sigconf]{acmart}\n\\begin{document}x\\end{document}\n";

interface Paper {
  readonly venue?: unknown; // the paperlint.json object, or a raw string, or absent
  readonly facts?: Json | string | null; // null: no facts file
  readonly pdf?: Uint8Array | null; // null: no PDF on disk
  readonly extra?: Readonly<Record<string, string>>;
}

interface Finding {
  readonly rule: string;
  readonly messageId: string;
  readonly message: string;
  readonly line: number;
}

const text = (v: unknown): string =>
  typeof v === "string" ? v : JSON.stringify(v);

/** The paper's files, as `Paper` describes them; an absent entry is an absent file. */
function paperFiles(p: Paper): Record<string, string | Uint8Array> {
  const out: Record<string, string | Uint8Array> = {
    ...shipped,
    [`${PAPER}/paper.tex`]: TEX,
    ...p.extra,
  };
  if (p.venue !== undefined) out[`${PAPER}/paperlint.json`] = text(p.venue);
  if (p.facts !== null)
    out[`${PAPER}/_build/paper.facts.json`] = text(p.facts ?? goodFacts());
  if (p.pdf !== null) out[`${PAPER}/paper.pdf`] = p.pdf ?? PDF_BYTES;
  return out;
}

/** Run every venue rule over one paper, the way ESLint would: `create` on paper.tex, then `root`. */
function lint(
  p: Paper,
  filename = `${PAPER}/paper.tex`,
  options: Json = {},
): Finding[] {
  const files = memoryFiles(paperFiles(p));
  const rules = venueRules({ files, venuesDir: VENUES });
  const out: Finding[] = [];
  for (const [name, rule] of Object.entries(rules) as [
    string,
    VenueRuleModule,
  ][]) {
    const visitor = rule.create({
      filename,
      sourceCode: { text: TEX },
      options:
        name === "geometry" && Object.keys(options).length ? [options] : [],
      report: (d) =>
        out.push({
          rule: `pdf/${name}`,
          messageId: d.messageId,
          message: Object.entries(d.data ?? {}).reduce(
            (m, [k, v]) => m.replaceAll(`{{${k}}}`, String(v)),
            rule.meta.messages[d.messageId] ?? `(no message ${d.messageId})`,
          ),
          line: d.loc.start.line,
        }),
    });
    visitor.root?.();
  }
  return out;
}

const DECL = { extends: "paperlint:agenticdev", kind: "short" };
const ids = (fs: readonly Finding[]) =>
  fs.map((f) => `${f.rule}:${f.messageId}`).sort();
const withFacts = (patch: (f: Json) => void): Json => {
  const f = goodFacts();
  patch(f);
  return f;
};

describe("a paper that meets its venue", () => {
  it("is silent — every rule, on the shipped agenticdev profile", () => {
    expect(lint({ venue: DECL })).toEqual([]);
  });

  it("is silent on aisec, a second shipped ACM profile", () => {
    expect(
      lint({ venue: { extends: "paperlint:aisec", kind: "research" } }),
    ).toEqual([]);
  });

  it("takes the venue from paperlint.json, not from the facts: facts measured with no venue still judge", () => {
    expect(
      lint({
        venue: DECL,
        facts: withFacts((f) => ((f.venue = null), (f.kind = null))),
      }),
    ).toEqual([]);
  });
});

describe("a paper that names no venue", () => {
  it("no paperlint.json: every rule is silent, even with no facts and no PDF", () => {
    expect(lint({ venue: undefined, facts: null, pdf: null })).toEqual([]);
  });

  it.each([
    ["no extends", { kind: "short" }],
    ["extends: null — what `paperlint new` writes", { extends: null }],
  ])(
    "a paperlint.json with %s: ONE warning from pdf/measured, whatever else is missing",
    (_, venue) => {
      const fs = lint({ venue, facts: null, pdf: null });
      expect(ids(fs)).toEqual(["pdf/measured:noPreset"]);
      expect(fs[0]?.message).toMatch(/set "extends" in .*paperlint\.json/);
    },
  );

  it("acts on paper.tex only — any other file gets nothing", () => {
    expect(
      lint({ venue: DECL, facts: null }, `${PAPER}/PIPELINE-STATUS.md`),
    ).toEqual([]);
  });
});

describe("pdf/profile — the declaration must resolve, or nothing is judged", () => {
  it.each([
    [
      "an unknown venue (a typo would silently disable every check)",
      { extends: "paperlint:agentic-dev", kind: "short" },
      "preset",
      /agenticdev, aisec, realm/,
    ],
    [
      "the base TeX set is not a venue",
      { extends: "paperlint:tex-base" },
      "preset",
      /agenticdev, aisec, realm/,
    ],
    [
      "paperlint.json that is not JSON",
      "{ extends: agenticdev",
      "settingsBroken",
      /paperlint\.json/,
    ],
    [
      "paperlint.json with a misspelt key",
      { venu: "agenticdev" },
      "settingsBroken",
      /unknown key "venu"/,
    ],
  ])("%s", (_, venue, messageId, text) => {
    const fs = lint({ venue, facts: null, pdf: null });
    expect(ids(fs)).toEqual([`pdf/profile:${messageId}`]);
    expect(fs[0]?.message).toMatch(text);
  });

  it("a profile that does not parse is named with the file", () => {
    const fs = lint({
      venue: { extends: "paperlint:mine", kind: "short" },
      extra: {
        [join(VENUES, "mine.jsonc")]:
          '{ "tex": { "packages": {} }, "columns": "two" }',
      },
    });
    expect(ids(fs)).toEqual(["pdf/profile:preset"]);
    expect(fs[0]?.message).toMatch(/mine\.jsonc/);
  });
});

describe("pdf/profile — the kind", () => {
  it.each([
    ["no kind", { extends: "paperlint:agenticdev" }, "kindMissing"],
    [
      "a kind the venue does not have",
      { extends: "paperlint:agenticdev", kind: "long" },
      "kindUnknown",
    ],
  ])(
    "%s: the page limit is not checked — and the rest still is",
    (_, venue, messageId) => {
      const fs = lint({ venue, facts: withFacts((f) => (f.body_pages = 99)) });
      expect(ids(fs)).toEqual([`pdf/profile:${messageId}`]);
      expect(fs[0]?.message).toMatch(/short, full, demo/);
      // the fonts rule still runs with an unresolved kind
      const fonts = lint({
        venue,
        facts: withFacts((f) => ((f.fonts as Json[])[0]!.embedded = false)),
      });
      expect(ids(fonts)).toEqual([
        `pdf/fonts:notEmbedded`,
        `pdf/profile:${messageId}`,
      ]);
    },
  );

  it("a kind with no limits in the profile (realm's `long`) is not a finding", () => {
    const realm = withFacts((f) => {
      f.page_w_in = 8.27;
      f.page_h_in = 11.69;
      f.body_pt = 11;
      f.ref_pt = 10;
      f.body_pages = 30;
      f.fonts = [
        {
          name: "NimbusRomNo9L-Regu",
          type: "Type 1",
          embedded: true,
          program: "Type1",
        },
      ];
    });
    expect(
      lint({
        venue: { extends: "paperlint:realm", kind: "long" },
        facts: realm,
      }),
    ).toEqual([]);
  });
});

describe("pdf/profile — a preset with no kinds", () => {
  it("🔴 a preset with NO kinds (acm-sigconf) and no `kind`: nothing to pick, no finding", () => {
    const fs = lint({
      venue: { extends: "paperlint:acm-sigconf" },
      facts: withFacts((f) => (f.body_pages = 99)),
    });
    expect(ids(fs).filter((id) => id.startsWith("pdf/profile"))).toEqual([]);
  });

  it("…but a `kind` named against a kindless preset is still an error that says it has none", () => {
    const fs = lint({
      venue: { extends: "paperlint:acm-sigconf", kind: "short" },
    });
    const profile = fs.filter((f) => f.rule === "pdf/profile");
    expect(ids(profile)).toEqual(["pdf/profile:kindUnknown"]);
    expect(profile[0]?.message).toMatch(/its kinds: \(none\)/);
  });
});

describe("pdf/measured — a paper that names a venue and was not measured says so (warn)", () => {
  it("no facts file: one finding, from pdf/measured only", () => {
    const fs = lint({ venue: DECL, facts: null, pdf: null });
    expect(ids(fs)).toEqual(["pdf/measured:unbuilt"]);
    expect(fs[0]?.message).toMatch(/paperlint build/);
    // Guards: the message stays one short line — it is the first thing a new user sees.
    expect(fs[0]?.message).toMatch(/^not built yet, so /);
    expect(fs[0]?.message.length).toBeLessThan(110);
  });

  it("facts without geometry (no banal): pdf/measured names it, the three geometry rules are silent, fonts still judge", () => {
    const g = withFacts((f) => {
      f.geometry_source = null;
      for (const k of [
        "page_w_in",
        "page_h_in",
        "columns",
        "body_pt",
        "ref_pt",
        "body_pages",
        "ref_pages",
        "appendix_pages",
        "pages_by_type",
      ])
        f[k] = null;
      (f.fonts as Json[])[0]!.program = "Type3";
    });
    expect(ids(lint({ venue: DECL, facts: g }))).toEqual([
      "pdf/fonts:type3",
      "pdf/measured:noGeometry",
    ]);
  });
});

describe("pdf/fresh — facts about another build are not judged", () => {
  it.each([
    [
      "a changed PDF",
      { pdf: new TextEncoder().encode("another build") },
      "stale",
    ],
    ["a PDF that is gone", { pdf: null }, "pdfMissing"],
    ["a foreign schema", { facts: withFacts((f) => (f.schema = 1)) }, "schema"],
    ["facts that are not JSON", { facts: "{" }, "factsBroken"],
    [
      "facts missing pdf_sha256",
      { facts: withFacts((f) => delete f.pdf_sha256) },
      "factsBroken",
    ],
    [
      "a font entry of the wrong shape",
      { facts: withFacts((f) => (f.fonts = [{ name: 3 }])) },
      "factsBroken",
    ],
  ] as [string, Paper, string][])(
    "%s: one finding, from pdf/fresh only",
    (_, p, messageId) => {
      // Everything else planted wrong too — none of it may be reported over stale facts.
      const facts =
        p.facts ?? withFacts((f) => ((f.body_pages = 99), (f.columns = 1)));
      expect(ids(lint({ venue: DECL, ...p, facts }))).toEqual([
        `pdf/fresh:${messageId}`,
      ]);
    },
  );
});

describe("pdf/fonts", () => {
  it.each([
    [
      "a Type 3 font",
      (f: Json) => ((f.fonts as Json[])[0]!.program = "Type3"),
      ["pdf/fonts:type3"],
    ],
    [
      "a font not embedded",
      (f: Json) => ((f.fonts as Json[])[1]!.embedded = false),
      ["pdf/fonts:notEmbedded"],
    ],
    [
      "the text family missing — acmart fell back to Computer Modern",
      (f: Json) => ((f.fonts as Json[])[0]!.name = "CMR10"),
      ["pdf/fonts:noFamily"],
    ],
    [
      "both families missing: one finding per family",
      (f: Json) =>
        (f.fonts = [
          { name: "CMR10", type: "Type 1", embedded: true, program: "Type1" },
        ]),
      ["pdf/fonts:noFamily", "pdf/fonts:noFamily"],
    ],
  ] as [string, (f: Json) => void, string[]][])("%s", (_, patch, want) => {
    expect(ids(lint({ venue: DECL, facts: withFacts(patch) }))).toEqual(want);
  });

  it("names the family and the fonts the PDF does have", () => {
    const [f] = lint({
      venue: DECL,
      facts: withFacts((x) => ((x.fonts as Json[])[0]!.name = "CMR10")),
    });
    expect(f?.message).toMatch(/LinLibertine/);
    expect(f?.message).toMatch(/CMR10/);
  });
});

describe("pdf/geometry", () => {
  it.each([
    [
      "A4 instead of letter",
      (f: Json) => ((f.page_w_in = 8.27), (f.page_h_in = 11.69)),
      ["pdf/geometry:dim", "pdf/geometry:dim"],
    ],
    [
      "one column instead of two",
      (f: Json) => (f.columns = 1),
      ["pdf/geometry:columns"],
    ],
    [
      "a page size banal could not read",
      (f: Json) => (f.page_w_in = null),
      ["pdf/geometry:dimMissing"],
    ],
    [
      "0.03 in off is inside the default tolerance",
      (f: Json) => (f.page_w_in = 8.53),
      [],
    ],
  ] as [string, (f: Json) => void, string[]][])("%s", (_, patch, want) => {
    expect(ids(lint({ venue: DECL, facts: withFacts(patch) }))).toEqual(want);
  });

  it("dimTol widens the tolerance", () => {
    const facts = withFacts((f) => (f.page_w_in = 8.6));
    expect(ids(lint({ venue: DECL, facts }))).toEqual(["pdf/geometry:dim"]);
    expect(
      lint({ venue: DECL, facts }, `${PAPER}/paper.tex`, { dimTol: 0.2 }),
    ).toEqual([]);
  });
});

describe("pdf/limits", () => {
  it.each([
    [
      "one body page over the short-paper limit",
      (f: Json) => (f.body_pages = 6),
      ["pdf/limits:pages"],
      /body pages: 6, over the limit 5 for agenticdev\/short/,
    ],
    [
      "one reference page over",
      (f: Json) => (f.ref_pages = 3),
      ["pdf/limits:pages"],
      /reference pages: 3, over the limit 2/,
    ],
    ["exactly at the limit", (f: Json) => (f.body_pages = 5), [], null],
    [
      "a reference font below the range",
      (f: Json) => (f.ref_pt = 6),
      ["pdf/limits:refPt"],
      /6 pt/,
    ],
    [
      "6.8 pt is inside the range once the measuring drift (body_pt_tol) is allowed",
      (f: Json) => (f.ref_pt = 6.8),
      [],
      null,
    ],
    [
      "no reference font measured (no bibliography) is not a finding",
      (f: Json) => (f.ref_pt = null),
      [],
      null,
    ],
  ] as [string, (f: Json) => void, string[], RegExp | null][])(
    "%s",
    (_, patch, want, text) => {
      const fs = lint({ venue: DECL, facts: withFacts(patch) });
      expect(ids(fs)).toEqual(want);
      if (text) expect(fs[0]?.message).toMatch(text);
    },
  );

  it("a longer kind of the same venue passes the same page count", () => {
    const facts = withFacts((f) => (f.body_pages = 9));
    expect(ids(lint({ venue: DECL, facts }))).toEqual(["pdf/limits:pages"]);
    expect(
      lint({ venue: { extends: "paperlint:agenticdev", kind: "full" }, facts }),
    ).toEqual([]);
  });
});

describe("pdf/body-size", () => {
  it.each([
    [
      "10.2 pt against 9 ± 0.5",
      (f: Json) => (f.body_pt = 10.2),
      ["pdf/body-size:body"],
    ],
    ["9.4 pt is inside the tolerance", (f: Json) => (f.body_pt = 9.4), []],
    [
      "no body size measured",
      (f: Json) => (f.body_pt = null),
      ["pdf/body-size:bodyMissing"],
    ],
  ] as [string, (f: Json) => void, string[]][])("%s", (_, patch, want) => {
    expect(ids(lint({ venue: DECL, facts: withFacts(patch) }))).toEqual(want);
  });
});

describe("where a finding points", () => {
  it("at the \\documentclass line, where the class and its options live", () => {
    const [f] = lint({ venue: DECL, facts: withFacts((x) => (x.columns = 1)) });
    expect(f?.line).toBe(2);
  });
});

describe("paperlint's own config turns the venue rules on for every paper.tex", () => {
  const texBlock = buildConfig({}, { sentinel: "tex language" }).find((b) =>
    ((b as { files?: string[] }).files ?? []).includes("**/paper.tex"),
  ) as { rules: Record<string, unknown> };

  it.each(Object.entries(VENUE_RULE_LEVELS))("%s is on at %s", (id, level) => {
    expect(texBlock.rules[id]).toBe(level);
    expect(SHIPPED_RULES.has(id)).toBe(true);
    expect(OPTIONAL_RULES.has(id)).toBe(false);
  });

  it("the six rules of the issue are errors except body-size, and measured is a warning", () => {
    expect(VENUE_RULE_LEVELS).toEqual({
      "pdf/fresh": "error",
      "pdf/profile": "error",
      "pdf/fonts": "error",
      "pdf/geometry": "error",
      "pdf/limits": "error",
      "pdf/body-size": "warn",
      "pdf/measured": "warn",
    });
  });

  it("pdf/last-page-balance stays optional", () => {
    expect(OPTIONAL_RULES.has("pdf/last-page-balance")).toBe(true);
  });
});
