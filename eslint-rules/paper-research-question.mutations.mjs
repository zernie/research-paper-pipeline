/**
 * Battery for `paper/research-question` — five mutations, each removes ITS OWN load-bearing
 * property.
 *
 * 🔴 Why the battery matters here specifically. The rule's success state is SILENCE, and on the
 * live corpus it only produces two findings out of four papers. "It passed" and "it cannot fire"
 * look identical from the outside, and only this tells them apart.
 *
 * Two mutations do not target the finding but the SCOPE and the LANGUAGE — the halves a test
 * forgets. Without the stage gate the rule scolds every draft; without markdown it loses
 * `compile-rules`, i.e. half of the real findings, while staying green.
 */
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { runMutations } from "../lib/mutation-driver.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const RULE = join(HERE, "paper-research-question.mjs");
const HARNESS = join(HERE, "paper-research-question.harness.mjs");

process.exit(
  runMutations({
    root: ROOT,
    runner: "node",
    cases: [
      {
        name: "the rule stops noticing that nothing was declared",
        harness: HARNESS,
        expect: "shipped and no question — a finding",
        disables:
          "the subject itself: the rule stays silent across the whole corpus, and silence is " +
          "its success state — from the outside a disabled rule is indistinguishable from a clean paper",
        edits: [[RULE, 'if (question.trim() === "") {', "if (false) {"]],
      },
      {
        // 🔴 The half that did not exist before 2026-09-19, and the reason the redesign happened.
        // Without this case the second step could be deleted and the battery would stay green on
        // the strength of the first — which is how a two-step check quietly becomes a one-step one.
        name: "the CONTENT check is dropped — a declaration nobody carries passes",
        harness: HARNESS,
        expect: "declared but absent from the paper — a finding, where the old pattern was silent",
        disables:
          "step two. The scorecard would only have to SAY a question exists, never to have it in " +
          "the paper — which is the checklist the `bytes` field exists to not be. The predecessor " +
          "failed the same way from the other side: it matched «we leave the research question to " +
          "future work» and reported a paper that states no question as clean",
        edits: [[RULE, "if (flatten(raw).includes(flatten(question))) return;", "return;"]],
      },
      {
        name: "the STAGE GATE is removed — drafts get scolded too",
        harness: HARNESS,
        expect: "a draft (no stages) — silent, even though it has no question either",
        disables:
          "the scope. The rule does not ask 'is there a question', it asks 'is there a question " +
          "FOR SOMETHING SHIPPED'. Without the gate every draft gets a finding — and a rule that " +
          "scolds drafts gets turned off within a week, at which point both real findings disappear too",
        edits: [
          [RULE, "if (stages.length === 0) return; // not shipped — owes nothing", ""],
        ],
      },
      {
        name: "the LANGUAGE narrows to LaTeX — a markdown paper becomes invisible",
        harness: HARNESS,
        expect: "a paper in markdown is checked the same way",
        disables:
          "the second half of the language. For the `tex/latex` language the text sits in `raw`, " +
          "for markdown it sits in `text`. The mutation keeps only the first, and " +
          "`compile-rules-2026` (paper written in markdown, no question) stops being found — HALF " +
          "of the live corpus's findings disappear silently, and the run stays green",
        edits: [
          [
            RULE,
            "const raw = context.sourceCode.raw ?? context.sourceCode.text;",
            "const raw = context.sourceCode.raw;",
          ],
        ],
      },
      {
        name: "the stage list is taken from somewhere OTHER than the field again",
        harness: HARNESS,
        expect: "the stage list in the message comes from the field and carries BOTH",
        disables:
          "the whole reason the move was made. The predecessor derived the stage with a regex " +
          "over the scorecard's prose and on agenticdev printed `submitted` where `submitted, " +
          "camera-ready` was declared. The mutation does not change the set of findings — only " +
          "the TEXT lies, and without its own assert the regression would have passed silently",
        edits: [[RULE, 'data: { stages: stages.join("/") }', 'data: { stages: "submitted" }']],
      },
      {
        name: "the scorecard's name stops arriving as an option",
        harness: HARNESS,
        expect: "and with a nonexistent scorecard a shipped paper is also silent — the stage gate is load-bearing",
        disables:
          "the boundary 'the mechanism goes in the package, the data stays with the consumer'. " +
          "`PIPELINE-STATUS.md` is ONE repository's convention, and hardcoding it makes the rule unusable for everyone else",
        edits: [
          [
            RULE,
            'const statusName = context.options?.[0]?.statusFile ?? "PIPELINE-STATUS.md";',
            'const statusName = "PIPELINE-STATUS.md";',
          ],
        ],
      },
    ],
  }),
);
