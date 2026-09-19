# Package shape — four options, and what was measured to get there

**Status:** a design pass run 2026-09-19 against [`prior-art/`](prior-art/README.md). It is a
PROPOSAL, not a decision. It sits beside the prior art rather than inside it because a proposal
and its evidence age at different rates.

The pass was given the repository, the recorded reasons behind today's design, and permission to
research further. It came back having **refuted four premises it was handed** before proposing
anything. Those corrections are the valuable part and are recorded first, each with its
verification status.

---

## Premise corrections

### 1. VERIFIED — the 81 MB is a `vigiles/package.json` fact, not a hook-runtime fact

The recorded trade-off was "ordinary dependency (heavy) versus optional peer (light, but a manual
install step)". That framing is false, because the runtime does not use the heavy modules at all.

Measured on the v28 build, top-level `require` of `typescript`, `@ast-grep/*` or `mvdan-sh` in
each module of the `hook-runtime run-program` chain:

```
dist/hook-runtime.js         0
dist/core/hook-program.js    0
dist/load-hook.js            0
dist/hook-install.js         0
dist/core/hook-providers.js  0
dist/hook-state-store.js     0
dist/observe.js              0
```

They arrive because `vigiles` lists them under its own `dependencies`. Independently confirmed by
this repository's consumer-side measurement the same day: after the v28 lazy-boundary work the
adapter registry loads **18 modules instead of 107, with zero ast-grep and no native binding** on
the hook path.

### 2. CORRECTED — `optionalDependencies` does NOT deliver the weight cut

The proposal was to move the heavy modules to `optionalDependencies`, keeping `vigiles` an
ordinary dependency and cutting the install from ~148 MB to ~67 MB. **Measured, and it does not
work that way:**

```console
$ npm config get omit
                                  # empty — nothing is omitted by default

$ cat package.json                # { "optionalDependencies": { "is-odd": "^3.0.1" } }
$ npm install && ls node_modules/is-odd
is-odd                            # INSTALLED by default

$ npm install --omit=optional && ls node_modules/is-odd
                                  # absent only with the explicit flag
```

npm installs optional dependencies unless they fail to build or the user passes `--omit=optional`.
So this prescription reintroduces exactly the manual step that made the optional-peer design get
reverted.

**What would actually work, and it is a different change:** publish the runtime as its own light
package, so the heavy modules are not in the dependency closure of what a hook consumer installs.
`vigiles lint` and `vigiles compile` keep the full set; a project that only runs hooks pulls the
small one. This is a real upstream change rather than a manifest tweak, and the question it raises
is no longer "will optional deps be accepted" but **"is the runtime worth splitting into its own
package"**.

### 3. MEASURED — two of the three platform claims needed correcting

These three were taken from the host's documentation and were load-bearing for Option B. They
have now been measured against the real `claude` CLI (2.1.278) driven by a scripted mock model, so
each run is deterministic and costs nothing. Scripts: [`prior-art/repro/`](prior-art/repro/README.md).

**(a) `${CLAUDE_SKILL_DIR}` substitutes in a skill's body — HOLDS, and it is the ONLY variable
that works in both doors.** Measured in the project channel and the plugin channel, the latter
with the session's cwd in an unrelated directory:

```
=== A. PROJECT-level skill (.claude/skills) — the npm+symlink door ===
  CLAUDE_SKILL_DIR     -> "/tmp/vigiles-harness-BHkoMg/.claude/skills/xchan-project"
  CLAUDE_PLUGIN_ROOT   NOT SUBSTITUTED -> "${CLAUDE_PLUGIN_ROOT}"
=== B. PLUGIN-provided skill — the plugin door ===
  CLAUDE_SKILL_DIR     -> ".../xchanplugin/skills/xchan-plugin"
  CLAUDE_PLUGIN_ROOT   -> ".../xchanplugin"
```

The documented `${CLAUDE_PLUGIN_ROOT}` is a literal no-op in the project channel, and where it
does work it anchors to the plugin root rather than the skill, so it would force two spellings of
every path. There is no second candidate. **Bonus the claim omitted:** `allowed-tools` frontmatter
substitutes too — which matters, because 18 of the 89 SKILL.md occurrences live there rather than
in the body.

