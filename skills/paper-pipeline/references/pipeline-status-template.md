# PIPELINE-STATUS template — the per-paper readiness scorecard

Copy this into `<paper-dir>/PIPELINE-STATUS.md` for each paper. It is the **durable, colocated,
markdown source-of-truth** for *which pipeline work has run, its result, and what is still open* — so
"did everything run?" is a checked fact, not a memory. Chat evaporates; this file rides with the paper
to camera-ready.

🔴 **It is also machine-read.** `../scripts/pipeline-check.mjs` parses this file, so the four section
headings, the row shape, and the ISO dates are a **format contract**, not decoration. Break them and
the checks go quiet — which, as of 2026-08-03, is a failure mode this repo has lived through three
times in one day. Run `node .claude/skills/paper-pipeline/scripts/pipeline-check.mjs <paper-dir>`
after editing to confirm it still parses.

## The front matter

Above the sections, the file carries YAML. Two fields are read by rules:

```yaml
---
stages:
  - stage: submitted
    date: 2026-07-22
    pdf: versions/2026-07-22-submitted.pdf
    bytes: 305412
    source: versions/2026-07-22-submitted.tex
    sourceBytes: 57210
researchQuestion: "Does pruning the state space reduce review cost?"
---
```

`researchQuestion` is **your sentence, written once** — not a label the checker hunts for in the
prose. `paper/research-question` then asks two things it can actually answer: is it written down,
and does the paper contain it (whitespace collapsed). Leave the field out and a shipped paper gets
an advisory finding, which is the right outcome for a position paper with no question: the absence
becomes a decision on the record rather than an omission.

⚠️ Write the sentence the way it appears in the paper. If the paper breaks it across lines that is
fine — only whitespace is normalised — but LaTeX markup inside the sentence (`\emph{cost}`) will not
match, and the finding will quote exactly what it looked for.

## The row ids, and what each one runs

The `id` cell is the **join key** — the same string appears in this template, in every paper's
scorecard, in `Requires` cells, in `../scripts/pipeline-edges.mjs` and in the skills' own prose. So
the scorecard explains itself where it lives:

| id | section | what it is | run by |
|----|---------|------------|--------|
| `idea` | SETUP | is the idea worth a paper? | `research-ideate` |
| `priorwork` | SETUP | full competitor sweep, before drafting | `map-prior-work` |
| `venue` | SETUP | pick where it goes | `find-venue` |
| `venuebar` | SETUP | what this venue rewards; strengthening levers | `study-accepted-papers` |
| `access` | SETUP | 🔴 *can you physically upload?* — account, ACTIVE profile, portal, form | `plan-paper-timeline` |
| `schedule` | SETUP | the backwards plan and its calendar events | `plan-paper-timeline` |
| `frame` | SETUP | the claim, stated **before** the runs | `argument-arc` (frame mode) |
| `study` | LOOP | the empirical study + reproduction artifact | `build-benchmark` |
| `draft` | LOOP | the paper itself | `draft-paper` |
| `arc` | LOOP | does the argument carry end to end? | `argument-arc` |
| `cites` | CONTINUOUS | every `\cite` is real, and the delta over the nearest neighbour is stated | `verify-citations` |
| `siblings` | CONTINUOUS | deep read of a competing/concurrent paper | `analyze-sibling-paper` |
| `priordelta` | CONTINUOUS | re-sweep restricted to work posted since | `map-prior-work` (delta) |
| `render` | CONTINUOUS | build the PDF; the page count everything else is blocked on | `render-paper` |
| `numbers` | CONTINUOUS | every printed quantity traces to committed data | the paper's own numbers gate |
| `structure` | GATES | the developmental/editorial verdict + cut plan | `tighten-paper` |
| `writing` | GATES | writing craft + the persona stall inventory | `grade-paper-writing` |
| `panel` | GATES | the simulated PC decision | `pc-panel-review` |
| `artifact` | GATES | defects found by **executing** the artifact | `pc-panel-review` §C |
| `claims` | GATES | claim-preservation diff after every rewrite | Fable diff (`writing-craft.md`) |
| `harden` | GATES | the multi-axis pre-submit gate | `harden-paper` |
| `submit` | GATES | the upload itself | `submit-paper` |
| `coldread` | GATES | a reader with no context on the changed prose | `cold-read-diff` |
| `cameraready` | AFTER | de-anonymize, disclose, archive | `camera-ready` |
| `extend` | AFTER | the ≥30%-new follow-on at a stronger venue | `extend-paper` |

