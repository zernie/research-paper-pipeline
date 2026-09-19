# Reproduction scripts for the platform measurements

These are the probes behind the verdicts in
[`../../package-shape-options.md`](../../package-shape-options.md) § "Premise corrections".
They are kept because a measurement without its script is a number nobody can re-run: the next
person who doubts a verdict here should be able to disagree with a program, not with prose.

They are **not** part of the package's test suite and are not wired into any gate. Each is a
standalone script run by hand.

## How the CLAIM 1 probes work

They use `runHarnessTest` from vigiles, which spawns the **real** `claude` CLI against a
**scripted mock model**. Nothing reaches a paid endpoint, and `r.modelRequests` exposes exactly
what text arrived at the model — which is what a substitution question is actually asking.

```console
$ node docs/prior-art/repro/claim1-crosschannel.mjs
```

| script | what it decides |
| --- | --- |
| `claim1-project-skill.mjs` | does `${CLAUDE_SKILL_DIR}` substitute in a **project** skill's body? |
| `claim1-plugin-skill.mjs` | the same in a **plugin-provided** skill, with cwd elsewhere |
| `claim1-crosschannel.mjs` | the table that decides the design: which variables resolve in **both** doors |
| `claim1-allowedtools.mjs`, `claim1-at2.mjs` | does it substitute in `allowed-tools`? (`at2` is the rebuild after the first version turned out vacuous — Bash was broadly granted, so the permit proved nothing; it now carries an identically shaped decoy) |
| `claim1-frontmatter.mjs`, `claim1-plugin-frontmatter.mjs` | frontmatter `hooks:` — in both channels |
| `claim1-hook-payload-reporter.mjs` | the hook the two probes above install; reports argv and env separately, so "not substituted" is distinguishable from "not run" |
| `claim3-imports.mjs` | transitive third-party closure of the scripts SKILL.md files actually reference |

**Every CLAIM 1 probe carries positive controls** (the skill resolved · a literal body sentinel
reached the model · a granted tool succeeded). Without them a silent empty result reads as a
finding, which is the failure mode this repository keeps re-measuring.

## The CLAIM 2 fixtures

Five marketplace manifests, flattened to files here so that no directory in this repository looks
like a real plugin. To run one, put it back where the CLI expects it:

```console
$ mkdir -p /tmp/m/.claude-plugin
$ cp docs/prior-art/repro/claim2-marketplace-nested-range.json /tmp/m/.claude-plugin/marketplace.json
$ claude plugin validate /tmp/m --strict; echo "RC=$?"
```

| fixture | RC | why it is kept |
| --- | --: | --- |
| `nested-range` | 0 | the accepted shape — `source` is an object whose own `source` key names the type |
| `nested-exact`, `nested-noversion` | 0 | `version` is optional and takes an exact version or a range |
| `flat-asclaimed` | 1 | the shape the design note originally recorded. It is **rejected** |
| `negative-control` | 1 | `"source": "nosuchsourcetype"`. Without it, `nested-range` passing would only show the validator is permissive |

⚠️ **Capture the real exit code, not a pipeline's.** `claude plugin validate … \| head` reports
`head`'s status. Both the measurement and its first re-run got this wrong before it was caught.
