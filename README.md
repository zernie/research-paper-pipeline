# research-paper-pipeline

> A linter and an agent workflow for a research paper kept in git.

The package has three parts:

- **<!-- count:rules -->12 ESLint rules** that check a paper against itself — nine of them run on your papers.
- **<!-- count:skills -->24 skills**: instruction files an AI coding agent (Claude Code) reads, one
  per stage of writing a paper. The skills are what *do* the work and write down what they did;
  the rules check that record against the files.
- **3 hooks** for Claude Code: one blocks an edit that would skip the checks, two are reminders.

It is ESLint underneath — `rpp lint` builds a flat config and runs it — so severities, `--json`
output and wiring the rules into a config you already have all behave the way you expect.

**You do not need the agent.** `rpp lint` is a plain CLI: Node, the installed package, nothing
else — no agent, no TeX, no network. The skills and hooks are the second half, and they are opt-in.

What the rules catch, in plain language:

- You declared the paper submitted on a date, and the PDF named in that record is not on disk —
  or it is, but it is not the same file any more.
- Your camera-ready still says *we will release our code* after you released it.
- You marked a paper submitted and never wrote down that you checked the author list against
  the bibliography.

That last one is a record check, not a bibliography check — see the table below for exactly what
each rule reads.

Node 22.13 or newer. CLI name: `rpp`.

**A word used precisely in this document:** a **gate** is a check that can block — it fails a run
or refuses a command. A **stage** is a point a paper has reached (`submitted`, `camera-ready`).
Reminders that only print are called reminders, not gates.

## What the rules check

**Nine of the rules run on your papers**, listed here; the other three lint
this package's own source and never see your files.

| Rule | Level | Reads | Fails when |
| ---- | ----- | ----- | ---------- |
| `paper/stages` | error | `PIPELINE-STATUS.md` | a declared stage's PDF is missing, or the `bytes:` it names does not match the file's real size, or a frozen PDF exists that no stage declares |
| `paper/source` | error | `PIPELINE-STATUS.md` | a declared stage has no frozen `.tex` beside its PDF (a commit hash does not count — squash and gc destroy it) |
| `paper/author-list` | warn | `PIPELINE-STATUS.md` | a stage is declared and **no cell of the scorecard's table contains the run marker** (default `bib-authors`). It checks that you recorded the cross-check; it does not read your `.bib`. What to run is your own `authorListCommand`, empty by default |
| `paper/research-question` | warn | `paper.tex`, `paper.md`, `PIPELINE-STATUS.md` | a stage is declared and either the scorecard has no `researchQuestion` field, or it has one the paper does not contain. The declared sentence is compared against the source with whitespace collapsed — your words, not a pattern. Advisory, because nothing here can judge whether what you declared *is* a research question |
| `paper/typography` | warn | `paper.tex`, `paper.md` | any of four counts rises above the per-paper allowance you set: `§` or `\S\ref` instead of "Section"; a decimal with no leading zero (`.05`); `Fig.` and `Figure` mixed in one document; bibliography entries with no doi, url or arXiv id. Existing debt is tolerated, growth is not |
| `tex/future-promise` | warn | `paper.tex` | a camera-ready build still says "will be released" about something already handed over |
| `tex/acm-frontmatter-override` | error | `paper.tex` | an `acmart` build overrides ACM's front-matter commands and drops template elements from page 1 |
| `review/findings-cause` | error | `reviews/*.md` | a review lists at least `minFindings` (default 3) findings and no cell introduces a cause with the marker (default `Cause:`) |
| `doc/fields` | warn | `reviews/*.md` | a front-matter field is missing or holds a value outside the list you configured. Off entirely unless you configure `docFields` |

Errors fail the run; warnings print and do not.

**LaTeX or Markdown.** The scorecard and the review notes are always Markdown, so their five rules
apply either way. For the paper body it is not symmetrical: a `.tex` body gets four rules, a `.md`
body gets two — `tex/future-promise` and `tex/acm-frontmatter-override` are LaTeX-only.

Every rule is tested twice: it has to catch a planted mistake, and it has to stay quiet on a
correct file. Both halves matter, because a broken check and a clean file look identical from
outside. A second suite then deletes one load-bearing line from each rule and confirms the right
test goes red. Details in [`CONTRIBUTING.md`](CONTRIBUTING.md).

