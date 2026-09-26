# Skills

Every skill paperlint ships, by the stages of [the pipeline](../README.md#-the-pipeline). Each line
says what you get; the skill's name is the second column.

You do not call them by name: you ask Claude Code for the thing ("is this idea worth a paper?"), and
the skill whose description matches starts. `paperlint init` installs them into
`.claude/skills/` ([`install.md`](install.md)). Each one's full instructions are its
`skills/<name>/SKILL.md`.

`test/skills-catalog.test.ts` fails when this list and the shipped `skills/` directory disagree.

## Across every stage

| you get                                                                                   | skill            |
| ----------------------------------------------------------------------------------------- | ---------------- |
| a guided path through the stages: what to do now, and which skill does it                 | `paper-pipeline` |
| where the paper stands, measured: pages from the real build, what is checked, what blocks | `paper-status`   |

## 1 · Idea

| you get                                                                                 | skill                   |
| --------------------------------------------------------------------------------------- | ----------------------- |
| a go / no-go on the idea, with the reason and the smallest result that makes a paper    | `research-ideate`       |
| who already works on it, dated against your deadline, and what you can still claim      | `map-prior-work`        |
| one close competitor read in full: is yours "just X?", and the sentence that answers it | `analyze-sibling-paper` |
| candidate mechanisms from other fields, when the work needs a design, not a measurement | `sweep-design-space`    |

## 2 · Venue

| you get                                                                        | skill                   |
| ------------------------------------------------------------------------------ | ----------------------- |
| a ranked list of venues that fit: deadline, page limit, indexing, remote talks | `find-venue`            |
| what papers accepted at that venue do well, and what would make yours stronger | `study-accepted-papers` |
| the deadlines worked backwards, as events in your calendar                     | `plan-paper-timeline`   |

## 3 · Study

| you get                                                                                    | skill             |
| ------------------------------------------------------------------------------------------ | ----------------- |
| a study design with honest statistics, and a reproduction artifact that checks its numbers | `build-benchmark` |

## 4 · Draft

| you get                                                                            | skill            |
| ---------------------------------------------------------------------------------- | ---------------- |
| a first draft from your results: claims sized, threats to validity written         | `draft-paper`    |
| an outline where each section follows from the one before                          | `argument-arc`   |
| a cut plan: what to cut, merge or move to the appendix                             | `tighten-paper`  |
| what a reader with no context understood from your last edit, sentence by sentence | `cold-read-diff` |
| the compiled pages as images, to read on a screen or a phone                       | `render-paper`   |

## 5 · Review

| you get                                                                       | skill                      |
| ----------------------------------------------------------------------------- | -------------------------- |
| a writing grade, with the sentence to fix for each point                      | `grade-paper-writing`      |
| every cited work confirmed to exist, with the right authors, title and year   | `verify-citations`         |
| one hostile review: overclaims, missing baselines, holes in the method        | `paper-adversarial-review` |
| a simulated program committee: several reviews, a decision and the must-fixes | `pc-panel-review`          |
| ready or not ready to submit, worst problem first                             | `harden-paper`             |

## 6 · Submit

| you get                                                             | skill                 |
| ------------------------------------------------------------------- | --------------------- |
| the submission, step by step: anonymization, the form, the artifact | `submit-paper`        |
| the reproduction artifact uploaded to OSF for anonymous review      | `osf-artifact-upload` |

## 7 · Camera-ready

| you get                                                                                    | skill          |
| ------------------------------------------------------------------------------------------ | -------------- |
| the final version: authors back, the artifact public with a DOI, any disclosure done first | `camera-ready` |

## 8 · Extend

| you get                                                       | skill          |
| ------------------------------------------------------------- | -------------- |
| a plan for the next, stronger paper built on the accepted one | `extend-paper` |
