/**
 * paper/section-word · paper/leading-zero · paper/figure-ref-style · bib/reachable-entry — each
 * FIRES on a bad input, stays SILENT on a good one, reports every occurrence at its own place,
 * and (the first three) fixes to an exact output. Plus the escape hatch: a disable directive in a
 * `%` comment, including inside the `filecontents` bibliography, silences exactly one finding,
 * and a directive that silences nothing is itself reported.
 *
 * The leading-zero cases are the ones paperlint#44 measured: a regex over the raw source found 22
 * decimals on a real corpus and none was a defect, so the SILENT list is as load-bearing as the
 * CAUGHT one.
 */
import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";
import markdown from "@eslint/markdown";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { texLanguage } from "./latex-language.mjs";
import typography from "./paper-typography.mjs";
import bib from "./bib-reachable-entry.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "..", "fixtures", "paper-typography");

const RULES = {
  "paper/section-word": "warn",
  "paper/leading-zero": "warn",
  "paper/figure-ref-style": "warn",
  "bib/reachable-entry": "warn",
};

const eslint = (fix = false) =>
  new ESLint({
    cwd: FIX,
    overrideConfigFile: true,
    fix,
    overrideConfig: [
      {
        files: ["**/*.tex"],
        plugins: {
          tex: { languages: { latex: texLanguage } },
          paper: typography,
          bib,
        },
        language: "tex/latex",
        linterOptions: { reportUnusedDisableDirectives: "error" },
        rules: RULES,
      },
      {
        files: ["**/*.md"],
        plugins: { markdown, paper: typography },
        language: "markdown/gfm",
        languageOptions: { frontmatter: "yaml" },
        rules: {
          "paper/section-word": "warn",
          "paper/leading-zero": "warn",
        },
      },
    ],
  });

/** Lint `text` as `file`; no crash allowed, only findings. */
async function lint(text, file = "paper.tex", fix = false) {
  const [res] = await eslint(fix).lintText(text, {
    filePath: join(FIX, "inline", file),
  });
  expect(res.messages.filter((m) => m.fatal)).toEqual([]);
  return res;
}
const ids = (res, id) => res.messages.filter((m) => !id || m.ruleId === id);
const fixed = async (text, file) =>
  (await lint(text, file, true)).output ?? text;
const doc = (body) =>
  `\\documentclass{acmart}\n\\begin{document}\n${body}\n\\end{document}\n`;

describe("the fixtures: messy fires on each rule, clean is silent", () => {
  it("messy-paper — every occurrence, at its own line", async () => {
    const res = await lint(
      readFileSync(join(FIX, "messy-paper", "paper.tex"), "utf8"),
    );
    const count = (id) => ids(res, id).length;
    expect(count("paper/section-word")).toBe(3);
    expect(count("paper/leading-zero")).toBe(2);
    expect(count("paper/figure-ref-style")).toBe(1);
    expect(count("bib/reachable-entry")).toBe(2);
    expect(ids(res, "bib/reachable-entry").map((m) => m.line)).toEqual([3, 8]);
  });

  it("clean-paper — nothing", async () => {
    const res = await lint(
      readFileSync(join(FIX, "clean-paper", "paper.tex"), "utf8"),
    );
    expect(res.messages).toEqual([]);
  });
});

describe("paper/section-word", () => {
  it("🔴 the MACRO form counts, not only the glyph — and each is fixed exactly", async () => {
    const src = doc("See §~\\ref{a}, \\S\\ref{b}, \\S~\\ref{c}, \\S 4 and §5.");
    expect(ids(await lint(src), "paper/section-word")).toHaveLength(5);
    expect(await fixed(src)).toBe(
      doc(
        "See Section~\\ref{a}, Section~\\ref{b}, Section~\\ref{c}, Section 4 and Section 5.",
      ),
    );
  });

  it("a glyph before prose is reported but not rewritten", async () => {
    const src = doc("As §§ above.");
    expect(ids(await lint(src), "paper/section-word")).toHaveLength(2);
    expect(await fixed(src)).toBe(src);
  });

  it("silent on Section written out, on comments, on the bibliography", async () => {
    const src =
      "\\documentclass{acmart}\n\\begin{filecontents*}{refs.bib}\n@misc{k, note = {see §5}, url = {https://x.org}}\n\\end{filecontents*}\n" +
      "\\begin{document}\nSection~\\ref{a}.\n% §5 in an old draft\n\\end{document}\n";
    expect(ids(await lint(src), "paper/section-word")).toEqual([]);
  });

  it("markdown: `§5` → `Section 5`, code untouched", async () => {
    const src = "See §5 and `§3` here.\n";
    expect(ids(await lint(src, "paper.md"), "paper/section-word")).toHaveLength(
      1,
    );
    expect(await fixed(src, "paper.md")).toBe("See Section 5 and `§3` here.\n");
  });
});