**(b) The `hooks:` caveat is real and WORSE than "not substituted".** The placeholder is passed
through to the shell, which expands an unset variable to nothing, so
`node ${CLAUDE_SKILL_DIR}/scripts/x.mjs` silently becomes `node /scripts/x.mjs` — no error, and no
`${...}` literal left to grep for. The hook fires (`exitCode 0`, sentinel green), so this is "no
substitution", not "no run". Upstream `anthropics/claude-code#36135` describes exactly this and is
**closed as not planned**. ⇒ `plugin/hooks/hooks.json` must keep `${CLAUDE_PROJECT_DIR}` /
`${CLAUDE_PLUGIN_ROOT}` and must never adopt `${CLAUDE_SKILL_DIR}`.

**(c) The npm marketplace entry — HOLDS, but the shape recorded above was WRONG.** `source` is an
object whose own `source` key names the type. Verified twice, independently, capturing the real
exit code:

```console
$ claude plugin validate <flat, as this note first recorded it> --strict   # RC=1
  > plugins[0].source: Bare source name "npm" requires metadata.pluginRoot.
$ claude plugin validate <nested>                                --strict   # RC=0
  √ Validation passed
$ claude plugin validate <"source": "nosuchsourcetype">          --strict   # RC=1  (control)
```

```json
{ "name": "research-paper-pipeline",
  "source": { "source": "npm", "package": "research-paper-pipeline", "version": "^0.1.0" } }
```

`version` is optional and accepts an exact version or a range. Because the wrong shape fails
`claude plugin validate --strict` with a nonzero code, this is a defect that a CI gate can make
unshippable rather than a thing to remember.

**(d) "Dependencies are not installed" — FALSE as worded; the conclusion survives for a different
reason.** Measured A/B on two byte-identical plugins differing only by a lockfile: with one,
`node_modules` materialised in the plugin cache; without one, nothing, and no log entry. Lifecycle
scripts did not run in either. The true rule is **`npm ci --ignore-scripts` runs iff `package.json`
AND a supported lockfile are both present in the fetched root**. What rescues the conclusion is a
separate fact: `npm pack` strips `package-lock.json` unconditionally — proven with a positive
control, where a newly created file listed in the same `files[]` array was included while the
lockfile in that array was not.

⇒ **A plugin installed from npm gets no `node_modules`, silently.** Three scripts break on it, not
zero: `pipeline-check.mjs`, `extract-ref-facts.mjs` and `bib-authors.mjs`, all reaching
`markdown-it`. Which retires a number this note carried: the closure is **two** third-party
packages over **eight** referenced scripts, not one over seven — `extract-ref-facts.mjs` reaches
`@retorquere/bibtex-parser` through a dynamic `await import()` that a static grep does not see.

⏳ **Not measured, recorded as such:** the documented 60-second install timeout; the personal
`~/.claude/skills` and `--add-dir` channels (2 of 4 locations verified); and a genuine
`{"source":"npm"}` install end-to-end — the A/B used a local git source, since publishing to a
registry was out of scope.

### 4. VERIFIED INDEPENDENTLY — the mtime check is wrong on every fresh checkout

git does not preserve modification times; a CI checkout gives every file the same timestamp. A
"build log older than its source" rule keyed on mtime is therefore decided by clone order, not by
content. Recording `sha256(source)` at build time makes it a pure comparison. See
[`prior-art/nondeterministic-checks.md`](prior-art/nondeterministic-checks.md).

---

## The four options

Each was asked for a complete `--help`, a delivery table, a config, an install counted in actions,
the structural guarantee it buys, and its migration cost. Condensed here; the shape is what
matters.

### A — "A linter, full stop"

rpp is Ruff for papers. Skills and hooks leave the package entirely and become a separate,
self-contained Claude Code plugin that *calls* rpp when present and says so loudly when absent.

```
rpp — lint and build for a paper kept in git

  npx rpp init            find the papers directory, declare it, offer the CI step
  npx rpp lint [dir…]     run every rule; warnings never fail (--strict makes them)
  npx rpp build [paper]   run the paper's own build script; record sha256 of source and pdf

  --json   machine-readable findings      --strict   promote warnings to errors
```

