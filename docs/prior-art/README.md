# Prior art — how comparable tools are shaped

Why this folder exists: this package is four things at once (a linter over papers, a build
front-end, a host for agent hooks, and a carrier of 26 skills), and every design argument about
its command surface kept being settled by taste. These notes settle them by looking at tools
that already solved the same problem, with the URL that was checked.

**Files are split by QUESTION, not by tool** — Quarto answers two different questions and has to
be citable for each one separately.

| file | the question | the verdict in one line |
| --- | --- | --- |
| [`multi-mode-tools.md`](multi-mode-tools.md) | how do linter + builder + extension host live in one CLI? | small-feeling tools have fewer **nouns**, not fewer capabilities — the project config supplies what would be an argument |
| [`blocking-vs-advisory.md`](blocking-vs-advisory.md) | who decides to fail the run — the rule or the runner? | severity is **data on the finding**; failing is the **runner's** decision, and the default is not to fail |
| [`nondeterministic-checks.md`](nondeterministic-checks.md) | may a check read the clock, an mtime, or a diff? | yes, but make it opt-in, never blocking — and prefer a **recorded fact** to an inferred one, which dissolves most of them |
| [`content-delivery.md`](content-delivery.md) | how is installable content (skills, styles, extensions) delivered? | the **config declares it and a command fetches it**; content that hard-codes its own install path is betting on one channel |

## Tools examined, and for what

| tool | why it is here |
| --- | --- |
| **Quarto** | the domain analogue — scientific publishing with `render` / `check` / `publish` and extensions |
| **Vale** | the content analogue — a prose linter whose styles are declared in config and fetched by `vale sync` |
| **Biome** | the "one tool, one config, one command" position, stated by its own authors |
| **Danger JS** | a linter for the PROCESS rather than the code; levels as separate functions |
| **reviewdog** | non-blocking by default; failing is a flag on the runner |
| **eslint-plugin-unicorn** (`expiring-todo-comments`) | proof that a time-dependent lint rule is respectable — and how its author contained it |
| **Semgrep** (`--baseline-commit`) | a before/after check without an event: same analysis, two revisions, subtract |
| **ESLint**, **Clippy**, **pre-commit** | severity as config data; content declared, fetched and pinned |

## How to use this folder

- **Before changing the command surface**, read `multi-mode-tools.md`. The argument "we need
  another command for X" is usually an argument that the config is not declaring something.
- **Before adding a check that can fail a build**, read `blocking-vs-advisory.md` and
  `nondeterministic-checks.md` in that order.
- **Before adding anything to the plugin or the skills**, read `content-delivery.md` — it
  records the measured state in which the plugin channel delivers zero skills.

## What this folder is NOT

It does not argue whether this package should exist, or how it compares to other academic
skill suites — that question is answered in `CONTRIBUTING.md`, § "Why not one of the existing
academic skill suites". Different question, deliberately not merged.

## The scripts behind the numbers

[`repro/`](repro/README.md) holds the probes for the platform measurements that
`../package-shape-options.md` § "Premise corrections" rests on — the `${CLAUDE_SKILL_DIR}`
substitution table, the five marketplace shapes with their real exit codes, and the dependency
closure scan. They are kept so a verdict here can be disagreed with by running a program.

## Status

Written 2026-09-19 from first-hand fetches of the sources cited in each file.

The design pass run against these notes landed the same day:
[`../package-shape-options.md`](../package-shape-options.md) — four options for the package's
shape, a ranking, and four premise corrections that came out of it. It sits BESIDE this folder,
not inside it, because a proposal and its evidence age at different rates: these notes stay true
as long as the tools they cite do; that proposal expires the moment a shape is chosen.
