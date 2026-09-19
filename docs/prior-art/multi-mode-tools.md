# When one tool is a linter AND a builder AND an extension host

**Question this file answers:** this package is four things at once — a linter over papers, a
build front-end, a host for agent hooks, and a carrier of 26 skills. Tools that carry a
comparable mix exist. How do they keep the command surface small, and where do they draw the
line between a verb and a flag?

**Verdict:** the tools that feel small do not have fewer capabilities — they have **fewer
NOUNS**. Capability is reached by a verb over a project that the config already describes; what
would be a second noun becomes a flag or disappears into the config. The tools that feel large
are the ones where the user must name, on the command line, a thing the project already knows.

---

## Biome — the "one tool, one config, one command" position, stated by its authors

> Biome unifies functionalities that have previously been separate tools. Building upon a shared
> base allows it to provide a cohesive experience for processing code, displaying errors,
> parallelize work, caching, and configuration.

The user-facing consequence is a single default verb:

```console
$ biome check .          # format + lint + organize imports
$ biome check --write .  # and fix what is fixable
```

Formatting and linting remain available separately, but the advertised path is one command.
Note what this costs: `check` is doing three jobs, so its *output* has to be legible enough to
tell them apart. Merging verbs pushes the burden onto the report.

Sources: <https://biomejs.dev/> · <https://github.com/biomejs/biome>

## Quarto — the domain analogue, and its verbs are all about the PROJECT

```console
$ quarto render          # produce outputs
$ quarto preview         # live preview
$ quarto check           # validate the installation and its dependencies
$ quarto create          # start a project or document
$ quarto publish         # deploy
$ quarto add <ext>       # install an extension
$ quarto use <template>  # start from an extension's template
```

Two things to steal, and one to notice:

- **`check` means "is my toolchain sane", not "is my document good".** That is a different
  meaning from `biome check` and from this package's current `doctor`. Whichever meaning is
  chosen, only one can be in play.
- **Extensions get their own verb pair** (`add` / `use`) rather than being wired by hand.
- Configuration lives in one file, `_quarto.yml`, and the verbs above almost never take a path —
  the project says what it contains.

Source: <https://quarto.org/docs/reference/>

## What the small-surface tools have in common

| tool | verbs a user types weekly | where the nouns went |
| --- | --- | --- |
| Biome | `check` (and `--write`) | config declares includes/excludes |
| Quarto | `render`, `preview` | `_quarto.yml` declares the project |
| Vale | `vale <paths>`, `vale sync` | `.vale.ini` declares styles and scope |

And the recurring shape: **one verb for the routine loop, one verb for "make my environment
match the declaration", and everything else rare.** Vale's `sync`, Quarto's `add`, and a
hypothetical `rpp install` are the same slot.

## This package today, measured 2026-09-19

```
npx rpp init [dir]              set the project up
npx rpp lint [paths…]           run every rule over your papers
npx rpp build <paper> | --all   build a paper with its own build script
npx rpp doctor                  say what is actually wired — and what only LOOKS wired
npx rpp hook <name>             run an editor hook (the plugin wiring calls this)
```

Read against the table above:

- `lint` takes `[paths…]` **and** the config declares `papers`. Two ways to say the same thing;
  the help text already has to explain which wins.
- `build` takes `<paper>` or `--all` — a noun the project could supply, exactly the shape the
  small-surface tools removed.
- `hook <name>` is **not a user verb at all**: it exists because the plugin wiring calls it.
  Nobody types it. It is an entry point wearing a command's clothes.
- `doctor` and a possible `check` would collide in meaning unless one of them is renamed — see
  the Quarto note above.

So the honest count of verbs a researcher types is **two** (`lint`, `build`), one is setup
(`init`), one is diagnostics (`doctor`), and one is machine-facing (`hook`). That is not a large
surface — but it is presented as five equals, which makes it read larger than it is.

---

## Open questions this file does not settle

- Whether `lint` and `build` should merge into one routine verb the way `biome check` did, and
  what that costs the report.
- Whether the machine-facing entry point should be hidden from `--help` entirely, or moved
  behind a subcommand namespace.
- What `check` should mean here if it is introduced — toolchain sanity (Quarto) or the routine
  pass (Biome). Both are taken; picking either forfeits the other.

See also: [`content-delivery.md`](content-delivery.md) for the `add` / `sync` slot, and
[`blocking-vs-advisory.md`](blocking-vs-advisory.md) for what each verb should exit with.