Removed: `doctor` (folded into an idempotent `init`), `hook` (no hooks in the package),
`--config` and the `rpp.json` fallback, `--max-warnings` (a threshold nobody chooses on purpose)
→ binary `--strict`, `--dry-run`, `--all`.

**Buys:** the linter cannot depend on an agent runtime, so the weight cut needs nobody's
permission. A plugin cannot be half-installed. **Costs:** two repos, two version lines, three
hooks rewritten as plain stdin-JSON/exit-2 scripts outside the vigiles machinery.

### B — "One artifact, two doors"

One published tarball that is simultaneously the npm package and the plugin: the marketplace entry
points at npm, the plugin manifest sits at package root, `skills/` is the default scanned
directory, and `rpp init` opens both doors.

```
rpp — machine-checkable gates for a paper kept in git

  npx rpp init            declare where the papers live; wire CI and the plugin; then doctor
  npx rpp lint [dir…]     run every rule; --strict to fail on warnings; --json for machines
  npx rpp build [paper]   run the paper's own build script; record sha256 of source and pdf
  npx rpp doctor          what is wired vs. what only looks wired

  `rpp hook <name>` exists for the plugin wiring and is not for typing.
```

`doctor` survives here *because* this option puts two copies of the package on disk (plugin cache
and `node_modules`) and something must say whether their versions agree.

**Buys:** the plugin and the npm package cannot ship different skills — there is one tarball, so
the "installs all 24 skills" contradiction is resolved by fact rather than by editing prose. Every
skill path becomes `${CLAUDE_SKILL_DIR}/…`, which the host resolves instead of the prose guessing.
**Costs:** publishing to npm becomes a precondition; the SKILL.md literals rewritten (measured:
**89** occurrences across 23 skills — 71 in bodies, 18 in `allowed-tools`, both of which
substitute) and the existing advisory rule flipped to error; and vendoring `markdown-it`, because
the plugin door gets no `node_modules` at all (correction 3d). **Gives up:** nothing structural — the
package stays a 26-skill monolith, and a researcher who never uses an agent still downloads 2.9 MB
of markdown.

### C — "Plugin-first"

The plugin is the primary artifact; the npm package shrinks to the two commands skills shell out
to. Honest about audience, and explicitly not recommended by the pass itself: this repository's
own primary consumer installs through npm and symlinks, so the primary consumer would sit on the
secondary path.

### D — "A runner, and rule packs like Vale"

rpp becomes a runner; rules are packages declared in config and pulled with `rpp add`, following
Vale's `Packages:` + `sync`, textlint's rule packages, and `astro add`. Severity is data inside a
pack, capped by the runner. **Right shape for a second author; ceremony for one publisher.** Named
here so it is not reinvented, with its trigger: a second rule author.

---

## Ranking, as delivered

1. **B**, because it removes a delivery channel instead of documenting it and closes each open
   problem by construction.
2. **A**, because its weight cut depends on no upstream change — take it if the runtime split is
   refused.
3. **C** — coherent, wrong primary audience.
4. **D** — 2027.

⚠️ **The stated deciding question was "will vigiles move the heavy modules to optional
dependencies". Correction 2 retires that question**: optional dependencies install by default. The
real question is whether the hook runtime is worth publishing as its own package. If it is not, A
moves to first for exactly the reason given — it is the only option that gets light without
asking anyone.

## Three fixes that no option makes optional

1. **Declare `exports`.** An empty `exports` map beside a README that documents importing from
   `bin/rpp.mjs` is a false statement about the API surface.
2. **Replace the mtime and wall-clock checks with hashes recorded by `build`.**
3. **Make hooks consume `rpp lint --json` and read the `severity` field.** Anything that
   re-derives severity from rendered text — an emoji, a prefix — is lossily reconstructing a field
   that already exists one layer down.

## One proposal deliberately NOT acted on

The pass suggests `rpp init` write `enabledPlugins` and the marketplace entry into the consumer's
`.claude/settings.json` so the plugin is enabled without `/plugin` commands. It is a coherent
idea with a precedent, and it is recorded here as a proposal only: a tool writing into a user's
agent settings is a decision for the person who owns those settings, not a detail of the install
script.
