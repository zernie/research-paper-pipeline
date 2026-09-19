# What we test with, and why there is no test framework here

**Question this file answers:** this package has 57 `*.harness.mjs` files of plain
`node:assert/strict`, three bespoke e2e scripts, and no jest, vitest, mocha, ava or `node:test`.
Is that a gap? Should an npm package's install be tested through a local registry?

**Verdict: change nothing.** A general-purpose runner would buy a reporter and a second answer to
"do the tests pass". A local registry is what MULTI-package repositories reach for; a single-package
CLI packs a tarball and installs it. Both conclusions have named triggers for revisiting, below.

---

## The measurement that settles the house rule

The rule "testing goes through vigiles" was narrowed on 2026-09-19 to agent-facing surfaces only.
The corpus already had that shape, which is the strongest evidence the narrowing is descriptive
rather than a concession — counted the same day:

```
harness files                          57
import anything from "vigiles"         10
  …of which import ONLY recordCheck     8
```

So the genuinely agent-facing harnesses are three: `hooks/hooks.harness.mjs` (`runHook`,
`checkHookImports`), `skills/plan-paper-timeline/plan-paper-timeline.effects.harness.mjs`
(`runHarnessTest`, which spawns the real `claude` binary against a scripted model), and the skill
contract checks. Everything else is ordinary Node testing that happens to carry the suffix.

⚠️ **The suffix is a CONTRACT, not a style choice.** `lib/mutation-driver.mjs` pairs batteries to
harnesses by it, and `scripts/readme-numbers.mjs` counts by it. Renaming files for a new runner
would break two things that have nothing to do with running tests.

## Why the install e2e stays a script

`scripts/install-e2e.mjs` is one linear scenario per package manager with strictly dependent steps
— install, bin, `init`, `lint`, hook commands, content delivery — and a summary. A runner adds
named subtests and a reporter; the script already prints per-check `✓`/`✗` and a per-manager
verdict. The pack-and-install work stays in our code under any host, so the host buys only the
reporter, at the cost of a second exit-code path.

It also stays OUT of `npm test`: it needs the network for the consumer's transitive dependencies
and takes minutes. It is its own CI step with its own timeout.

## Tarball-by-path versus a local registry

We install the tarball by path. A real consumer resolves by name from a registry. The difference
is smaller than it looks, and the reason is mechanical:

> `npm publish --dry-run` and `npm pack --dry-run` use the same packlist.

So "what lands on disk" is faithful by construction. What the shortcut genuinely misses, and the
status of each here:

| missed | status in this package |
| --- | --- |
| `prepublishOnly`, `publishConfig` — they run/apply only on `npm publish` | neither is declared, so the gap is zero today |
| a cold `npx <name>` in an empty directory: packument fetch, `latest`, bin resolution by name | the documented install is `npm i`, not `npx` |
| a dependency on a sibling package not yet published, referenced by semver range | none today; would appear if the hook runtime is split out (see `../package-shape-options.md` §2) |

**Not missed, so not arguments for a registry:** the published file list, `bundleDependencies`,
`engines`, peer auto-install (npm ≥7 and pnpm ≥8 are both exercised for real), and `prepare`.

### Prior art, and what it is actually about

- **Angular CLI** and **Nx** spawn verdaccio and publish the workspace's packages into it before
  e2e. Both are multi-package: the packages reference each other by range, which a second tarball
  cannot satisfy.
- **pnpm** uses `@pnpm/registry-mock` because its tests need controlled packuments, not tarballs.
- **Single-package CLIs** pack and install into a clean temp project — the shape `r2g` packages as
  a tool ("tests your package after `npm pack` and `npm install --production`").

✅ **Measured 2026-09-19 that verdaccio DOES work in our environment**, so adopting it later is a
decision and not an unknown: `npm i -g verdaccio` (v6.10.3) installs, it serves on 4873, its uplink
to registry.npmjs.org reaches through the agent proxy (`@eslint/markdown` → HTTP 200), `npm publish`
into it succeeds, and a consumer's `npm i research-paper-pipeline` then resolves **by name** —
`"resolved": "http://localhost:4873/…"` in the consumer's lockfile — with the installed binary
answering. Recording this so the question "would it even run here" never has to be asked again.

**Triggers to revisit:** a second published package that this one depends on by range, **or** the
documented install becoming a cold `npx <name>`. Then: verdaccio as a devDependency spawned by the
script, Angular-style — not a Docker service in CI.

## Why no vitest, and no `node:test` either

vitest's value is its Vite transform pipeline, jsdom, module mocking and a watch UI. The tests here
are plain `.mjs`, the sources are compiled by `tsc`, there is no DOM, and the design deliberately
does not mock — it spawns real processes into temp directories, which is the right shape for a CLI.
So vitest would add vite and a native esbuild binary to a package whose install weight is itself
under scrutiny, and nothing breaks without it.

`node:test` costs no dependency but creates the two-answers problem verbatim: a second discovery
mechanism (`--test` globs against the `.harness.mjs` suffix) and a second exit code.

**What staying honestly costs:** a top-level `assert` stops at the FIRST failure, so a table-driven
test over many fixtures reports one row per run. Also no name-level filtering (file-level exists:
`vigiles test <file>`).

**Trigger to revisit:** when continue-after-failure is measurably costing iteration time on a
table-driven test. The answer then is `node:test`, never vitest, and it must run under the same
`npm test` line rather than beside it.

## One known limit, recorded so it is not claimed

**Yarn Berry (PnP) cannot be supported as things stand.** `plugin/hooks/hooks.json` addresses
`${CLAUDE_PROJECT_DIR}/node_modules/research-paper-pipeline/bin/rpp.mjs` literally, and PnP has no
`node_modules` directory at all. Adding a third `managers()` row for it would be a red test, not a
feature. Yarn *classic* is one row away if support is ever claimed.

---

## Status

Written 2026-09-19 from a design pass over this repository plus the sources below, with the
vigiles-import count and the verdaccio run measured here rather than recalled.

Sources: [Nx — Creating an Install Package](https://nx.dev/docs/extending-nx/create-install-package) ·
[Verdaccio — End to End testing](https://www.verdaccio.org/docs/e2e/) ·
[@pnpm/registry-mock](https://www.npmjs.com/package/@pnpm/registry-mock) ·
[r2g](https://github.com/ORESoftware/r2g) ·
[npm Docs — scripts, `prepack` vs `prepublishOnly`](https://docs.npmjs.com/cli/v11/using-npm/scripts/)
