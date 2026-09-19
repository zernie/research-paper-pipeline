# Contributing

Everything a user needs is in [`README.md`](README.md). This file is for people changing the
package.

🔴 **These sections used to live in the README.** They were moved here on 2026-09-17, because a
directory listing and a testing methodology are not what someone reads to decide whether to try
the tool. Nothing was dropped — if you are looking for a fact that used to be on the front page,
it is below.

## How this is tested

Every rule ships with a **harness**: a test that runs the rule twice. Once on a file with a defect
planted in it, where the rule must find it. Once on a clean file, where the rule must say nothing.

The second run is the one people skip, and it is the one that matters. A rule that is broken and
finds nothing passes the first kind of test by accident — from outside, "there is nothing wrong
here" and "this check never ran" look exactly the same.

On top of that, each rule has a **battery**: it deletes one thing the rule depends on and then
demands the harness go red, at the specific assertion that thing belongs to. If nothing goes red,
that part of the rule was never doing any work. CI refuses a rule whose battery cannot kill it.

<!-- count:harnesses -->57 harnesses, <!-- count:batteries -->34 batteries.

It caught a real one on the way in: `js-yaml` 5 stopped parsing an unquoted date as a `Date`.
Every harness stayed green under both majors, and only the battery noticed that the rule's
date coercion had become dead code.

## Layout

```
eslint-rules/   the rules, each with its .harness.mjs and .mutations.mjs beside it
lib/            shared readers — markdown, skill corpus, the mutation driver
hooks/          three hooks for vigiles — the code
plugin/         the Claude Code plugin: wiring for those hooks, no code, no package.json
skills/         24 stage skills
scripts/        this repo's own gates
action.yml      the CI composite action
fixtures/       inputs the harnesses lint
docs/           evidence that would otherwise bloat CLAUDE.md:
                  prior-art/  how comparable tools are shaped, and why this one is shaped so
                  incidents.md  what broke, measured
                  install.md  the install contract
```

## Working on this package

```bash
npm install
npm test                 # every harness
npm run test:sabotage    # break each rule on purpose; a harness nothing can kill is not a harness
npm run check:readme     # the counts above are recounted from the tree, not typed by hand
```

None of these are needed to USE the tool — they are here because the gates are part of the
argument, not decoration.

## Why not one of the existing academic skill suites

The nearest neighbour, [`Imbad0202/academic-research-skills`](https://github.com/Imbad0202/academic-research-skills),
is a serious project with its own linters, a CI threshold gate and a write guard. "Just prompts"
is wrong about it.

The difference is **what a check is allowed to read.** Its integrity gate thresholds a numeric
score that the audited model writes about itself. Here, nothing a rule reads is authored by the
thing being checked: `paper/stages` compares a declared byte count against `statSync`, and
`paper/source` does the same for the frozen `.tex`. It also reads the paper's LaTeX source, which
that suite does not — it checks process artefacts.

Licensing differs too: that suite is CC BY-NC 4.0, this is MIT.

## Words this page uses

- **stage** — a point a paper reached and cannot un-reach: `submitted`, `camera-ready`, `arxiv`.
- **scorecard** — `PIPELINE-STATUS.md`, the file above. One per paper.
- **frozen** — a copy of the exact PDF or `.tex` that was sent, kept in `versions/`. Bytes, not a
  commit reference: squash and `gc` destroy commit references, and did.
- **harness** — the test beside a rule. **battery** — a set of edits that try to break a harness.

## Also in the box

**The <!-- count:skills -->24 skills** are markdown, one directory each, and they name the scripts
they run. Point your agent at `skills/` and ask it for a stage by name. The stages that need taste
stay taste and say so — `paper-adversarial-review` does not pretend to be a checker.

**The 3 hooks** run on [vigiles](https://github.com/zernie/vigiles), a runner that executes checks
inside an agent's edit loop. It is an ordinary dependency of this package, so it installs with it —
and it is most of what the install weighs.
