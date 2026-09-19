---
name: pc-panel-review
description: Use when asking "what would the program committee decide?" / "simulate the reviewers" / "what's this paper's accept probability?" on a drafted paper + artifact. Spawns N independent reviewers with DISTINCT lenses (one actually RUNS the artifact), then synthesizes a PC-chair meta-review into an accept/reject decision, a calibrated probability, and consensus must-fixes. Requires grade-paper-writing's persona stall inventory + tighten-paper's structural verdict as inputs (blocked until they exist — the panel cannot feel reader fatigue on its own). Also has a lightweight single-reviewer VENUE-FIT MODE for a quick CFP-fit spot-check. NOT a single fast defect hunt (paper-adversarial-review), a writing grade (grade-paper-writing), or the full pre-submit gate (harden-paper, which calls this) — this models the PC decision itself.
allowed-tools: [Read, Write, Grep, Glob, Bash, WebSearch, WebFetch, Agent, Skill]
---

<!-- vigiles:sha256:7a702253694609da compiled from skills/pc-panel-review/SKILL.md.spec.ts -->

# pc-panel-review — model the whole PC, not one reviewer

> **Which review skill?** `paper-adversarial-review` = one hostile reviewer, fast defect hunt.
> `pc-panel-review` (you are here) = the whole PC (N independent lenses incl. an artifact-runner) + a
> chair meta-review — the real pre-submission GATE, run LAST. This skill also has a **Venue-fit mode**
> (below): ONE reviewer scoring a named venue's CFP rubric to predict its accept/reject — the quick
> single-lens spot-check (formerly the standalone `venue-review-sim` skill). Reach for Venue-fit mode or
> `paper-adversarial-review` for a fast spot-check; run the full panel (this) for the decision.

## Run me

🔴 FIRST, before any other step:

```
node .claude/skills/paper-pipeline/scripts/announce.mjs pc-panel-review <paper-dir>
```

An advisory pass cannot be observed failing — silence is both its error state and its normal
state — so starting is an event, and events get written down.

The Venue-fit mode gives ONE reviewer's fit score; `paper-adversarial-review` gives ONE defect hunt.
A real decision is made by **2–4 reviewers with different priorities + a meta-review** that weighs
consensus over any single voice. This skill runs that. The payoff over a single review: a **must-fix
is what ≥2 independent reviewers flag** — that filters real blockers from one reviewer's hobbyhorse —
and at least one reviewer **executes the artifact**, which surfaces paper↔artifact mismatches no
prose-only read can.

## How to run it

1. **Get the venue rubric + bar** (fetch the CFP; quote the criteria). Calibrate to the *track*: a
   WIP/short/workshop bar rewards promise and discussion value; a full-paper/top-tier bar demands
   completeness. Do not import top-tier standards into a WIP review.
2. **Collect the two readability/structure artifacts — the panel is BLOCKED without them.** Before any
   reviewer spawns, there must exist for THIS draft: (a) the **persona stall inventory** from
   `grade-paper-writing` (the "Sam" per-section cold read), and (b) the **structural verdict** from
   `tighten-paper` (length / sag / TMI / cut-plan). If either doesn't exist yet, STOP and run those
   skills first.

   🔴 **Invoke them BY NAME with the Skill tool — do not describe the need and hope.** Whether
   `grade-paper-writing` gets selected from its description is **unstable**, and that is worse for a
   hard gate than a low rate would be: identical prompts, identical description, identical roster
   measured **21%** in the morning of 2026-08-08 and **50–54%** the same afternoon, in two
   independently written implementations
   (`../paper-pipeline/repro/2026-08-08-grade-paper-writing-ablation-raw.log`,
   `2026-08-08-parent-replication.log`). Seven rewrites of the description — shorter, negations
   stripped, machinery stripped, persona-only — all landed inside noise, so there is nothing to fix
   in the text. Naming the skill explicitly does not depend on selection at all, so this gate stops
   resting on the one part of the chain that does. Writing "run grade-paper-writing" and leaving the
   invocation to a description match is the failure this line exists to remove.

   Why hard-block: a frontier-LLM reviewer knows every term and cannot feel reader
   fatigue, so a panel scoring on its own felt read will score a bloated, unreadable paper high
   (proven: ~88% accept on a paper the human reader found exhausting). These two artifacts are the
   panel's only legitimate source for the readability/structure signal.
   *(Scorecard: this gate is row **`panel`**, and it declares **`structure`** (tighten-paper) + **`writing`**
   (grade-paper-writing) as its required inputs — `pipeline-check.mjs` reports `panel` marked done while
   either input is missing or newer than it.)*