describe("paper/leading-zero", () => {
  const caught = [
    ["a p-value in inline math", "We call it significant at $p < .05$."],
    ["a p-value after other math", "(bugfix $-31\\%$, $p=.002$)"],
    [
      "a table cell",
      "\\begin{tabular}{ll}\ntask & p \\\\\nbugfix & .037 \\\\\n\\end{tabular}",
    ],
    ["plain prose", "We use a threshold of .05 throughout."],
  ];
  it.each(caught)("CAUGHT, exactly one: %s", async (_, body) => {
    expect(ids(await lint(doc(body)), "paper/leading-zero")).toHaveLength(1);
  });

  const silent = [
    ["a figure width option", "\\includegraphics[width=.48\\columnwidth]{f}"],
    [
      "a tabular column spec",
      "\\begin{tabular}{p{.25\\linewidth}l}\na & b \\\\\n\\end{tabular}",
    ],
    ["a comment", "Text.\n% p<.01 in the old draft\nMore text."],
    ["a listing", "\\begin{lstlisting}\nx = .25\n\\end{lstlisting}"],
    ["inline listing", "Call \\lstinline{.25} here."],
    ["a length argument", "A\\hspace{.3em}B\\hspace{.35em}C"],
    ["a macro definition body", "\\def\\x{.85}"],
    [
      "tikz coordinates",
      "\\begin{tikzpicture}\\draw (.35,.65);\\end{tikzpicture}",
    ],
    ["an arXiv id", "See arXiv 2310.05736 for details."],
    [
      "an unsigned environment's width",
      "\\begin{subfigure}[b]{.48\\textwidth}\nPanel.\n\\end{subfigure}",
    ],
    [
      "an unsigned table's column spec",
      "\\begin{longtable}{p{.25\\linewidth}l}\na & b \\\\\n\\end{longtable}",
    ],
    [
      "an unknown macro's options",
      "\\adjustbox{width=.48\\linewidth}{x} \\foo[scale=.75]{y}",
    ],
  ];
  it.each(silent)("SILENT: %s", async (_, body) => {
    expect(ids(await lint(doc(body)), "paper/leading-zero")).toEqual([]);
  });

  it("the preamble and the inline bibliography are not the reader's text", async () => {
    const src =
      "\\documentclass{acmart}\n\\renewcommand{\\arraystretch}{.85}\n" +
      "\\begin{filecontents*}{refs.bib}\n@misc{k, note = {p = .05}, url = {https://x.org}}\n" +
      "\\end{filecontents*}\n\\begin{document}\nNothing here.\n\\end{document}\n";
    expect(ids(await lint(src), "paper/leading-zero")).toEqual([]);
  });

  it("the fix inserts the zero at the dot — in math, in a table, in prose", async () => {
    const src = doc(
      "At $p < .05$ and $d=.21$; cell & .037 \\\\ and .5 or .25.",
    );
    expect(await fixed(src)).toBe(
      doc("At $p < 0.05$ and $d=0.21$; cell & 0.037 \\\\ and .5 or 0.25."),
    );
  });

  it("markdown: prose and a table cell are fixed, code is not", async () => {
    const src =
      "Significant at p<.05.\n\n| task | p |\n| --- | --- |\n| bugfix | .002 |\n\nRun `.25`.\n";
    expect(ids(await lint(src, "paper.md"), "paper/leading-zero")).toHaveLength(
      2,
    );
    expect(await fixed(src, "paper.md")).toBe(
      "Significant at p<0.05.\n\n| task | p |\n| --- | --- |\n| bugfix | 0.002 |\n\nRun `.25`.\n",
    );
  });
});

describe("paper/leading-zero — a number after ¶ or § is not a decimal (#102)", () => {
  // From a consumer's bibliography: `--fix` rewrote the paragraph number `¶¶.42` to `¶¶0.42`.
  const CITE =
    "PCAOB. \\emph{Audit of Financial Statements}, ¶¶.42 (design\neffectiveness) and .44 (operating effectiveness).";

  it.each([
    ["¶¶.42", "Standard 5, ¶¶.42 applies."],
    ["¶ .42", "Standard 5, ¶ .42 applies."],
    ["\\P\\P.42", "Standard 5, \\P\\P.42 applies."],
    ["§.12", "Rule 10b-5, §.12 applies."],
  ])("SILENT: %s is a designator", async (_, body) => {
    // Guards: the defect — the lexeme after a paragraph/section sign was read as a decimal.
    expect(ids(await lint(doc(body)), "paper/leading-zero")).toEqual([]);
    expect(await fixed(doc(body))).toBe(doc(body));
  });

  it("🔴 the list continuation `and .44` is reported WITHOUT a fix, with the zero as a suggestion", async () => {
    const res = await lint(doc(CITE));
    const found = ids(res, "paper/leading-zero");
    expect(found.map((m) => [m.line, m.message.slice(0, 5)])).toEqual([
      [4, "`.44`"],
    ]);
    expect(found[0].fix).toBeUndefined();
    expect(found[0].suggestions).toHaveLength(1);
    // Guards: --fix changes nothing in an ambiguous paragraph — neither number.
    expect(await fixed(doc(CITE))).toBe(doc(CITE));
  });

  it("…while a real decimal still fixes, in markdown too, even beside a cited paragraph", async () => {
    const body = `${CITE}\n\nWe use a threshold of .05 throughout.`;
    expect(await fixed(doc(body))).toBe(
      doc(`${CITE}\n\nWe use a threshold of 0.05 throughout.`),
    );
    const md = "See ¶¶.42 and .44.\n\nSignificant at p<.05.\n";
    expect(await fixed(md, "paper.md")).toBe(
      "See ¶¶.42 and .44.\n\nSignificant at p<0.05.\n",
    );
  });
});

