# How tools ship installable CONTENT, not just code

**Question this file answers:** this package carries 26 skills (2.9 MB of markdown an agent
reads) alongside its rules and its CLI. How do comparable tools deliver content that is neither
code nor configuration — styles, extensions, presets — and what do they refuse to do?

**Verdict:** the tools that do this well **declare the content in the config and fetch it with
an explicit command**. None of them silently bundle a large content tree into the tool itself,
and none of them rely on the user's file layout matching a path the content hard-codes.

---

## Vale — the closest analogue, because its content IS the product

Vale is a prose linter whose rules are not compiled in: a *style* is a folder of YAML rules, and
published styles (Google, Microsoft, Red Hat) are installed rather than vendored.

The declaration lives in `.vale.ini`:

```ini
StylesPath = styles
MinAlertLevel = suggestion

Packages = Google, write-good

[*.md]
BasedOnStyles = Vale, Google
```

and one command fetches what the config asked for:

```console
$ vale sync
```

Three properties worth stealing:

- **The config names the content; the command fetches it.** There is no step where the user
  copies a folder, and no step where the tool guesses.
- **`StylesPath` is declared by the consumer**, so the content does not need to know where it
  will land.
- **A style is versioned and shareable independently of the binary.** Updating a style is not a
  release of Vale.

Sources: <https://vale.sh/> · <https://github.com/vale-cli/vale>

## Quarto — extensions as a first-class verb pair

Quarto is the closest *domain* analogue (scientific publishing: `render`, `preview`, `check`,
`publish`, `create`). For content it uses two verbs:

- `quarto add <extension>` — install an extension into the project
- `quarto use <template>` — start from a template that an extension provides

Project configuration lives in one place, `_quarto.yml`. The extension mechanism covers
filters, output formats and templates — that is, all three of "transform my document",
"produce this venue's format" and "start me from this skeleton" go through the same door.

Source: <https://quarto.org/docs/reference/>

## ESLint — shareable configs as ordinary packages

The pattern this package already lives inside. A shareable config is a normal npm package that
the consumer installs and names in their config; nothing is copied into the consumer's tree and
no path inside the config assumes where the consumer put it. Resolution is the module system's
job, which is precisely why it survives pnpm, yarn and npm layouts.

## pre-commit — hooks declared, fetched, pinned

```yaml
repos:
  - repo: https://github.com/psf/black
    rev: 24.4.2
    hooks:
      - id: black
```

The consumer declares a repository, a **revision**, and which hooks to enable; the tool clones
and caches it. The lesson is the `rev:` field — content delivered from elsewhere is **pinned**,
so an upstream change cannot alter today's run.

---

## What this means for this package

The measured problem this file exists for: the plugin channel carries **zero skills**.
`marketplace.json` points at `plugin/`, which contains `plugin.json` (with no `skills` key) and
`hooks/hooks.json` — while `README.md` claims the install brings "all 24 skills". Separately,
**113 literal paths** of the form `.claude/skills/paper-pipeline/scripts/<x>.mjs` are written
inside the skills' own prose.

Read against the four tools above, those are one problem, not two:

1. **The content hard-codes where it expects to live.** No tool above does this. Vale's styles
   do not know `StylesPath`; an ESLint shareable config does not know the consumer's directory.
   A path inside the content is a bet on one installation channel, and there are two.

2. **There is no declared-and-fetched step.** Today the content arrives by being *inside* the
   package (npm) or by not arriving at all (plugin). Neither is `vale sync`: a line in the
   config plus one command.

3. **Nothing pins the content** the way `pre-commit`'s `rev:` does.

Three directions follow, and they are genuinely different bets rather than one idea:

- **One channel.** Skills ship only through npm; the plugin carries hooks and says so. Cheapest;
  gives up the plugin's discovery story.
- **Content is fetched, not bundled.** `rpp` declares which skill pack a project wants and a
  command materialises it into a path the consumer declared. Closest to Vale; costs a fetcher
  and a cache.
- **Content is addressed, never pathed.** Skills stop naming filesystem locations and call the
  CLI instead (`rpp <verb>`), so the same prose works in both channels. Attacks the root cause;
  costs a pass over 113 sites and a rule that keeps them from coming back.

See also: [`multi-mode-tools.md`](multi-mode-tools.md) for how these verbs sit beside `lint` and
`build`, and `CONTRIBUTING.md` § "Why not one of the existing academic skill suites" — that
section answers a different question (should this exist), not this one (what shape it takes).
