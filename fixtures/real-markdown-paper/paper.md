---
title: "Caveman Promises 65% Fewer Tokens. My Bill Didn't Move."
slug: "token-savings-wrong-number"
date: "2026-07-07"
updated: "2026-08-28"
description: "A Claude Code plugin with 97,000 stars promises to cut your AI coding bill by 65%, by making the model drop the filler and grunt. It does make the model write less — but those words are only a fifth of what you actually pay for, so even a perfect trim caps out near 13%. Metered over 70 runs with a correctness gate on every one, the bill came out the same."
tags:
  ["ai", "engineering", "evals", "benchmarks", "developer-tools", "claude-code"]
---

**[Caveman](https://github.com/JuliusBrussee/caveman)** is a Claude Code plugin with 97,000 GitHub
stars. It saves you tokens by making the AI drop the filler and grunt — fewer words out, smaller
bill. That's the pitch.

I tried it. The AI really did get terser on five of the seven jobs I ran; on the other two it got
wordier. My bill didn't budge.

_The measurement behind this post has since been peer-reviewed: accepted at AgenticDev 2026, a
workshop of [ASE 2026](https://conf.researchr.org/home/ase-2026), to appear in the ACM Digital
Library._

## Not all tokens cost the same

You pay for four kinds of token, at very different prices. Per million, on Sonnet 4.5, which these
runs were billed at:

- **output** (the words the model writes back) — **$15**
- **cache-writes** (putting context into the cache the first time) — **$3.75**
- **input** (the text you send) — **$3**
- **cache-reads** (context it has already seen) — **$0.30**

So one word the model writes costs as much as fifty words it re-reads.

And it re-reads a lot. Every turn, the model goes back over the whole conversation: your files, the
test output, everything said so far. Then it adds a few words at the end. Those few words are about
**0.6% of the tokens** in a session. Almost all the rest is context — what you send it and, mostly, what it re-reads.

Few words, but each one fifty times dearer — so in money they come to about **20% of your bill**.

That fifth is the **ceiling**: the whole slice a skill can touch by shortening the model's words.
The rest is context, and no amount of terseness makes it smaller.

## Even a perfect 65% trim is only 13% off the bill

Take that ceiling and multiply it by how much shorter the answers actually get:

- The advertised trim — **65% shorter**, per the
  [README](https://github.com/JuliusBrussee/caveman)
  ([pinned](https://github.com/JuliusBrussee/caveman/blob/e2c09c9a7e66d6bb30cadb5f955bd8a36b0e8d9a/README.md))
  — takes 65% of that fifth: **13% off the bill**. The best you could hope for if the claim were
  true.
- The measured trim — **6% shorter**, which is what I got on average — takes 6% of that fifth, and
  lands under anything a bill can show you.
- Stop the model answering altogether and you save the fifth. That is the whole ceiling, and it
  costs you every answer.

On a subscription you don't get a bill, you get a
[quota](https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work), and
Anthropic doesn't publish how it's weighted. Whatever the weights are, they price the same four
kinds of token — so output is worth somewhere between those two ends of your limit. Both are small,
and the ceiling holds either way.

## Output fell 6%. The bill didn't move.

Seven coding jobs, from a one-line helper up to a multi-file refactor, each run **ten times: five
with the skill, five without**. Every run had to pass a correctness check — no "savings" from
broken answers. Each run's real dollar cost was metered with
**[vigiles](https://github.com/zernie/vigiles)**, an open harness I built, and you can
[rerun the whole thing](https://github.com/zernie/vigiles/tree/main/bench/ecosystem) on your own
subscription.

<details>
<summary>How the runs were measured</summary>

Ten times each, because the same prompt costs a different amount every time you run it — measure
once and you end up quoting noise as a result. That is 70 runs, or 140 counting the second skill in
the appendix.

</details>

The skill was working — the answers came back telegraphic from the first message. Output shrank
about **6% on average**, not 65%, and the average hides the shape: it cut hard on two jobs, mildly on three, and
made the model write _more_ on the other two. The bill came out the same — the gap was smaller than what one
job costs on two runs with no skill at all.

I'm not the first to check the label, and nobody who measured it came back with anything like 65%.
Max Taylor
[benchmarked caveman against the two words "be brief"](https://www.maxtaylor.me/articles/i-benchmarked-caveman-against-two-words)
and found it didn't beat that boring default. JetBrains
[ran 86 real coding tasks](https://blog.jetbrains.com/ai/2026/07/speak-to-ai-agents-like-cavemen-tosave-tokens/)
with the skill forced on and watched output fall by single digits — and their own totals came out
_more expensive_, not cheaper, because one costly outlier run flipped the sign.

<details>
<summary>What the JetBrains study actually reported</summary>

Output fell **8.5%** against the advertised 65%. They expected about 10% cheaper per task, in their
words "routinely erased by single-trial variance", but their pooled totals came out **11.6% more
expensive** ($40.60 against $36.39) — one
outlier trial flipped the sign. Per task they expect a saving, pooled they got a penalty, and
neither is anywhere near 65%.

The same study shows how badly single runs lie: their ten-task smoke test, run once, said
**−29.5%**; the same ten tasks at three runs each said **−6.7%**. Their headline 86-task number is
itself a single run per task. Mine ran five.

</details>

## Where the 65% came from

Not a lie — a measurement of the wrong thing. The headline 65% was self-measured on **10 one-shot
prompts**. One prompt, one reply, no files, no tools, no re-reading — the
one setting where the reply basically _is_ the whole session, with no re-reading for it to get
lost in. Trim it there and you trim almost the whole token count.

Real coding is the opposite. The reply is no longer the session, and code compresses far less than
the rambling "helpful assistant" prose their baseline measured against — so the same skill trims
about 6%. The number was measured in the one setting where it is big, then printed on the box for
the setting where it is tiny.

<details>
<summary>The full numbers (per-task, both skills, p-values)</summary>

**Where the 20% comes from.** Output is ~0.6% of the tokens at ~50× the cache-read price. On a
napkin:

```
             volume   price   cost
writes         0.6%  ×  50  =   30
re-reads        99%  ×   1  =   99

output's share of the bill:  30 / 129  ≈  23%
```

The napkin says output is ~23% of the bill; measured against the recorded dollar cost of my runs
it's **20.5%**, a touch lower because real sessions also pay for input and for writing to the
cache. The body rounds that to 20%.

**Two skills here, not one.** Caveman is the 65% headline the article is about; **token-efficient**
is the next most-starred skill in the same category, advertising a 63% cut the same way — I ran it
through the identical harness to check whether falling this far short of the ceiling is a caveman
thing or a category thing. It's the category.

Seven tasks × five trials × two arms = 70 runs per skill, 140 across both, on Sonnet (~$10
API-equivalent, $0 on my subscription).

Output change per task — negative means the skill cut output, positive means it grew — with a
Welch p-value, a check that doesn't assume both arms are equally noisy (they never are). Read the
p as "the odds of seeing a gap this big if the skill did nothing"; `*` marks p&lt;.05.

The two Caveman cuts (.002, .006) survive a Bonferroni correction, which just means: testing seven
things at once makes a fluke more likely, and these two still hold up after allowing for that.

| Task            | Caveman outΔ | p          | token-efficient outΔ | p      |
| --------------- | ------------ | ---------- | -------------------- | ------ |
| slugify         | +54%         | .27        | −2%                  | .78    |
| debounce        | −28%         | .22        | −7%                  | .52    |
| bugfix-offbyone | **−31%**     | **.002\*** | −6%                  | .87    |
| bigO            | −18%         | .27        | +6%                  | .79    |
| regex-email     | **−28%**     | **.006\*** | +127%                | .037\* |
| review-doc      | −8%          | .80        | +54%                 | .46    |
| refactor-suite  | +21%         | .65        | +33%                 | .19    |

Pooled dollars across every run: **Caveman −1%**, **token-efficient +10%**. Both are smaller than
this study can resolve, but they differ in character. Token-efficient got more expensive on 5 of
the 7 tasks (regex-email +49%, review-doc +21%, refactor +9%, slugify +7%, bigO +6%; only debounce
−13% and the bugfix −5% got cheaper). Caveman's −1% is noise around zero.

Averaged per task, Caveman's output cut is **5.6%** — the body's "about 6%"; pooled it is **9.1%**.
Either way a ~20% slice turns that into 1–2% of the bill.

Output is ~20% of the dollar cost in both arms, and every answer stayed correct: **zero correctness
regressions across all 140 runs**.

**The skill isn't free.** Its always-loaded prompt is itself context: across every run the caveman
arm carried **9% more cached tokens** than baseline, and on the shortest task **71% more** — which
is why the cheapest task came out 66% dearer. That's a systematic penalty on short sessions, not
only noise.

**The spread.** Per task, the dollar change swings from **16% cheaper** (the bugfix, p=.03) to
**66% more expensive** (slugify — the cheapest task, where a little run-to-run noise looks enormous
as a percentage).

With five trials a task, the 95% CI on the pooled bill change runs from **14% cheaper to 12%
dearer**, so this design can't cleanly resolve a cost effect below about 13%. A 13% saving — the
label's own best case — would have sat right at the edge of what these runs could see.

It doesn't need to. The precision comes from the **~20% structural ceiling**, not the sample size:
you don't need a big study to rule out a big saving when the ceiling on the saving is itself small.

One aside: the API's _per-minute_ rate limits are a separate axis from cost —
cache-reads mostly don't count toward the input-rate limit and output has its own bucket. If you're
pinned against the output-per-minute limit specifically, trimming output does buy throughput;
that's a narrow case, and it isn't your monthly bill or quota.

The correctness gate is a structural check, not a quality judgement: it bounds information loss,
it doesn't prove the answers were as good.

Per-arm measurements from all 140 runs (means, σ, n): [the JSON](/data/token-savings-runs.json), and the
[`/caveman-compress` test](/data/token-savings-compress-runs.json). Method + harness:
[`vigiles`](https://github.com/zernie/vigiles).

</details>

## The savings are in what reloads, not in what it says

Caveman's backup trick — compressing your _instructions_ file — is a rounding error too: I shrank
one by two thirds and the bill didn't care — a few-hundred-token file next to a ~100,000-token session.

Want a smaller bill, or more runway before your limit? Don't squeeze the words — squeeze what
reloads every turn:

- A 10k-line test log or a sprawling `git diff`, pulled in once and then silently re-read every
  turn after. That pile is what grows your bill.
- A conversation nobody trims. Hand work to subagents so the main thread stays small.
- `/compact` cuts the big cheap pile directly, which is almost all your cost.

I haven't measured these — leads, not promises.

## Before you install the next one

Trimming what the model says, to bring down what you pay, is ordering a smaller dessert to shrink
the dinner bill. Most of the bill was never the dessert.

So: which tokens does it cut, and did anyone price a real session rather than a one-line prompt?
