/**
 * Both halves for `paper/research-question`, plus two that a test forgets most often: SCOPE
 * and LANGUAGE.
 *
 * The scope is load-bearing here. The rule does not ask "is there a question", it asks "is there
 * a question FOR SOMETHING THAT HAS ALREADY SHIPPED". Remove the stage gate and the rule starts
 * scolding every draft in the corpus, and gets turned off within a week. So "silent on a draft"
 * is checked by its own assert, not treated as a special case of "silent".
 *
 * Language is the second forgotten half: a paper in this corpus can be either LaTeX or markdown.
 * A rule pinned to `.tex` only would LOSE `compile-rules-2026`, where the paper is written in
 * markdown and states no question — one of the two real findings on the live corpus.
 */
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Linter } from "eslint";
import markdown from "@eslint/markdown";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "..", "fixtures", "paper-research-question");

const { texLanguage } = await import(join(HERE, "latex-language.mjs"));
const rq = (await import(join(HERE, "paper-research-question.mjs"))).default;

let n = 0;
const check = (label, cond) => {
  assert.ok(cond, label);
  n++;
};

const linter = new Linter();

/** Run against one fixture. The language is picked by extension — exactly like the consumer's config. */
function lint(dir, file, opts = {}) {
  const path = join(FIX, dir, file);
  const tex = file.endsWith(".tex");
  const cfg = tex
    ? {
        files: ["**/*.tex"],
        plugins: { tex: { languages: { latex: texLanguage } }, paper: rq },
        language: "tex/latex",
      }
    : {
        // `files` is required, not cosmetic: without it flat config falls back to JS
        // extensions, and the fixture comes back as "No matching configuration found" — a
        // message that reads exactly like a clean run.
        files: ["**/*.md"],
        plugins: { markdown, paper: rq },
        language: "markdown/gfm",
        languageOptions: { frontmatter: "yaml" },
      };
  const msgs = linter.verify(readFileSync(path, "utf-8"), [
    { ...cfg, rules: { "paper/research-question": ["error", opts] } },
  ], path);
  assert.deepEqual(msgs.filter((m) => m.fatal), [], `${dir}/${file}: the rule threw`);
  return msgs.map((m) => m.message);
}

// ── fires on a planted defect ───────────────────────────────────────────────────────────
const fires = lint("shipped-no-rq", "paper.tex");
check("shipped and no question — a finding", fires.length === 1);
// 🔴 The message must name WHERE the requirement comes from. Without this it reads as the
// linter's taste, but the requirement came from a real venue reviewer.
check("and it cites the reviewer, rather than passing this off as the linter's taste",
      /reviewer/i.test(fires[0]));
// The stages in the text come from the FIELD. The predecessor derived them with a regex over
// the scorecard's prose and on agenticdev printed `submitted` where `submitted, camera-ready`
// was declared.
check("the stage list in the message comes from the field and carries BOTH",
      /submitted\/camera-ready/.test(fires[0]));

// markdown — the second half of LANGUAGE, without it one of the two real findings is lost
check("a paper in markdown is checked the same way", lint("markdown-no-rq", "paper.md").length === 1);

// ── THE CASE THE PREDECESSOR COULD NOT EXPRESS ──────────────────────────────────────────
// 🔴 The point of the 2026-09-19 redesign, in one fixture. The scorecard declares a question,
// the paper does not carry it — AND the paper contains the words "research question", inside
// "We leave the research question to future work". The old pattern matched that phrase and went
// SILENT on a paper stating no question at all. Matching a sentence ABOUT the thing is not
// finding the thing, and no list of spellings fixes that.
const drifted = lint("declared-not-in-paper", "paper.tex");
check("declared but absent from the paper — a finding, where the old pattern was silent",
      drifted.length === 1);
check("and the message QUOTES what was looked for, so the author can see why it missed",
      /does pruning reduce review cost\?/i.test(drifted[0]));

// ── stays silent where it must ──────────────────────────────────────────────────────────
check("the question is stated — silent", lint("shipped-with-rq", "paper.tex").length === 0);
// The stage gate: a draft owes nothing, because it never asked anyone to read it.
check("a draft (no stages) — silent, even though it has no question either",
      lint("draft", "paper.tex").length === 0);
// And the distinguisher against the previous case: the same draft with a SWAPPED scorecard
// name is also silent — so the silence there is not because the file went unfound, it's
// because the stage list is empty.
check("and with a nonexistent scorecard a shipped paper is also silent — the stage gate is load-bearing",
      lint("shipped-no-rq", "paper.tex", { statusFile: "NO-SUCH-FILE.md" }).length === 0);

// ── a named hole, pinned down by an assert, and RESHAPED by the redesign ────────────────
// ⚠️ The hole changed form on 2026-09-19 and did not close. Before, ANY mention of "RQ" in a
// LaTeX comment silenced the rule. Now the rule no longer hunts for spellings, so this fixture
// — a comment saying "TODO: state the research question", with no `researchQuestion` field —
// is a FINDING, which it never was before. What survives is narrower: if the DECLARED sentence
// appears only inside a comment, the raw-text comparison still accepts it. That is a smaller
// hole with a named owner, and closing it means walking the parsed tree.
check("a paper whose only mention is a comment, with nothing declared, is now a finding",
      lint("comment-only", "paper.tex").length === 1);

// ── the scorecard's name is consumer data ───────────────────────────────────────────────
check("the scorecard's name comes in as an option",
      lint("shipped-no-rq", "paper.tex", { statusFile: "PIPELINE-STATUS.md" }).length === 1);

console.log(`✓ ${String(n)} assertions passed — paper/research-question, the debt of a shipped paper`);