describe("paper/figure-ref-style", () => {
  it("the minority form is reported and rewritten to the majority", async () => {
    const src = doc("Figure~\\ref{a}, Figure~\\ref{b} and Fig.~\\ref{c}.");
    const found = ids(await lint(src), "paper/figure-ref-style");
    expect(found).toHaveLength(1);
    expect(found[0].column).toBe(src.split("\n")[2].indexOf("Fig.") + 1);
    expect(await fixed(src)).toBe(
      doc("Figure~\\ref{a}, Figure~\\ref{b} and Figure~\\ref{c}."),
    );
  });

  it("the majority can be the short form", async () => {
    const src = doc("Fig.~\\ref{a}, Fig.~\\ref{b} and Figure~\\ref{c}.");
    expect(await fixed(src)).toBe(
      doc("Fig.~\\ref{a}, Fig.~\\ref{b} and Fig.~\\ref{c}."),
    );
  });

  it("silent when one form is used throughout", async () => {
    expect(
      ids(
        await lint(doc("Fig.~\\ref{a} and Fig.~\\ref{b}.")),
        "paper/figure-ref-style",
      ),
    ).toEqual([]);
  });
});

describe("bib/reachable-entry", () => {
  const bibDoc = (entries) =>
    `\\documentclass{acmart}\n\\begin{filecontents*}{refs.bib}\n${entries}\n\\end{filecontents*}\n\\begin{document}\nx\n\\end{document}\n`;

  it("a doi, a url or an arXiv id each make an entry reachable", async () => {
    const res = await lint(
      bibDoc(
        "@article{a, doi = {10.1/x}}\n@misc{b, url = {https://x.org}}\n@misc{c, note = {arXiv:2310.05736}}\n@string{v = {x}}",
      ),
    );
    expect(ids(res, "bib/reachable-entry")).toEqual([]);
  });

  it("reports on the entry itself, naming its key", async () => {
    const res = await lint(
      bibDoc("@misc{ok, url = {https://x.org}}\n@article{lost, title = {x}}"),
    );
    const [m] = ids(res, "bib/reachable-entry");
    expect(m.line).toBe(4);
    expect(m.column).toBe(1);
    expect(m.message).toMatch(/`lost`/);
  });
});

describe("the escape hatch — a disable directive in a `%` comment", () => {
  it("🔴 inside the filecontents bibliography, it silences exactly the next entry", async () => {
    const res = await lint(
      `\\documentclass{acmart}\n\\begin{filecontents*}{refs.bib}\n` +
        "% eslint-disable-next-line bib/reachable-entry -- an invited talk, no recording exists\n" +
        "@misc{talk, title = {x}}\n@misc{lost, title = {y}}\n" +
        "\\end{filecontents*}\n\\begin{document}\nx\n\\end{document}\n",
    );
    const found = ids(res, "bib/reachable-entry");
    expect(found).toHaveLength(1);
    expect(found[0].message).toMatch(/`lost`/);
  });

  it("in the body: next-line, same-line, and a disable/enable region", async () => {
    const src = doc(
      [
        "% eslint-disable-next-line paper/leading-zero -- quoted from the reviewer",
        "They wrote .05 here.",
        "And .06 here. % eslint-disable-line paper/leading-zero -- also quoted",
        "% eslint-disable paper/leading-zero -- a quoted table",
        "Region .07 and .08.",
        "% eslint-enable paper/leading-zero",
        "But .09 counts.",
      ].join("\n"),
    );
    const found = ids(await lint(src), "paper/leading-zero");
    expect(found.map((m) => m.line)).toEqual([9]);
  });

  it("a directive that silences nothing is itself reported", async () => {
    const res = await lint(
      doc(
        "% eslint-disable-next-line paper/leading-zero -- stale\nNo decimals here.",
      ),
    );
    expect(
      res.messages.filter((m) => /Unused eslint-disable/.test(m.message)),
    ).toHaveLength(1);
  });
});