## What adopting this costs you

Not a read-only checker you point at an existing repository. Before you install, know that:

**You write and maintain a `PIPELINE-STATUS.md` in every paper directory.** It does not appear by
itself. Nothing generates it and no command refreshes it — you copy the template from
`skills/paper-pipeline/references/pipeline-status-template.md` and keep it current, or the agent
does it for you as it runs the stages. Without that file a paper directory gets zero rules.

**`rpp init` writes to your repository.** Exactly:

| what | where | when |
| --- | --- | --- |
| a `research-paper-pipeline` key naming your papers directory | your `package.json` | always |
| a GitHub Actions workflow | `.github/workflows/` | only if you say yes; it asks once, and only when stdin is a terminal |

It installs no software and touches nothing else.

**One of the three Claude Code hooks can block you** — and only if you install the plugin, which
is a separate step. `paper-edit-guard` runs before every Bash command and refuses a Bash write to
a paper source, because such a write skips the checks that hang on Edit/Write. Its sharp edge is
documented in its own source: if the `research-paper-pipeline` key cannot be parsed — missing
`package.json`, conflict markers — the guard **denies every Bash command** until you fix it,
rather than failing open and looking green. The recovery is an Edit or Write, which bypass the
hook entirely. To turn it off, do not install the plugin, or remove it from your Claude Code
settings; the rules and the CLI work without it. The other two hooks never block (see below).

## Install

There is **no published npm release and no git tag** — not on npm, no `v0.1.0` to pin to. Install
from GitHub against a commit sha from the default branch:

```sh
npm i -D github:zernie/research-paper-pipeline#<commit-sha>
npx rpp init
```