🔴 **Ids are WORDS, and that is load-bearing** (renamed 2026-08-09 from two-letter codes). Two
letters had run out and had already collided twice, both live in this repo: `Cr` was
`cold-read-diff` in one table of `compile-rules-2026` and `Camera-ready` in another — one join key,
two rows, merged by every consumer — and `Id` (research-ideate) was the header word `id`, so the
parser's header-row filter silently ate that row on **every** scorecard for as long as the template
existed. Neither is expressible now. Keep new ids lowercase, one word, and say what the row is.

### How `pipeline-check.mjs` reads this file (rewritten 2026-08-09 to parse markdown, not match it)

Both defects above, plus a third — two rows sharing an id merging in silence — had one cause: a
regular expression guessing at document structure. The parser is now an AST walk (`markdown-it`),
and two rules decide what it reads. They are stated here because the checker's findings point at
them:

- **A heading names a section iff its FIRST Latin-script word is `SETUP` / `LOOP` / `CONTINUOUS` /
  `GATES` / `AFTER`.** Anything after that word is free: `### GATES (re-run 06.08)` is GATES. A
  heading with a different first word — or none, like `### Гейты, прогнанные 06.08` — names no
  section and CLOSES the previous one. Headings are **not** translated or fuzzy-matched: guessing
  what a heading means is the defect, not the fix. Rows in such a region are reported
  (`unattributed-row`), never dropped.
- **A table is part of the scorecard iff its header row's first cell is `id`** (also `код`, `code`).
  The header comes from the table's real `thead`, so there is nothing to guess and a data row
  reading `| Id |` is a row. Prose tables in a scorecard — the panel must-fix table, a ceiling
  classification — have no id column and are correctly ignored. The pre-2026-08 single-table format
  keys its first column `#`, a row number; it does not parse, and the checker says so by name.

**A row is never dropped in silence.** Unattributable, unreadable and duplicate ids are findings.

## Rules

- **One row per unit of work; update the row in the SAME commit as the work.** Status + ISO date +
  result + open findings + a link to the durable artifact (`siblings/`, a saved grader report).
