# Who decides to fail the run — the rule, or the runner?

**Question this file answers:** when a check finds something, what decides whether the build
goes red: a property of the check, or a decision of whatever invoked it?

**Verdict:** in every tool examined, severity is **data attached to the finding or the rule**,
and the decision to fail is made by the **runner**. No tool examined lets a check decide, in its
own body, that the process must stop.

---

## Danger JS — the closest analogue, because it lints the PROCESS

Danger exists to check facts about a change rather than about code: did you update the
changelog, is this PR too large, does it touch a file that requires a second reviewer. That is
the same family as "a paper declares a submitted stage but no frozen PDF is on disk".

Its levels are not a severity field — they are **four separate functions**:

| function | effect |
| --- | --- |
| `fail()` | declares a CI-blocking error |
| `warn()` | reports, does not block |
| `message()` | adds a row to the table |
| `markdown()` | free-form output |

So the author of a check chooses the level **at the call site**, and the level is structural
rather than a string somebody parses later.

Source: <https://danger.systems/js/reference.html>

## reviewdog — non-blocking by default, failing is the runner's flag

reviewdog ingests diagnostics from any linter and posts them as review comments.

> By default Reviewdog will return 0 as exit code once all actions done (linter report
> analyzed, comments posted and so on). Once `fail-on-error` flag passed — Reviewdog will
> return 1 as exit code if at least one violation was found/reported.

The important part is **where the flag lives**: on the invocation, not on the rule. The same
rule set is advisory in one pipeline and blocking in another without editing a rule.

A recurring complaint is worth recording because it is a design warning, not a bug report:
when `--fail-on-error` is enabled, reviewdog fails on **any** result regardless of the
diagnostic level — people did not want an `info` diagnostic to turn the build red. In other
words: a single global "fail on anything" switch is too coarse once levels exist at all.

Sources: <https://github.com/reviewdog/reviewdog> ·
<https://github.com/reviewdog/reviewdog/issues/856>

## ESLint — severity is a value in the config, keyed by rule id

The model this package already consumes. `off` / `warn` / `error` sit in the config against a
rule **identifier**; the rule body never decides. `error` is what makes the process exit
non-zero. The severity of a rule can be changed without touching the rule.

## Clippy — four levels, per lint, overridable

`allow` / `warn` / `deny` / `forbid`, set per lint and overridable on the command line
(`-D warnings` being the familiar CI incantation). Again: the lint declares a default, the
invoker decides.

---

## What this means for this package

1. **A finding must be a record, not a rendered string.** `{ rule, severity, where, message }`.
   Anything that reads severity out of the message text — an emoji, a prefix, a keyword — is
   the same defect as parsing prose for a fact: it works until someone rewrites the sentence.

2. **The blocking decision belongs to the entry point.** `rpp lint` in CI may exit non-zero on
   `error`; an editor hook running the same rules should not block at all. Same rules, two
   policies, no rule edited.

3. **A single "fail on anything" switch is not enough** once more than one level exists — the
   reviewdog complaint above is exactly that lesson, reported by its users.

4. **Default to not blocking.** This is also the house position for a separate, measured
   reason: a gate that fails on taste gets routed around, and once people route around a gate
   they stop reading the binary findings it also carried.

See also: [`nondeterministic-checks.md`](nondeterministic-checks.md) — a check whose verdict can
change without the file changing is a check that must not block, whatever its severity.
