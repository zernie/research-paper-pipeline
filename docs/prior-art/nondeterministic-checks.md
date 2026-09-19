# Checks whose verdict can change without the file changing

**Question this file answers:** a linter is normally a pure function of a file's bytes. Some
useful checks are not — they read the clock, compare modification times, or need a before/after
pair. Do real tools ship such checks, and how do they contain the damage?

**Verdict:** yes, they exist and they are respectable — but the tools that ship them
(a) make the non-deterministic condition **opt-in**, (b) **suppress it** in the context where it
would block someone who cannot fix it, and (c) **prefer a condition over recorded data** to a
condition over the clock wherever both are possible. Two of the three shapes below dissolve
entirely once the fact is recorded rather than inferred.

---

## Shape 1: the clock — `unicorn/expiring-todo-comments`

The canonical time-dependent lint rule. A comment carries an expiry and starts being reported
once it passes:

```js
// TODO [2018-05-01]: Do this thing
```

Two defaults are the whole lesson:

- **`checkDates` defaults to `false`.** The date condition — the only non-deterministic one —
  ships switched off.
- **`checkDatesOnPullRequests` also defaults to `false`.** Even with dates enabled, the rule
  does not fire on pull requests, so the person blocked is the maintainer who wrote the TODO,
  not a contributor who merely touched the file.

And the shape of the rest of the rule is the real argument. Of its six conditions, **five are
over declared data** and only one is over the clock:

| condition | example | deterministic? |
| --- | --- | --- |
| package version | `[>1]` | yes — reads `package.json` |
| engine version | `[engine:node@>8]` | yes |
| dependency present / absent | `[+package]` · `[-package]` | yes |
| dependency version | `[package@>1]` | yes |
| peer dependency version | `[peer:eslint@>9]` | yes |
| **expiry date** | `[2018-05-01]` | **no** |

There is a standing issue titled "failing the lint on a date may be inconvenient", which is the
community arriving at the same discomfort from the other direction.

Sources:
<https://github.com/sindresorhus/eslint-plugin-unicorn/blob/main/docs/rules/expiring-todo-comments.md>
· <https://github.com/sindresorhus/eslint-plugin-unicorn/issues/1541>

## Shape 2: the before/after pair — Semgrep `--baseline-commit`

A check that wants to see what a change *did* seems to need an event. It does not.

> A diff-aware scan runs on your code before and after some "baseline" and only reports findings
> that are newly introduced in the commits after that baseline.

The same deterministic analysis is run on two revisions and the results are subtracted. Nothing
in the rule knows about events; the *runner* supplies two inputs.

The cost is that the second input comes from git history, which brings its own constraint: a CI
checkout that fetches one commit cannot produce a baseline. That is a property of the pipeline,
not of the rule, and it has to be arranged deliberately.

Sources: <https://semgrep.dev/docs/semgrep-ci/findings-ci> · <https://semgrep.dev/docs/cli-reference>

## Shape 3: modification times — and this one is not a lint at all

Comparing the mtime of a built artefact against the mtime of its source is what a **build
system** does (`make`, `ninja`). It is non-deterministic in the way that matters here: a fresh
clone gives every file the same checkout timestamp, so the verdict changes without any content
changing.

The fix is not to accept the non-determinism but to **record the fact**: store a content hash of
the source alongside the artefact, and the question "is this build stale?" becomes
`sha256(source) !== recorded`, which is pure, file-only, and expressible as an ordinary rule.

---

## What this means for this package

1. **Prefer a recorded fact to an inferred one.** Wherever a check currently reasons about
   *when* something happened, ask whether the paper can simply declare *what* it was built from.
   A stage that records `source_sha256` turns two separate staleness checks into byte
   comparisons.

2. **A hash of CONTENT, not a git object.** A commit id is a pointer that history rewriting,
   garbage collection and shallow clones can all invalidate; the bytes cannot. If the check is
   about the file, the recorded fact must be about the file.

3. **If a check must stay non-deterministic, it must not block, and it should be opt-in.**
   That is what `checkDates: false` encodes, and the reasoning transfers unchanged.

4. **A diff-shaped check has two legitimate homes** — a runner that supplies two revisions
   (Semgrep's model), or an editor/agent hook, which is handed the before and after of a single
   edit for free and needs no git at all. The second is not a workaround for a missing
   mechanism; it is using the event source that exists.

See also: [`blocking-vs-advisory.md`](blocking-vs-advisory.md).