`rpp init` ends by running `rpp doctor` and exits with its verdict. Believe that over the absence
of errors: a guard watching an empty directory looks exactly like a guard that is working, because
silence is its success state. `doctor` prints the directory the linter uses and the directory the
hooks use side by side, and exits non-zero when they differ
([#33](https://github.com/zernie/research-paper-pipeline/issues/33)).

npm and pnpm are covered by an end-to-end install test; Yarn Plug'n'Play is not supported. The
measurements behind both, and behind the package/plugin split, are in
[`docs/install.md`](docs/install.md).

The skills — not the linter — call external programs such as TeX Live, poppler and a JRE. See
[`docs/toolchain.md`](docs/toolchain.md).

## Usage

```sh
npx rpp lint                        # run every rule over your papers
npx rpp lint papers/my-paper        # ... or over just one
npx rpp build papers/my-paper       # build one paper with ITS OWN build script
npx rpp build --all --dry-run       # which papers can nobody build?
npx rpp doctor                      # what is actually wired, and what only LOOKS wired
npx rpp --help                      # every flag, with the reasoning
```

Real output, from a fixture in this repository — `node bin/rpp.mjs lint fixtures/paper-stages/wrongsize`:

```
/home/user/research-paper-pipeline/fixtures/paper-stages/wrongsize/PIPELINE-STATUS.md
  1:1  error    «submitted» (2026-07-22): 352357 bytes declared, 100 on disk — this is NOT that file    paper/stages
  1:1  error    stage «submitted» (2026-07-22) carries no frozen source. A commit reference will not do: squash and gc destroy it — three of four sources were lost that way in this corpus    paper/source
  1:1  warning  stage «submitted» is declared, but the scorecard records no author-list run (looked for «bib-authors» in its table). …    paper/author-list

✖ 3 problems (2 errors, 1 warning)
```

(Column padding trimmed to fit; the `…` marks the one message shortened. Everything else is
verbatim.)

`rpp lint` finds its settings by walking up from the current directory, the way eslint and tsc do,
so it works from anywhere in the repository. The scope comes from that key or from a path you
pass — never from a default. Linting `"."` would pass over whatever happens to be in the checkout
and report green on a scope nobody chose.

The exit code is `1` when any rule reports an error, and also `1` when *nothing* was linted — a
clean report over zero files is not a clean report. `--json` prints machine-readable findings.

## The scorecard

Every paper directory carries a `PIPELINE-STATUS.md`. Its YAML front matter declares the stages
the paper has reached; the skills write rows into it as they run, and the rules read it back and
compare it with the files beside it.

```
papers/my-paper/
  PIPELINE-STATUS.md      the scorecard: what the paper claims to have reached
  paper.tex | paper.md    the source
  reviews/*.md            review notes
  versions/<date>-*.pdf   the exact bytes that were sent, frozen
```

```markdown
---
stages:
  - stage: submitted
    date: 2026-07-22
    venue: A Venue 2026
    pdf: versions/2026-07-22-submitted.pdf
    bytes: 305412
    source: versions/2026-07-22-submitted.tex
    sourceBytes: 57210
---
```

**Who writes `bytes:` and `sourceBytes:`?** You do, or the agent does, once — when the stage is
recorded. No command in this package generates or refreshes them, by design. They are not a
checksum you maintain: a frozen PDF is never supposed to change, so `bytes:` disagreeing with the
file means the file was replaced after it was declared, and that is precisely the finding. If you
genuinely re-froze a stage, update the number in the same commit.

## Claude Code: skills and hooks

**The two doors deliver different things.** The skills arrive with the
**npm package** — they sit in `node_modules/research-paper-pipeline/skills/` and Claude Code reads
them from there. `/paper-pipeline` is the entry point; it routes to the rest. The **plugin**
carries the hook wiring and nothing else: no code, a manifest and one file,
`plugin/hooks/hooks.json`. The hooks call the runtime the npm install already put in your project,
which is why the plugin can stay empty. (Why it has to be this way — measured — is in
[`docs/install.md`](docs/install.md).)

So `npm i` gives you the skills, the rules and the CLI; two lines inside Claude Code give you the
hooks:

```
/plugin marketplace add zernie/research-paper-pipeline
/plugin install research-paper-pipeline@research-paper-pipeline
```

**One of the three is a gate; the other two only print.**

| Hook | Blocks? | When | What it does |
| ---- | ------- | ---- | ------------ |
| `paper-edit-guard` | **yes** — denies the command | before a Bash command | refuses a Bash write to a paper source, because it would skip every check that hangs on Edit/Write. Also denies while the settings key is unparseable |
| `paper-skills-nudge` | no — always exits 0 | after an Edit/Write on a paper | puts the pre-submit checklist in front of the agent (about 1.3 KB of context on a paper edit, nothing on any other file) |
| `paper-status-gates` | no — always exits 0 | after an Edit/Write on a paper | reads that paper's scorecard and lists the stages that have not run yet |

The two reminders are `react` hooks, whose type has no way to deny at all — they cannot block even
by mistake.

## Configuration

One key in your `package.json`, written by `rpp init`:

```json
{
  "research-paper-pipeline": {
    "papers": "papers"
  }
}
```

`papers` is the only required setting, and it has no default on purpose. Eight optional keys tune
the author-list command, typography debt, review front-matter fields and the build-script lookup —
all of them, with the required-files block, are in
[`docs/configuration.md`](docs/configuration.md).

## In CI

The repository ships a GitHub composite action. Add one step:

```yaml
- uses: zernie/research-paper-pipeline@<commit-sha>
  with:
    paths: papers
```

Same sha situation as the install: no tag exists, so pin a commit. It runs `rpp lint`, so CI and
your terminal execute the same code. `paths` is required, and the job refuses to pass when zero
files were linted, so a typo in the path shows up red instead of green. Optional inputs: `config`,
`max-warnings` (default `-1`), `texcount` (default `true`), `working-directory`.

## Documentation

| file | what is in it |
| --- | --- |
| [`docs/toolchain.md`](docs/toolchain.md) | the external programs the skills call, and how to install TeX Live by package name |
| [`docs/configuration.md`](docs/configuration.md) | every setting, the required-files block, build-script lookup, using the rules from your own ESLint config |
| [`docs/install.md`](docs/install.md) | why the install is shaped this way, and why the plugin ships no code — a decision record, measured |
| [`docs/prior-art/`](docs/prior-art/README.md) | how comparable tools are shaped, with the URLs that were checked |
| [`docs/incidents.md`](docs/incidents.md) | what broke, measured |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | layout, test commands, how to add a rule or a skill |

## License

MIT.
