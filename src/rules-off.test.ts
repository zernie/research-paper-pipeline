/**
 * A consumer that ALSO lints paper files with its own ESLint config (#104).
 *
 * 3.0.0 made `% eslint-disable-next-line <rule> -- <why>` the way to keep a deliberate exception.
 * A project that runs its own `eslint` over the same `paper.tex` — for its own rules, with
 * paperlint's LaTeX language — did not register paperlint's rule plugins, so that run failed on the
 * directive: "Definition for rule 'paper/leading-zero' was not found". `rulesOff` is the fragment
 * such a config spreads in: every rule paperlint ships, registered and turned off.
 */
import { ESLint, type Linter } from "eslint";
import { describe, expect, it } from "vitest";
// @ts-expect-error — the module is .mjs and has no types.
import { texLanguage } from "../eslint-rules/latex-language.mjs";
import { rulePlugins, rulesOff, SHIPPED_RULES } from "./cli.ts";

const PAPER = [
  "\\documentclass{article}",
  "\\begin{document}",
  "% eslint-disable-next-line paper/leading-zero -- quoted from the reviewer",
  "We use a threshold of .05 throughout.",
  "% eslint-disable-next-line bib/reachable-entry -- kept for the artifact",
  "Nothing else.",
  "\\end{document}",
  "",
].join("\n");

/** The consumer's own config: its LaTeX files, with paperlint's language, and its own rules. */
async function lintAsConsumer(
  fragment: Linter.Config[],
): Promise<Linter.LintMessage[]> {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
      ...fragment,
      {
        files: ["**/*.tex"],
        plugins:
          fragment.length > 0
            ? {}
            : { tex: { languages: { latex: texLanguage } } },
        language: "tex/latex",
      },
    ],
  });
  const [res] = await eslint.lintText(PAPER, {
    filePath: "papers/a/paper.tex",
  });
  return res!.messages;
}

describe("rulesOff — paperlint's rules, registered and off, for a consumer's own ESLint run", () => {
  it("without it, the documented escape hatch breaks the consumer's run (the defect)", async () => {
    const messages = await lintAsConsumer([]);
    expect(messages.map((m) => m.message)).toContain(
      "Definition for rule 'paper/leading-zero' was not found.",
    );
  });

  it("🔴 spreading it: no 'Definition … not found', and no paperlint finding runs", async () => {
    const messages = await lintAsConsumer(rulesOff(texLanguage));
    // Guards: the defect — every directive names a rule ESLint now knows.
    expect(messages.map((m) => m.message).join("\n")).not.toMatch(
      /Definition for rule/,
    );
    // Guards: off means off — paperlint's own run judges these files, not the consumer's.
    expect(messages.filter((m) => m.ruleId?.startsWith("paper/"))).toEqual([]);
    // Guards: a directive naming an OFF rule suppresses nothing, and ESLint would call it unused
    // ("Unused eslint-disable directive (no problems were reported from 'paper/leading-zero')").
    expect(messages).toEqual([]);
  });

  it("registers every rule paperlint ships, each off, and carries the LaTeX language", () => {
    const [cfg] = rulesOff(texLanguage);
    expect(new Set(Object.keys(cfg?.rules ?? {}))).toEqual(SHIPPED_RULES);
    expect(Object.values(cfg?.rules ?? {}).every((e) => e === "off")).toBe(
      true,
    );
    const plugins = rulePlugins(texLanguage);
    const defined = new Set<string>();
    for (const [name, p] of Object.entries(plugins))
      for (const r of Object.keys(p.rules ?? {})) defined.add(`${name}/${r}`);
    expect(defined).toEqual(SHIPPED_RULES);
    expect(plugins["tex"]?.languages?.["latex"]).toBe(texLanguage);
    // `@eslint/markdown` is a dependency's plugin: the consumer registers its own.
    expect(plugins["markdown"]).toBeUndefined();
  });

  it("the unused-directive report is off on paper files only, not on the consumer's code", async () => {
    const eslint = new ESLint({
      overrideConfigFile: true,
      overrideConfig: [
        ...rulesOff(texLanguage),
        {
          files: ["**/*.js"],
          linterOptions: { reportUnusedDisableDirectives: "warn" },
        },
      ],
    });
    const [res] = await eslint.lintText(
      "// eslint-disable-next-line paper/leading-zero -- nothing to silence\nconst x = 1;\n",
      { filePath: "src/x.js" },
    );
    expect(res!.messages.map((m) => m.message)).toEqual([
      "Unused eslint-disable directive (no problems were reported from 'paper/leading-zero').",
    ]);
  });

  it("without a LaTeX language, the `tex` plugin carries rules only", () => {
    expect(rulePlugins()["tex"]?.languages).toBeUndefined();
  });
});
