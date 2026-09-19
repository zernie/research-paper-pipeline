# CLAUDE.md — research-paper-pipeline

Machine-checkable gates for writing a research paper in git, extracted from a private
knowledge base.

## 🎯 THE GOAL, in one sentence

**Move every paper-writing convention a machine can decide OUT of prose and INTO an engine
that fails the build** — and keep everything else honestly labelled as prose. The engine is
ESLint. The unit of progress is "one more verdict decided by the engine instead of by a
hand-written script".

That last clause is the whole direction, and it is the part that keeps being forgotten:

```
 prose in a guideline   →   hand-written script   →   ESLint rule in the engine
 rots silently              runs, but is OURS         editor-time · free AST · suppressible
 ← where this started       ← where most of it is     ← where it is going
```

🔴 **A hand-written script is a WAYPOINT, not a destination.** Writing a new one is allowed
only when the engine genuinely cannot express the check — and "cannot" means MEASURED, not
assumed. Two things that sound like limits and are not:

- *"ESLint only sees one file"* — true of its AST, false of the rule: a rule is an ordinary
  JS module and may call `execFileSync("git", …)` or read a sibling file. If the reason to
  stay a script is "it needs git", that reason is weak; measure the real cost before using it.
- *"this runs programs, not lints files"* — that is a real limit, and the answer is the seam
  already proven here: **a script PRODUCES facts into a JSON file, and ESLint JUDGES that
  file.** The verdict lands in the engine even though the work did not.

## 📊 STATE — measured 2026-09-16 (re-measure, never cite)

| | |
|---|---:|
| ESLint rules | **5** — `latex-language` · `tex-build` · `papers` · `review-findings-cause` · `doc-fields` |
| harnesses | **57** |
| mutation batteries | **34** |
| skills | **24** |
| hooks (runnable `.mjs`) | **5** |
| repo-wide scripts | 5 |
| files tracked / commits | 308 / 43 |

**A real consumer dogfoods this package on every CI run**, so a breaking change here turns a
paper pipeline red somewhere else the same day. That is deliberate — it is the only thing
keeping the extraction honest.

⚠️ **This table is a SNAPSHOT, not a fact about today, and it has already gone stale once.**
The line standing here until 2026-09-16 said "two ESLint rule modules" while six were shipped,
24 skills had moved in, and hooks existed at all. Re-measure with `git ls-files` before
repeating any number from it.

## First command in a fresh container

```bash
npm install
```

Not optional and not "when something breaks": `vigiles` is a real dependency, and every
harness, spec and hook resolves through it. A container where `npm install` never ran fails
in ways that look like broken code rather than a missing install.

## The ten rules that decide what may live here — and what may not be written