3. **Pick 3 (or 4) reviewer lenses** that a real PC for THIS venue would field. Menu — choose by fit:
   - **Methods/stats skeptic** — sample size, construct validity, multiple comparisons, overclaims,
     whether the CIs support the claims.
   - **Domain practitioner** — relevance to the CFP, novelty vs the nearest prior work, does the
     finding change behavior, generalizability, fairness/tone toward anyone named.
   - **Artifact / reproducibility reviewer (MANDATORY if an artifact is attached)** — *actually
     `cd` into the artifact and run it*; verify every headline number reproduces; read the code for
     circularity (echoing stored fields vs recomputing); grep all files (incl. data + compiled
     caches) for anonymization leaks; scope the badge (Available / Functional / Reproduced).
   - **Security/ethics reviewer** (security venues) — threat model soundness, responsible disclosure,
     punching-down risk.
   - **Novelty/related-work reviewer** — is the delta over the nearest neighbor explicit; obvious
     uncited work.
4. **Spawn them in PARALLEL, each on a separate model instance** (e.g. Fable via subagent), each blind
   to the others — independence is the whole point. Give each: the paper (`.tex`/PDF), the artifact
   path, the quoted rubric, its lens, **and the two step-2 artifacts (persona stall inventory +
   tighten-paper structural verdict)**. Force a filled review form (below).
5. **Synthesize the meta-review yourself** (PC chair) once all land — see output.

## Each reviewer returns a review form
- Per-criterion score on the venue's scale (map to 1–5 if unstated), one line each, grounded.
- Overall rec (Reject … Strong Accept) + confidence (1–5).
- **Readability's implicit drag — model the halo effect, DRIVEN BY THE PERSONA INVENTORY, not felt
  judgment.** A real reviewer who finds the paper a slog silently loses confidence in the *science* and
  lowers the OVERALL score, while writing "methodology concerns" in the box — the penalty rarely shows
  up as an explicit "clarity" mark. Each reviewer must let prose/structure quality move their overall
  rec and confidence — but the SOURCE of that signal is the handed-in **persona stall inventory +
  tighten-paper verdict**, never the reviewer's own felt read: a frontier LLM knows every term and
  cannot experience reader fatigue, so its felt judgment systematically under-fires. If the inventory
  shows high stall density / walls, or the structural verdict says bloated, the overall score takes a
  real hit even when every explicit criterion passes. Never score a slog as if it read cleanly — that
  is the gap between this sim and a real PC.
- Top 3 issues for PC discussion, ranked, with severity (blocker/major/minor).
- Any must-fix before *they'd* accept (or "none").
- Artifact reviewer only: run outcome (does it execute? every number reproduce? PASS/FAIL per check),
  anonymization verdict, badge scope.
- One-line meta: does this belong at this venue?