- **Four sections, because the four kinds fail differently** (see `paper-pipeline` → "There is no
  stage 7"). SETUP is done-or-not. LOOP iterates. **CONTINUOUS is never done** — its date is compared
  against the paper's own mtime, and a `☑` older than the text is a *stale pass*, which reads as
  green and is not. GATES are blocked on named inputs.
- 🔴 **The `Requires` cells above are not free-form — do not thin them.** The canonical edge set lives
  in `../scripts/pipeline-edges.mjs`, with the sentence from each skill's own SKILL.md that admitted
  the edge, and the ESLint rule `pipeline/undeclared-input` (`eslint-rules/pipeline-status.mjs`;
  until 2026-08-26 `pipeline-check.mjs`) reports any cell that drops one. The cell
  was retyped by hand for every paper until 2026-08-08, and `compile-rules-2026` had lost four of
  them — including `arc`, which argument-arc's SKILL.md says must precede `tighten-paper`. A dropped
  edge is invisible: `gate-missing-input` can only enforce what the cell says. Adding an input the
  table does not know about is fine and reports nothing.
- 🔴 **Row `access` is the one that is not about the paper, and it is the one that bites.** *Can you
  physically upload?* — account exists, profile is **ACTIVE** rather than "pending moderation", the
  portal is reachable, you know the form's fields and its artifact-hosting requirement. On
  `compile-rules-2026` this was the sole critical-path item at T−4 days: the paper was finished and
  there was nowhere to put it, because OpenReview requires an active profile to submit and moderation
  runs **up to two weeks**. Turn it green in the first week, not the last. Record the date it went
  ACTIVE, not just the tick.
- **Row `frame` costs one paragraph and saves a study.** State what the paper will claim *before* the
  runs. Reframing after the data is collected is how experiments get thrown away — observed on
  `compile-rules-2026`, and the reason `argument-arc` has a rebuild mode at all.
- **Status legend:** `☑` done/pass · `◐` partial (say what's missing) · `☐` not run · `⚠` ran, findings
  open · `n/a` not applicable to this paper/venue.
- **Never inflate.** A unit that didn't run *this* cycle is `☐` — do not borrow credit from a prior
  submission you can't point to. Approximate or from-memory grades get `≈`.
- **The verdict line leads WORST-GATE-FIRST.** One sentence: submit-ready or not, and the single thing
  blocking. "Ready" is a vector (science/defects, readability, structure, claims-honest, mechanical) —
  **any failing gate caps the verdict**. **A high accept-probability alone is never "submit-ready"**:
  an ~88% panel number once masked failing readability and structure on a paper a human found
  exhausting, and the checker now refuses a verdict line that is only a percentage.
- **Distinct from `SUBMIT-CHECKLIST.md`** (venue-format compliance: page limit, blind model, portal).
  This tracks *quality completeness*. Both green before upload.

---

```markdown
# PIPELINE-STATUS — <paper short name>
Venue: <venue> · Deadline: <ISO date, AoE converted to the author's own zone> · Blind: <double/single> · State: <drafting/submitted #N/accepted>
Updated: <ISO>

**Readiness verdict:** <one line — submit-ready? if not, the WORST failing gate first. Any failing
gate caps "ready"; an accept probability alone is not a verdict.>

**Gates at a glance (worst first — mark any failing gate ✗):** readability(persona stalls) <density/verdict> · structure(tighten-paper) <verdict> · claims-honest(claims) <clean?> · defects(panel) <accept-prob/decision> · writing <NN/60> · content(venue bar) <run?/levers>

### SETUP
| id | Work | Skill | Status | Date | Result | Open |
|----|------|-------|--------|------|--------|------|
| idea | Validate idea | research-ideate | ☐ | — | — | — |
| priorwork | Map competitors | map-prior-work | ☐ | — | — | siblings/ |
| venue | Pick venue | find-venue | ☐ | — | — | — |
| venuebar | Venue bar / levers | study-accepted-papers | ☐ | — | — | — |
| **access** | 🔴 **Can you physically submit?** | plan-paper-timeline | ☐ | — | account · profile ACTIVE since <ISO> · portal reachable · form fields known · artifact host known | — |
| schedule | Schedule + calendar | plan-paper-timeline | ☐ | — | — | — |
| **frame** | **Claim stated before the runs** | argument-arc (frame) | ☐ | — | one paragraph: what will this paper claim? | — |

### LOOP
| id | Work | Skill | Status | Date | Result | Open |
|----|------|-------|--------|------|--------|------|
| study | Study + artifact | build-benchmark | ☐ | — | — | — |
| draft | Draft | draft-paper | ☐ | — | — | — |
| arc | Argument arc | argument-arc | ☐ | — | — | — |

### CONTINUOUS
Date = when it last ran. If that predates the current text, the pass is stale — the checker says so.

| id | Trigger | Skill | Status | Date | Result | Open |
|----|---------|-------|--------|------|--------|------|
| cites | any \cite added/moved | verify-citations | ☐ | — | — | — |
| siblings | a sibling surfaces | analyze-sibling-paper | ☐ | — | — | siblings/ |
| priordelta | framing moved | map-prior-work (delta) | ☐ | — | — | — |
| render | any source edit | render-paper + page count | ☐ | — | <N> pages / limit <M> | — |

### GATES
| id | Gate | Skill | Requires | Status | Date | Result | Open |
|----|------|-------|----------|--------|------|--------|------|
| structure | Structure | tighten-paper | render, arc | ☐ | — | — | — |
| writing | Writing craft | grade-paper-writing | draft, arc, structure | ☐ | — | — | — |
| panel | Review decision | pc-panel-review | structure, writing | ☐ | — | — | — |
| claims | Claim preservation | Fable diff | draft, writing | ☐ | — | — | — |
| harden | Harden (all axes) | harden-paper | panel, structure, writing, cites, priordelta | ☐ | — | — | — |
| submit | Submit | submit-paper | harden, access | ☐ | — | — | — |

**Harden sub-axes** (`harden` is an orchestrator — track its axes so `◐` is legible):
structure(=structure) ☐ · threat-model ☐ · ethics/dual-use ☐ · page/word-fit ☐ · de-anon hygiene ☐ · citability ☐ · artifact-runs-clean ☐ · writing(=writing) ☐

### AFTER
| id | Work | Skill | Status | Date | Result | Open |
|----|------|-------|--------|------|--------|------|
| cameraready | Camera-ready | camera-ready | n/a | — | pre-acceptance | — |
| extend | Extend | extend-paper | n/a | — | post-acceptance | — |
```

---

## How to use

- **"Is paper X ready / what's checked?"** → read `<paper-dir>/PIPELINE-STATUS.md`. Report the verdict
  line + any `☐`/`⚠`/`◐` rows. Do not re-derive from chat.
- **After running anything** (here or in a subagent) → update its row before moving on; commit with the
  work.
- **Before submit** → every non-`n/a` row is `☑`, or a consciously-accepted `◐`/`⚠` named in the verdict
  line. **An unrun GATE is not a valid "anti-churn" skip if capacity exists: run it.** Anti-churn covers
  re-polishing prose that already passed a gate, never skipping a gate that never ran. And a **stale
  CONTINUOUS row is worse than an empty one** — it reads as green while being false.
