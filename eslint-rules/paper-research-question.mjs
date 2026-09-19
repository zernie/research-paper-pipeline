/**
 * `paper/research-question` — a shipped paper states its research question EXPLICITLY.
 *
 * Reviewer A's verbatim point on agenticdev (#20), as it was parsed: "State the goal as a
 * research question." This is a venue expectation, not taste: an empirical paper that never
 * names the question it answers forces the reviewer to reconstruct it — and they say so.
 *
 * ── WHY THE SCOPE IS SHIPPED PAPERS ONLY ─────────────────────────────────────────────────
 * A draft never asked anyone to read it. The scope deliberately matches `paper/author-list`:
 * both are about the DEBT of a shipped paper, and an unshipped one has no debt. Measured on the
 * live corpus before the move:
 *     agenticdev-2026   has RQ,   shipped        -> silent  (added because of this very review)
 *     aisec-2026        no RQ,    shipped        -> a finding
 *     compile-rules     no RQ,    shipped        -> a finding
 *     scored-2026       no RQ,    NOT shipped    -> silent
 *
 * ── WHAT THE MOVE CHANGED ─────────────────────────────────────────────────────────────────
 * The predecessor read the stage with a REGEX OVER THE SCORECARD'S PROSE. Remeasured 2026-09-17:
 * for `agenticdev-2026` the prose reads `submitted`, while the `stages` field declares
 * `submitted, camera-ready`. Here the stage comes from the FIELD — the same one `paper/stages`
 * checks against the bytes in both directions.
 *
 * ⚠️ WHAT THE MOVE DOES NOT FIX, AND THIS IS MEASURED, NOT ASSUMED. The rule reads RAW text, not
 * the parsed tree, so a mention of RQ inside a LaTeX comment (`% add an RQ`) will put it to
 * sleep. Measured 2026-09-17 across all four papers: ZERO such cases — not a single match inside
 * a comment. So the hole is LATENT, not observed, and closing it with a tree walk would
 * complicate the rule without a measured difference. The neighboring `paper/typography` is built
 * the same way and for the same reason. Once a real case shows up, there will be something to
 * cite here.
 *
 * The rule is ADVISORY by decision, not by coincidence: a position paper may legitimately have
 * no question. Then its absence is the author's decision, and the rule says exactly that,
 * rather than declaring the absence a defect on its own.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { load } from "js-yaml";

/**
 * 🔴 THE REGEX IS GONE, AND THE REASON IS NOT "regexes are bad" — IT IS THAT IT ANSWERED THE
 * WRONG QUESTION (2026-09-19).
 *
 * What stood here was `/\\textbf\{RQ|\bRQ[0-9]?\b|research question/i`, defended in this very
 * file with: "a regex is LEGITIMATE here: the subject is human prose, which has no structure by
 * definition, and no parser can tell a question's statement apart from a paragraph about it."
 *
 * The premise is true. The conclusion does not follow. From "the text cannot decide this" the
 * answer is not "so pattern-match harder" — it is "so the HUMAN declares it, and the check
 * compares the declaration against the text." The three spellings were an undeclared schema
 * field: someone added a fact and invented a convention for how it would look in prose, which is
 * the design running backwards.
 *
 * What the pattern actually decided, in both directions:
 *   • a paper that says "we leave the research question to future work" — MATCHED, and the rule
 *     went silent on a paper that states no question at all;
 *   • a paper whose question is written plainly ("Does pruning reduce review cost?") with no
 *     "RQ" anywhere — NOT matched, and the rule reported a paper that does exactly what is asked.
 * An open list of spellings cannot be completed, so both failures are structural, not bugs.
 *
 * ── WHAT REPLACES IT: ONE UNDECIDABLE QUESTION BECOMES TWO DECIDABLE ONES ──────────────────
 *   1. Is the question WRITTEN DOWN? — `researchQuestion` in the scorecard's front matter. A
 *      field, parsed by js-yaml, not a phrase hunted for in prose.
 *   2. Does the paper CONTAIN what was written down? — the declared sentence, whitespace
 *      collapsed, compared against the source. Bytes, not spelling.
 *
 * This is the shape this package already uses twice, and for the same reason: `bytes`/
 * `sourceBytes` (a recorded number compared against the file on disk) and `paper/author-list`
 * (a recorded marker, because whether a cross-check ran is not visible in the paper). Neither
 * asks the prose a question the prose cannot answer.
 *
 * ⚠️ WHAT THIS STILL CANNOT DO, said plainly rather than implied: nothing here decides that the
 * declared sentence IS a research question. A declaration of "banana" passes step 1 and, if the
 * word appears in the paper, step 2. The rule guarantees that the author wrote a question down
 * and that the paper carries it — it does not grade the question. That is a human's job, and
 * pretending otherwise is what the regex was doing.
 */

