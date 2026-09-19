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

### 3. UNVERIFIED HERE — the platform facts that make Option B possible

Three claims about the host were taken from its documentation and have **not** been re-measured in
this repository. They are load-bearing for Option B and should be checked before that option is
chosen:

- `${CLAUDE_SKILL_DIR}` is substituted inline in a skill's **body** for every skill location
  (personal, project, `--add-dir`, plugin), regardless of working directory. Caveat claimed: the
  substitution does **not** happen in frontmatter `hooks:` commands.
- A marketplace entry accepts `{"source": "npm", "package": "…", "version": "…"}`, so one
  published tarball can be both the npm package and the plugin.
- On a plugin fetch, install scripts never run and dependencies are not installed; `npm ci` runs
  only if a lockfile is present in the tarball, with a 60-second timeout that never blocks the
  plugin. Since npm strips `package-lock.json` from tarballs, a plugin copy gets no
  `node_modules` — which matches the house position that a silent auto-install is worse than an
  explicit step.

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
**Costs:** publishing to npm becomes a precondition; 113 literals rewritten and the existing
advisory rule flipped to error; one bundling step for the seven scripts the skills call (measured:
they import exactly one third-party module between them). **Gives up:** nothing structural — the
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