## The meta-review (PC-chair synthesis) — the actual deliverable
- **Score table:** each reviewer × each criterion + overall + confidence, at a glance.
- **Decision:** the rec the PC discussion converges on (weight by confidence; a lone low-confidence
  outlier doesn't sink two confident accepts), + a **calibrated accept probability** for this venue
  and edition.
- **Consensus must-fixes:** issues **≥2 reviewers independently raised** — these are the real ones;
  apply before submitting.
- **Single-reviewer flags:** noted, triaged (fix if cheap, else defer to camera-ready).
- **Split calls:** where reviewers genuinely disagree, and which way the chair leans + why.
- **Pre-submission checklist:** the surgical edits, ranked, that move the probability most.

## 🔴 The ceiling is not a sentence — it is a PLAN, and the panel writes it

**The corpus owner, 2026-08-05: "weak accept doesn't work for us. skills should suggest what to do to fix
the situation."** He is right that this was missing. Three panels in a row named the same ceiling, it was
faithfully recorded three times, and it never once became work. The fourth panel named it again — and
the author wrote all three of its prongs off as *"facts, not worth chasing before the deadline"*. Two
of the three were closed by an hour of editing that same afternoon.

So a panel that reports Weak Accept or Borderline **must** end with a ceiling plan: every prong
classified, no exceptions, using exactly these three labels.

| label | means | what the panel owes |
|---|---|---|
| **TEXT** | an edit closes it — the evidence already exists and the paper fails to join it up, frame it, or show the reader what the alternative would look like | the actual sentence or paragraph to write, and where it goes |
| **EXPERIMENT** | only new measurement closes it | what would have to be run, and a rough cost, so the decision to skip is informed |
| **IMMOVABLE** | it is what the work *is* — the scope, the population, the yield | say so plainly, so nobody re-opens it next round |

**Why the labels and not prose.** "This is a fact about the work" is the cheapest thing a reviewer can
write and the hardest to argue with, so it is where an unwilling author hides. Forcing a label makes
the claim falsifiable: *TEXT* invites "then write it", and *IMMOVABLE* invites "is it really?".

**Two failure shapes to check yourself against**, both observed on `the reference paper`:

- **A number reported as a rate when it is a floor.** "8 contradictions in 1,836 repositories" read as
  a small phenomenon; the same paper measured its own extractor's recall at under half, and never
  joined the two. That is TEXT, not EXPERIMENT.
- **A position on a ladder given without the rungs above it.** "Ours reaches rung three of four" reads
  as a shortfall until the paper says what rungs one and two would require and that nobody has built
  them. Also TEXT.

🔴 **A deadline is a constraint on how much you rework, never an argument for the current form.** If
the author invokes it against a TEXT prong, that is the failure this section exists to catch.

**Enforced** by `skills/paper-pipeline/scripts/pipeline-check.mjs` → `ceiling-unplanned`: a ceiling recorded
in the scorecard whose prongs carry none of the three labels is a finding.

## Record the verdict

🔴 LAST step, once the deliverable exists:

```
node .claude/skills/paper-pipeline/scripts/ledger.mjs record pc-panel-review <paper-dir> FINDING <count> <report-path>
node .claude/skills/paper-pipeline/scripts/ledger.mjs record pc-panel-review <paper-dir> ABSTAINED <reason> "<one line>"
```

**FINDING** — `<count>` is the number of **consensus** must-fixes (flagged by ≥2 independent
reviewers, not the union of everything anyone said), `<report-path>` is the meta-review. Add
`--blocking` when the chair's decision is reject.
**ABSTAINED** — `blocked`: the panel never ran because its required inputs (the persona stall
inventory, the structural verdict) do not exist. `no-witness`: the panel ran and reached no
consensus must-fix.

🔴 **THIS IS THE SKILL THE DELETION OF `PASS` WAS WRITTEN FOR.** Five model reviewers from one
vendor agreeing was being recorded as an acquittal — and correlated agreement between instances of
one model is not independent evidence of anything. There is now no constructor that can say it.
"Accept with no must-fix" is `ABSTAINED no-witness`: the panel produced no finding, which is a fact
about the panel and not a fact about the paper.

🔴 **The `blocked` row is the one that matters most here.** A blocked panel and a panel nobody
launched read identically in prose, and on 2026-08-04 a status line said the panel was running when
it had never been launched at all. Record the block; do not leave the check silent.

Venue-fit mode records under the same skill name with the fit verdict and `<count>` 0 — it is one
reviewer's spot-check, and its row should not be mistaken for the panel's decision.

## Rules
- **Independence is non-negotiable** — never let reviewers see each other's reviews before the
  meta-review; shared context collapses the panel into one voice.
- **Consensus > volume.** One reviewer with ten nits loses to two reviewers naming the same blocker.
- **The artifact reviewer must actually run the code**, not read about it — that lens exists to catch
  what prose review can't (dead links, circular self-checks, paper↔artifact number mismatches, leaks).
- Judge against the venue's ACTUAL bar; reward fit/discussion-value for workshops.
- Report the run honestly — if the artifact fails or a number doesn't reproduce, that IS the finding.
- Don't fabricate the CFP or citations; fetch/verify.
- **Review-ratchet rule — when the panel's must-fixes include an overclaim, inline-hedging is the LAST
  resort.** Tighten → cut → move to Threats → only then hedge; and run `tighten-paper` after the round
  to strip what it deposited. Full rule, with the cost of skipping it:
  `paper-pipeline/references/review-ratchet.md`.

## Venue-fit mode (single-lens spot-check — the merged `venue-review-sim`)
When a full panel is overkill and you just want to predict **"given THIS venue's criteria, bar, and
culture, would a real reviewer accept it, and what scores?"**, run **one** venue-fit reviewer scoring
the specific CFP rubric — the fast fit-prediction lens (this absorbs the former standalone
`venue-review-sim` skill). It answers a different question than the defect hunt: fit-to-CFP and matching
the venue's expectation (a WIP workshop short paper vs a top-tier full paper) decide most workshop
outcomes, often more than raw defect count.

Run it:
1. **Fetch the venue's actual review criteria** — the CFP topics, paper types, stated review criteria,
   workshop goals, blind model. Quote the exact criteria. If none stated, use the venue-class default
   (workshops: relevance / originality / technical quality / clarity; security venues add threat-model
   soundness + ethics). Do NOT fabricate the CFP — fetch it; say when you fall back to the default.
2. **Adopt the reviewer persona for THAT venue** — a PC member who knows the sub-field, cares about the
   workshop's goals (e.g. "foster discussion", "bridge research–practice"), and calibrates to the paper
   TYPE (a short/WIP/position paper is judged for promise and discussion value, NOT the completeness
   demanded of a full paper — don't reject a WIP for "only 2 tools" if the venue invites WIP).
3. **Use a separate model as the reviewer** (e.g. Fable via subagent) so the author isn't grading
   itself. Give it the full paper text + the quoted CFP criteria.

Output — fill the venue's review form:
- **Per-criterion score** on the venue's scale (map to 1–5 if unstated), one for EACH stated criterion,
  each with a one-line justification grounded in the paper.
- **Overall recommendation** (Accept / Weak Accept / Borderline / Weak Reject / Reject) + **reviewer
  confidence** (low/med/high).
- **Fit-to-CFP**: which listed topics it hits, and whether the framing foregrounds them (a
  trustworthiness/verification workshop wants that word in the abstract).
- **Type-appropriateness**: is it pitched right for its track (WIP/vision/position/short vs full)? Call
  out over-reach for a short paper or an under-sold real contribution.
- **What the PC discussion would say** — the 2–3 meta-review sentences that decide it, as a PC chair
  would summarize.
- **Minimum changes to flip a borderline to accept** — the specific, venue-relevant edits (often:
  foreground the on-topic framing, right-size claims to the track, add the one obviously-expected
  citation) — NOT a full defect list.
- **Predicted outcome + probability**, calibrated to the venue's selectivity and edition (first-edition
  workshops are more welcoming; established ones more competitive).

Rules: judge against the venue's ACTUAL bar and goals, not an abstract ideal; reward fit and
discussion-value for workshops, reserve full-paper rigor for full-paper tracks; be honest about
reject-risk without rubber-stamping. For the real decision, escalate to the full panel below.

## Compose with
- `paper-adversarial-review` (defect hunt) as an *input* — this skill is the layer above it (and above
  its own Venue-fit mode). Run the full panel LAST, after a hardening pass, as the final pre-submission
  gate.
- Append each panel's result to the paper's review ledger
  (`papers/research/<date>-fable-rereview-<venue>.md`) so accept-probability progression is tracked
  across rounds.

## The reproduce loop (why this beats a prose review)
This is "double-blind review as a real venue does it, WITH reproduction." The artifact-runner reviewer
is the difference-maker on both runs so far: it doesn't judge the paper's numbers, it re-derives them.
Run the panel, apply the consensus fixes, then **re-run the panel** (same lenses, told what changed) to
confirm the fixes landed and nothing regressed — the artifact-runner re-executes every harness each
round. Track the accept-probability progression in the review ledger. Stop when the panel converges to
accept and the artifact reproduces clean; don't loop past one confirming round.

## Provenance (two papers, battle-tested)
- **AgenticDev 2026** (2026-07-12): 3 lenses (stats / practitioner / artifact-runner) + chair. Caught
  what two prior single-lens rounds missed — a paper↔artifact mismatch ("raw 140-run data" vs shipped
  per-arm aggregates) and a mislabeled "paired" test, both flagged by ≥2 reviewers. Round→confirm:
  ~85%→90%.
- **AISec 2026 @ CCS** (2026-07-13): same shape at a harder (top-tier security) bar. The artifact-runner
  ran all four harnesses AND stress-tested the release gate (planted a leak, confirmed it caught it);
  the ethics reviewer caught the release-vs-paper anonymization contradiction (the released artifact
  named 46 maintainers) — the single highest reject-vector, invisible to a paper-only read. After the
  fixes + a confirm round, all three moved to Accept (~87–88%, from Weak-Accept/conditional/leak-risk).
  Lesson: the two things that most move a security paper — an ethics/disclosure contradiction and a
  reproduction/anonymization leak — live in the ARTIFACT, so the artifact-runner + an ethics lens are
  non-optional at security venues.