/** Whitespace is the only thing normalised: a sentence wrapped across lines is the same sentence. */
const flatten = (t) => t.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Both facts come out of ONE parse of the scorecard's front matter: the stages (has this paper
 * shipped?) and the declared question. Reading them separately would invite the two to be taken
 * from different revisions of the same file.
 */
function scorecard(dir, statusName) {
  const p = join(dir, statusName);
  const none = { stages: [], question: "" };
  if (!existsSync(p)) return none;
  let text;
  try {
    text = readFileSync(p, "utf-8");
  } catch {
    return none;
  }
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  if (!m) return none;
  let data;
  try {
    data = load(m[1]);
  } catch {
    return none; // the unreadable YAML is already reported by `paper/stages`, on its own file
  }
  const raw = data?.stages;
  const stages = Array.isArray(raw) ? raw.map((r) => r?.stage).filter(Boolean) : [];
  const q = data?.researchQuestion;
  return { stages, question: typeof q === "string" ? q : "" };
}

export default {
  rules: {
    "research-question": {
      meta: {
        type: "suggestion",
        docs: {
          description:
            "a paper that declares a stage states its research question explicitly — otherwise the reviewer reconstructs it themselves, and says so",
        },
        schema: [
          {
            type: "object",
            properties: {
              // The scorecard's name is a CONSUMER convention. The rule is declared on the
              // paper's source, so it has to name its neighbor itself rather than get it via a
              // config glob.
              statusFile: { type: "string" },
            },
            additionalProperties: false,
          },
        ],
        messages: {
          notDeclared:
            "the paper shipped (stage «{{stages}}») and its scorecard declares no `researchQuestion`. This is reviewer A's verbatim point on agenticdev (#20), not the linter's taste. Write the question down as a field, in your own words — the check cannot infer it from the prose, and the pattern that used to try matched «we leave the research question to future work» while missing a question stated plainly. Advisory: a position paper may legitimately have none, and then leaving the field out is a DECISION — record it as one",
          notInPaper:
            "the scorecard declares a research question the paper does not contain. Looked for «{{needle}}» with whitespace collapsed, and the source has no such run of text. Either the paper dropped it or the declaration drifted from what was written — and which of the two it is, only you know",
        },
      },
      create(context) {
        const statusName = context.options?.[0]?.statusFile ?? "PIPELINE-STATUS.md";
        return {
          // `root:exit` exists for both markdown and the `tex/latex` language — the same place
          // `paper/typography` lives, and for the same reason: a paper in this corpus can be
          // either.
          "root:exit"(node) {
            const raw = context.sourceCode.raw ?? context.sourceCode.text;
            if (typeof raw !== "string") return;
            const { stages, question } = scorecard(dirname(context.filename), statusName);
            if (stages.length === 0) return; // not shipped — owes nothing

            // Step 1 — is it written down? A field, not a phrase hunted for in prose.
            if (question.trim() === "") {
              context.report({
                node,
                messageId: "notDeclared",
                data: { stages: stages.join("/") },
              });
              return;
            }

            // Step 2 — does the paper carry what was written down? Bytes, not spelling. Only
            // whitespace is normalised, because a sentence wrapped across source lines is the
            // same sentence; everything else stays the author's.
            if (flatten(raw).includes(flatten(question))) return;
            context.report({
              node,
              messageId: "notInPaper",
              data: { needle: flatten(question) },
            });
          },
        };
      },
    },
  },
};