**1. Mechanism goes to vigiles, data stays here.** A file that names nothing local — no rule
of ours, no fixture of ours — is machinery, and machinery belongs in
[vigiles](https://github.com/zernie/vigiles). Ask it in two steps: is this mechanism or data?
If mechanism — does it know about *this* domain? If not, it is not ours.

**2. A check over an AST is a LINT RULE, not a script.** If it walks `.ts`/`.js`/`.tex` and
looks at declarations, names or nodes, write an ESLint rule: it fires in the editor on save,
gets the AST for free, and has a suppression syntax people already know. Scripts are for
corpus-wide questions — index connectivity, ratios across many files — not for one file's
nodes.

**3. Every check needs BOTH halves, or it is not tested.** It must FIRE on a planted defect
and stay QUIET on a clean fixture. A check that has only been seen quiet is
indistinguishable from a dead one — silence is its success state. Prove the fire half with a
mutation, and assert the patch actually landed before trusting a green run.

**4. `exit 0` with empty output is NOT "clean".** A rule whose glob matched no files reports
exactly like a rule that passed. Any rule shipped here must be loud when its input set is
empty. This is the specific defect that blocks stage 1 of the plan: in the source base a
fresh clone yields RC=0, 652 findings, zero errors — because 19 rules saw no files at all.

**5. "It can't be done in the engine" must be MEASURED, not assumed.** Every one of these was
stated confidently on 2026-09-16 and every one fell to a single command:

| the claim | what one command showed |
|---|---|
| "a lint rule can't know a git date, so this stays a script" | a rule is plain JS; `execFileSync("git", …)` is legal in it. The real costs (per-file invocation, `--cache` keyed on content) are solvable, so this was a preference dressed as a limit |
| "we need our own glob expander" | `fs.globSync` ships in Node 22 and returned the identical set. 31 hand-written lines of regex existed for nothing |
| "the tool can't run a file that config excludes" | it can, and says so: `matches exclude … — running because you named it` |

⇒ Before writing machinery, **run the thing you are about to replace and paste its output.**
"I couldn't get it to work" is data about the attempt, not about the tool.

**6. A program shipped by this package MUST NOT depend on the consumer's cwd.** Measured
2026-09-16: three hooks here read their config as `provide("pkg", "cat package.json")`. The
consumer's session changed directory into a subfolder for unrelated reasons, `cat` failed, and
the Bash gate — which fails closed, correctly — denied **every command in that session**,
including the one that would undo it. The nudges next to it would have failed *silently*,
which is worse.

Resolve paths from the repository root (`git rev-parse --show-toplevel`) or from the module's
own location, never from where the caller happens to stand. The blast radius of a cwd
assumption is not this package — it is somebody else's whole session.

**7. Do not describe what you have not opened.** A `README` here nearly shipped the line
"MIT — see LICENSE" on 2026-09-16. There is no `LICENSE` file and `package.json` says
`UNLICENSED`. Publishing is irreversible and this repo is public: every factual claim in a
document meant for strangers gets checked against the disk in the same pass that writes it.

**8. 🔴 NEVER WRITE A GLOB OR A REGEX INSIDE A BLOCK COMMENT.** An asterisk followed by a
slash **ends the comment**, wherever it appears — in a path (a folder wildcard), in a regex
whose last literal is an asterisk (one matching bold markup, for instance), in a quoted
example. The rest of the comment becomes code, the file stops parsing, and the error points
at a line further down that is perfectly fine.

⚠️ Note this rule does not quote the sequence either, not even here. A documented example is
the thing that gets copied into code — and that is exactly how the fourth occurrence
happened: it was copied out of a comment written to explain the first three.

This is not a hypothetical and not a rare slip. **It fired four times in a single session on
2026-09-16** — three in the consumer, once here — and each time the diagnosis cost minutes
because `SyntaxError: Unexpected token '.'` says nothing about comments.

| instead of | write |
|---|---|
| a glob with an asterisk and slash | spell it: "every folder under papers" |
| a regex with an asterisk before a slash | describe what it matched, in words |
| an example needing both | put it in a line comment (two slashes), never a block |

⇒ **In a block comment, prose describes the pattern; it never quotes it.** If the exact
characters matter, they belong in the code or in a line comment beside it.

**9. Measure the DEFECT before proposing the fix — and read "this is quick" as a warning.**
Rule 5 is about the tool you are replacing; this one is about the order of work.

1. **Show the defect**: command output, or a file quote with a line number. A proposed fix with
   no exhibited defect is not a fix, it is a preference.
2. **Name the layer and the channel** it touches: ESLint rule · skill · hook · CLI · CI action
   · path resolution. More than one is a conversation, not a commit.
3. **An adversarial second pass is encouraged, and it is not free.** Spend it on a fork in the
   road, on anything that goes outward, and on a conclusion you are about to act on.
4. **A quick fix is almost never quick** — it is quick to *propose* precisely because nothing
   was opened.

Four proposals were made and withdrawn in one session on 2026-09-17 for exactly this reason —
[`docs/incidents.md`](docs/incidents.md).

**10. The only impure thing in this package is WHERE IT IS INSTALLED — and it lives in ONE
module.** Rule 6 generalised: the caller's cwd is one case of it. Checking logic — lint rules,
skills, hooks — must not know its own location, nor its distance from anything else. Every
answer to *where* comes from `lib/consumer.mjs`, which adapts per channel: own checkout ·
`node_modules` · plugin cache · CI. A skill naming a script by an install-specific path in its
own prose walks around that door, and 208 such literals across 190 lines do exactly that.

⚠️ Deliberately NOT full hexagonal architecture, and that is a decision: there is no database or
service to swap, and the lint rules are already pure functions over an AST, so ports around them
would be ceremony with no subject. One thing here is impure, so one thing gets a port.

⏳ **The mechanical half is owed and is the point**: a lint rule that makes an install-specific
path literal outside the port a finding. Prose will not hold this class — four silent breakages
happened *while* comments explaining the hazard sat directly above the code
([`docs/incidents.md`](docs/incidents.md)).

## Before changing the command surface or a delivery channel — read the prior art

[`docs/prior-art/`](docs/prior-art/README.md) records how comparable tools solved the same
problems, each claim with the URL that was checked: Quarto and Vale (the domain and content
analogues), Biome (one tool, one config, one command), Danger and reviewdog (who decides to
fail a run), `unicorn/expiring-todo-comments` and Semgrep (checks that read a clock or a diff).

It is here as a POINTER and stays a pointer: this file is read on every turn, so it carries
the instruction and never the evidence — the same split as rules 9 and 10 and `docs/incidents.md`.

🔴 The argument "we need another command for X" is, in every tool examined, an argument that
the CONFIG is not declaring something. Check that before adding a verb.

## Distribution — no `smh init`, and that is a measured decision (2026-09-10)

Considered: a `research-paper-pipeline init` command that installs the ESLint config and the
Claude plugin in one shot, the way `vigiles init` does. **Rejected for now**, and the reason is
worth keeping so it is not reopened.

**What makes `vigiles init` earn its existence** — read from its own implementation, not guessed:

```
Scanning linters and project files...
  <linter>: <N> rules
✓ Generated .vigiles/generated.d.ts
✓ Generated .vigiles/schema.json (YAML-LSP frontmatter schema)
```

It **generates artifacts by measuring the repo it lands in** — TypeScript types for the rules
*that project* actually has. That is work no template can do, so a command is the only way to do it.

**This repo has nothing of that shape yet.** Five rules, no per-project configuration, nothing to
derive from the host repo. An `init` here would copy files — and copying files is exactly what the
two standard channels already do, for free:

| what ships | channel | user's side |
|---|---|---|
| **all code** — rules, skills, hooks, scripts | an npm package | `npm i -D research-paper-pipeline` |
| **hook wiring only** | the plugin in `plugin/` | `/plugin marketplace add <owner>/<repo>` then `/plugin install` |

🔴 **THE PLUGIN CARRIES NO CODE, AND THAT IS THE DESIGN — measured 2026-09-17.** Claude Code runs
`npm ci --ignore-scripts` for a plugin *"only when the plugin's root directory contains both a
package.json and a supported lockfile"*, with a 60-second timeout, and *"a failed or skipped
install never blocks the plugin"*. Until today the marketplace pointed at `"source": "./"` — the
repository root — which holds a lockfile of **251 packages**, there for the ESLint rules and of no
use to a hook. A slow network therefore produced a plugin that loaded with a partial tree and hooks
that failed with `cannot find module vigiles`, silently.

`plugin/` has no `package.json`, so that install does not run at all. Its `hooks/hooks.json` points
at the consumer's own npm copy through `${CLAUDE_PROJECT_DIR}` — the same command a consumer used to
paste by hand, now written by the plugin. `vigiles/hook` resolves upward from
`node_modules/research-paper-pipeline/hooks/`, which is the contract documented below.

⚠️ **Two manifests now exist and neither is stale.** `plugin/.claude-plugin/plugin.json` is what
people install. The one at the repository root stays because the skill **eval** tier needs a
complete plugin at the root (`pluginDir` in `lib/skill-eval-kit.mjs`) — it is a local test fixture,
not a delivery channel, and the marketplace no longer points at it.

⚠️ **Skills do NOT travel through the plugin, deliberately.** They name their scripts by an
install-specific path (208 literals, issue #19), so a plugin-only consumer would install skills whose
first command fails. They ship with the npm package, where those paths resolve. When #19 lands, the
plugin can carry them too.

🔴 **THE TWO ROWS ARE NOT INDEPENDENT, AND THE TABLE READ AS IF THEY WERE** (issue #8, counted
again 2026-09-17). The marketplace row needs no npm — that is true of the CHANNEL and false of
what travels through it:

```
$ ls skills/*/SKILL.md | wc -l                      24
$ grep -l "paper-pipeline/scripts" skills/*/SKILL.md | wc -l   23
```

Twenty-three of twenty-four skills name `paper-pipeline/scripts` in their own prose — the paths
the model is told to run. Those resolve through the symlink into
`node_modules/research-paper-pipeline/`, i.e. back through the npm channel. The single
self-contained skill is `osf-artifact-upload` (52 lines, talks only to the OSF API).

**So a consumer who installs the plugin and nothing else gets 24 skills of which 23 point at
scripts that are not there.** Nothing fails at install time; it fails later, in the middle of a
session, as a path that does not exist.

⚠️ **This is a statement of fact, not a plan.** Making the marketplace channel genuinely
standalone means either vendoring the scripts into every skill (24 copies of the thing this
package exists to have ONE of) or rewriting 23 skills to call a binary that the npm package
provides. Both are real work with real trade-offs; neither is done. Until one of them is, the
honest instruction is the table above: install both.

Both are measured, not assumed: `vigiles` and `Imbad0202/academic-research-skills` (47k stars) both
ship `.claude-plugin/marketplace.json`, and ARS advertises install as two commands.

🔴 **The condition that would flip this decision:** the moment something must be *derived* from the
host repo — detecting the venue/format of the paper and enabling the matching rule set, or reading
an existing `.tex` to decide what to check. That is generation by measurement, and it is what a
command is for. Until then, a hand-written `init` is work that npm and the plugin marketplace are
already doing.

## Delivery — how this repo's contents reach a consumer (measured 2026-09-11)

Three channels, each measured on a fixture rather than assumed. The consumer here is the
private knowledge base this was extracted from; nothing below is specific to it.

### Skills ship as `skills/`, and the consumer SYMLINKS them

**Do not move skills to `.claude/skills/` inside this repo.** `plugin.json` points at
`./skills/` and that is the correct, standard layout — `plugins-reference.md` is explicit:

> **Correct structure**: Components must be at the plugin root, not inside `.claude-plugin/`.
> Only `plugin.json` belongs in `.claude-plugin/`.

An ecosystem scan of 855 npm packages (by published tarball, not repository) found
**336 shipping `skills/<n>/SKILL.md` against 15 shipping `.claude/skills/`** — 22 : 1. The
top of the market is entirely on `skills/`: `@vitejs/devtools-kit` (330 896 downloads/wk),
`@slidev/cli` (56 809), `anthropics/skills` (175 673 stars).

🔴 **And the wrong layout fails SILENTLY.** With `skills: "./.claude/skills"` the official
`claude plugin validate` prints `✔ Validation passed` and checks **zero** skills — no
`Validating skill:` line, exit 0 ([claude-code#87004](https://github.com/anthropics/claude-code/issues/87004)).
The same files under `./skills` produce a real finding. That is rule 4 of this file
(`exit 0` with empty output is not "clean") landing in someone else's tool.

**The consumer's side is a symlink per skill:**

```
<consumer>/.claude/skills/<name>  ->  node_modules/research-paper-pipeline/skills/<name>
```

⚠️ The skill's name in the listing comes from the **link directory's name**, not from
`name:` in the frontmatter — so the link must be named exactly as the skill.

⚠️ Do NOT rely on a consumer picking `.claude/skills/` up out of `node_modules` on its own.
It does happen — such a directory is an ordinary nested one — but only **lazily and
silently**, the first time the agent happens to read a file inside that package. A symlink
loads at startup, deterministically. Measured both ways on claude 2.1.268.

### Hooks ship as `.mjs`, NEVER as `.hook.ts`

Measured on a fixture — one hook, four locations, both halves (an input that must be denied
and one that must pass), exit code taken without a pipe:

| hook location | deny input | allow input |
|---|---|---|
| `node_modules/<pkg>/.claude/hooks/probe.hook.**mjs**` | RC=2, fires | RC=0, silent |
| symlink into `node_modules`, `.mjs` | RC=2, fires | RC=0, silent |
| local control, `.mjs` | RC=2, fires | RC=0, silent |
| `node_modules/<pkg>/.claude/hooks/probe.hook.**ts**` | RC=2 `cannot be loaded` | **RC=2 `cannot be loaded`** |

The last row is not "it blocks the dangerous thing" — it fails to load and therefore blocks
**everything**, including `echo hi`. A consumer in that state cannot run any Bash command,
and the one command that would repair it is also Bash.

⇒ **The package ships `.mjs`** — the consumer gets something that loads.

(Not established: *why* the TypeScript loader refuses a path inside `node_modules`. The real
cause is swallowed by a `catch` in vigiles' `hook-runtime.js`, and calling `loadHookProgram`
directly measures a different load path — it fails even on the control. Knowing *that* is
enough to choose the carrier.)

#### 🔴 CORRECTED 2026-09-12, when the first three hooks actually moved: THERE IS NO `.hook.ts` TWIN

This section used to promise «the `.hook.ts` source lives HERE and is typechecked HERE; the
package ships the compiled `.mjs`». Shipping the first three hooks retired that plan, and the
reason is worth keeping: **a twin can drift from its build, and nothing would notice.** One file
cannot.

What the twin was for was the CAPABILITY CHECK — `vigiles compile` refuses a hook that imports
anything but `vigiles/hook`, because the import list *is* the capability surface. That check is a
function, `checkHookImports`, and `hooks/hooks.harness.mjs` runs it over every shipped
`.hook.mjs` directly. Same check, applied to the artifact that actually executes, with no second
file to keep in step. What is lost is `tsc` on the hook body and the typed `e.ctx` — named here
rather than left as an omission.

⚠️ **`checkHookImports` IS A TEXT REGEX, so it counts an import-shaped sentence in a COMMENT.**
Measured 2026-09-12: the check failed on `paper-edit-guard.hook.mjs`'s own docblock, which quoted
a rejected import while explaining why it was rejected. Do not loosen the check to make prose
fit — it is the same check any future `compile`/`lint` pass applies to the shipped file. Describe
a forbidden import in words instead of writing one.

#### 🔴 AND NOT A THIN SPEC IN THE CONSUMER EITHER — measured, and it is the form that looks right

The obvious alternative is a small `.hook.ts` in the consumer that pulls the decision logic out of
this package. It RUNS — deny input RC=2 with the reason, allow input RC=0 and silent — and it
cannot be maintained:

```
$ npx vigiles compile
✗ .vigiles/hooks/probe.hook.ts — hook program uses capabilities outside `vigiles/hook`:
  <pkg>/hooks/decide.mjs — only the sanctioned API is allowed (capability = API surface).
```

`compile` is also what writes the tamper-evident stamp, so a hook it refuses **can never be
re-stamped** — and the runtime fails CLOSED on a stamp that no longer matches its source:

```
vigiles: hook … does not match its compiled stamp (tampered).
… the way out is a FILE WRITE, not a command — this refusal blocks the recompile too.
```

Measured end to end: editing such a file makes the gate refuse `echo hi`, and the only steady
state is clearing the stamp to `{}` and running permanently unstamped. Shipping the whole program
keeps the stamp question from arising (no sidecar ⇒ no check) and pins the source by lockfile
integrity instead — stronger than a local stamp, since a consumer cannot hand-edit an installed
tree without the next install reverting it.

#### How a consumer wires a shipped hook

`.claude/settings.json`, one block per hook, pointing straight into the install — no symlink and
no compile step on the consumer's side:

```json
{ "type": "command",
  "command": "node \"$CLAUDE_PROJECT_DIR/node_modules/vigiles/dist/cli.js\" hook-runtime run-program \"$CLAUDE_PROJECT_DIR/node_modules/research-paper-pipeline/hooks/paper-edit-guard.hook.mjs\"" }
```

⚠️ **A shipped hook cannot import a sibling module of this package** — capability closure being
the point — so the papers-root resolver is spelled out in all three hook files. Duplication that
cannot be removed is CHECKED instead: part VII of the harness compares the captured values
against each other, rather than grepping for a literal (a substring search finds the same text in
the prose *about* the value one line above it).

### `vigiles` is a devDependency, and its pin is TIED to the consumer's

`vigiles/hook` resolves **upward** from a hook inside a package — measured:

```
resolve OK -> <consumer>/node_modules/vigiles/dist/hook.js
```

So this package needs no copy of its own at the consumer's runtime; it needs `vigiles` only
for its own `vigiles test` and `vigiles compile`. That is `devDependencies`, which `npm i` of
a dependency does not install. Putting it in `dependencies` risks npm installing a **second**
copy under `node_modules/research-paper-pipeline/node_modules/vigiles` whenever the ranges
drift — two runtimes, two sets of stamps and state.

🔴 **THE PARAGRAPH ABOVE WAS TRUE AND THE INSTALL DID THE OPPOSITE — measured 2026-09-17.**
`devDependencies` is not the only entry naming `vigiles`: `peerDependencies` names it too, and
**npm 7+ installs peers automatically**. So every consumer got it anyway, together with its
transitive weight. `npm pack`, then install the tarball into an empty project:

| | packages | `du -sm node_modules` |
|---|---:|---:|
| peer as declared before | 188 | **142 MB** |
| `peerDependenciesMeta: { vigiles: { optional: true } }` | 164 | **56 MB** |

The 86 MB are `@ast-grep/napi` (51 MB) and `typescript` (23 MB), pulled through `vigiles` — and
paid for by a consumer who only wants the ESLint rules and never loads a hook.

`optional: true` is the entry that matches what this section already argues: the consumer brings
its own `vigiles` *when it uses the hooks*, and npm stops deciding that for them. Both halves
measured on the 56 MB tree: `eslint-rules/latex-language.mjs` and
`skills/paper-pipeline/scripts/pipeline-check.mjs` load and run (RC=0), while
`hooks/paper-edit-guard.hook.mjs` fails with `ERR_MODULE_NOT_FOUND` — which is this contract
working, not a defect, exactly as argued below.

⚠️ The consumer in this project's own base is unaffected: it declares `vigiles` itself
(`devDependencies: ^27.2.0`), so nothing about its tree changes.

### The `.bib` parser is optional for the same reason, and the failure says so out loud

`@retorquere/bibtex-parser` is imported at exactly one site
(`skills/paper-pipeline/scripts/extract-ref-facts.mjs`, and already through a dynamic
`await import`), and it costs **15 MB of a 56 MB tree**: 9 MB itself, plus
`wink-eng-lite-web-model` (4 MB, an English NLP model) and `unicode2latex` (2 MB). That is 27%
of the install for one call that only a consumer extracting bibliography facts ever makes.

| | packages | `du -sm node_modules` |
|---|---:|---:|
| after the `vigiles` peer was made optional | 164 | 56 MB |
| parser moved to an optional peer as well | 149 | **39 MB** |

🔴 **`optionalDependencies` is the wrong entry and was tried first** — npm *installs* those and
only tolerates failure, so the weight stays. What makes a dependency genuinely opt-in is
`peerDependencies` + `peerDependenciesMeta: { optional: true }`, the same pair used for `vigiles`.
It stays in `devDependencies` too, because this package's own harnesses parse `.bib`.

⚠️ A silent skip here would be the worst outcome: a missing checker and a passing one look
identical, and "the bibliography was not checked" reads as "the bibliography is fine". So the
absence throws, and the message carries the cure rather than the diagnosis:

```
parsing .bib requires @retorquere/bibtex-parser — it is declared OPTIONAL because it weighs 15 MB…
   Install:  npm i -D @retorquere/bibtex-parser
   Why not our own regex: measured 26.08 — the regex gave 0 entries on both real files…
```

🔴 **Therefore the pin here and the pin in the consumer move TOGETHER, in one pass.** A major
mismatch means a hook compiled by one version is executed by another: the stamp does not
verify, the hook does not load, and `PreToolUse` refuses every command. That already happened
in the consumer on 2026-09-10 (25.1.0 -> 27.1.4) and cost real recovery work.

```bash
npm ls vigiles    # prints `invalid` when what is installed does not satisfy the manifest
```

⚠️ **What that command does NOT tell you, and the boundary matters because the command reads
like a freshness check.** It compares what is INSTALLED against this repo's MANIFEST. It says
nothing about the registry. Measured 2026-09-16: manifest `^27.1.4`, installed `27.1.6`,
published `27.2.0` — exit code **0**, because the range is satisfied. The repo had been one
minor behind for days and every local check was green.

#### Dependabot carries the half `npm ls` cannot — and its two delays STACK

That staleness is why `.github/dependabot.yml` exists here. The reasoning is worth keeping
because the obvious objection to a bot in this org is already recorded and does NOT apply:
a bot was switched off in a sibling repository for burning Actions minutes — **that
repository is private**. This one is public, minutes are free, so the objection does not
travel. If this repo is ever made private, revisit the file along with it.

🔴 **A new release does NOT wake the bot.** Two delays add up, and the second one is invisible
until you read the reference:

| | default | what the docs say |
|---|---:|---|
| `schedule.interval` | — | the check runs on the schedule and only on the schedule |
| **`cooldown`** | **3 days** | *"a new version is not considered for a version update until 3 days after its release"* |

With the weekly schedule this file shipped with first, the window was **3–10 days**. It is now
`daily`, and `vigiles` is listed in `cooldown.exclude`, so for THIS package the window is one
schedule tick.

**Why `vigiles` and nothing else is exempt:** the cooldown guards against a release that gets
yanked hours later. That is a real risk for a third-party package and an empty one for our own
— we would be the ones yanking it, and we can ship several versions of it in a single day, so
a three-day hold would have the bot proposing the version from the day before yesterday.

🔴 **And the conclusion is bigger than a cadence knob: for our OWN package no bot schedule is
the primary path, because no schedule can outrun same-day releases.** The primary path is the
rule already recorded in the consumer's base — merge a PR in `vigiles`, bump every consumer in
the same pass. The bot is the backstop for the case that actually bit us: the rule named ONE
consumer while there were two, and this repo sat forgotten on `^27.1.4`.

⚠️ **What the file does not control**, recorded because the sibling repo already lost a day to
it: `dependabot.yml` configures *version* updates only. **Security** updates are a separate
mechanism driven by advisories and a repository SETTING; their cadence cannot be changed from
this file, and deleting the file would not stop them.

Need it now rather than at the next tick: **Insights → Dependency graph → Dependabot → Check
for updates**.

## The guard against a green zero

Rule 4 is enforced, not asserted: `scripts/rules-see-files.mjs` loads `eslint.config.mjs`,
lints the repository, and asks ESLint for the effective config of every linted file. A rule
enabled for **zero** files is named and the script exits 1.

```bash
npm run check:globs
```

It is per RULE, not per glob, and that distinction is the point: a rule can be enabled in one
block whose glob is empty while a different block is busy, so "some glob matched something" is
not evidence about the rule you care about. Both halves are tested
(`scripts/rules-see-files.harness.mjs`) and both directions are mutated
(`scripts/rules-see-files.mutations.mjs` — under-reporting and over-reporting must die on
*different* assertions, or only one half of the guard is really tested).

## Mutations

```bash
npm run test:sabotage    # 12 + 11 + 2, each with a "the patch landed" assertion
```

A green harness under a mutation is a finding about the TEST, not a conclusion about the
defence. Each battery prints the harness line and the assertion text its mutation died on;
"killed" without saying by what is half an answer.

## Cost

⛽ **This repository is PUBLIC, so its Actions minutes are FREE.** Verified against the API on
2026-09-17: `"private": false`, `"visibility": "public"`, and three active workflows — `ci`,
`dependabot auto-merge`, and Dependabot's own updates runner.

🔴 **This paragraph said the exact opposite until now, and the correction is the lesson, not the
fact.** It read «This is a **private** repository … Until then there is no CI here, and that is
deliberate» — both halves false, and false in the file an agent loads FIRST. The flip to public
happened on 2026-09-12 and *was* recorded, at `.github/workflows/ci.yml:8-9`, which is a file
nobody opens before deciding whether there is any CI to check. Reported as issue #6.

⚠️ So the rule this leaves behind is about WHERE a correction lands: a measurement written into
the artifact it describes is not written down for the reader who needs it. **Status that changes
what a session DOES belongs in this file**; the workflow header can carry the detail.

What stays true, because the reasoning outlives the flip: minutes on a **private** repo come out
of the account-wide 3000/month shared with every other private repo, and the budget is decided
**before** the first workflow file, not after the first bill. **If this repository is ever made
private again, this section and `.github/dependabot.yml` are revisited together** — the bot is
justified two hundred lines above precisely by these minutes being free.

## Testing

```bash
npx vigiles test --min=1    # every harness on disk, and loud when that set is empty
npx vigiles test <file>     # one harness
```

⚠️ **Not `vigiles test .`** — the `.` is read as a FILE, the runner dies with
`ERR_UNSUPPORTED_DIR_IMPORT`, and it still exits 0. See the measured table below.

Skills are tested **through vigiles** — a colocated `<skill>.harness.mjs` beside the skill.
(This read «Skills, if and when they arrive» until 2026-09-17; there are 24 of them under
`skills/` carrying a `SKILL.md`, and the README's opening line claimed the repository was
empty — issue #6.) Not through a bespoke script: a home-grown runner here once printed
confident, byte-identical "clean" verdicts for three different skills that had never loaded.

### Every npm script takes an exclusive lock, and that is not ceremony

`npm run *` in this repository goes through `scripts/exclusive.mjs`, which holds
`.vigiles/exclusive.lock` for the duration. A second gate started while one is running does not
queue and does not race — it **refuses**, names the holder, and exits 3.

🔴 **The reason is that `test:sabotage` edits the working tree in place.** That strategy is
deliberate (see `lib/mutation-driver.mjs` — copying the repo per mutation costs minutes instead
of seconds), and its one cost is that any parallel reader sees a source file mid-mutation. The
resulting failure is **false, non-deterministic, and blames the wrong file**: it reports a broken
assertion, not a mutation, and it reads as "the suite is flaky". That has already cost a wrong
conclusion here — two runs in a row produced *different* error messages and the diagnosis "I broke
round-diff" was incorrect.

A prose instruction "don't run them at the same time" existed and did not work: prose does not
execute, so it does not apply to the person in the other terminal, the agent, or the editor with
tests on save. Measured live, with the batteries running:

```
$ npm test
🔴 refused: this repository is busy with a run that EDITS FILES IN PLACE.
   held by: pid 6645, "node scripts/run-mutations.mjs", since 2026-09-17T05:22:28.757Z
RC=3
```

⚠️ A lock left behind by a process that no longer exists is **taken over** with a message, not
respected. Otherwise one interrupted run would block the repository forever, and the first cure
anybody reaches for would be "delete the lock by hand" — i.e. switching the mechanism off.

## `npm test` — `--min=1` stays, and here is what it is for

The script is `vigiles test --min=1`. It went green on 2026-09-11 when the first harnesses
landed; before that it correctly exited 1:

```
✗ vigiles test: --min=1 but only 0 test file(s) matched — evals never executed
  (check the paths/globs, or that the run was reached).
```

Do **not** "fix" a future red by dropping `--min` — the flag is the only thing standing
between "every test passed" and "no test ran", which is rule 4 applied to the test runner
itself.

🔴 **Two ways this command lies if written differently, both measured 2026-09-11:**

| form | what happens | exit |
|---|---|---|
| `vigiles test .` | `.` is read as a FILE — `ERR_UNSUPPORTED_DIR_IMPORT`, uncaught, runner dies | **0** |
| `vigiles test` | `No **/*.harness.{mjs,cjs,js,mts,cts,ts} files found.` | **0** |
| `vigiles test --min=1` | names the empty match and fails | **1** |

The first row is the worse one: the runner crashed with a stack trace and still reported
success. `package.json` shipped `vigiles test .` from the initial scaffold until this was
measured — so the repo's own test command had never once executed a test, and said nothing.

## Commits

Conventional-commit subject, body says what was MEASURED, not what was intended. A number in
a commit message that no command produced is the thing this repo exists to make impossible.
