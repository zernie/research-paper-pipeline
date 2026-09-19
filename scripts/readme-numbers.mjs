#!/usr/bin/env node
/**
 * The README names numbers. Here they are PRODUCED and checked against the named ones.
 *
 * 🔴 WHY THIS EXISTS AT ALL. This repository's `CLAUDE.md` says: "A number in a commit message
 * that no command produced is the thing this repo exists to make impossible". The README
 * meanwhile carried four such numbers, written BY HAND and, on top of that, IN WORDS
 * ("Forty-five of those"). Measured 2026-09-17: 45 harnesses and 22 batteries promised, 49 and 27
 * on disk. They diverged silently, because there was nothing to check them against — and a number
 * written as a word cannot be compared even with grep.
 *
 * 🔴 AND THE SECOND REASON THE SCRIPT IS BUILT EXACTLY THIS WAY. The first version of the rule
 * counter counted `default.rules` and silently filed everything else under "not a rule plugin".
 * On `tex-build.mjs`, which exports its rules DIRECTLY in `default`, it lost two rules and
 * confidently printed 8 instead of 10. That is precisely "a counter that counts what it ignores":
 * a skip promises nothing, while a counter promises coverage.
 *
 * So a module whose shape could not be recognized is an ERROR, not a skip. The modules with no
 * rules are listed BY NAME below: a new unnamed module will not be able to vanish quietly.
 */
import { readdirSync, readFileSync, lstatSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Modules in `eslint-rules/` that have NO rules by construction, with the reason. The list is
 * by name precisely because "has no rules" and "shape not recognized" must be distinguishable.
 */
const NOT_RULE_PLUGINS = new Map([
  ["papers.mjs", "path helpers: DEFAULT_PAPERS_ROOT, paperFiles, papersRoot"],
  ["latex-language.mjs", "the `tex/latex` LANGUAGE, not a rule plugin"],
]);

/** Counts the rules, accepting BOTH export shapes that exist in this repository. */
export async function countRules(root = ROOT) {
  const dir = join(root, "eslint-rules");
  let total = 0;
  const unknown = [];
  for (const f of readdirSync(dir).sort()) {
    if (!f.endsWith(".mjs") || /\.(harness|mutations)\.mjs$/.test(f)) continue;
    if (NOT_RULE_PLUGINS.has(f)) continue;
    const mod = await import(join(dir, f));
    const d = mod.default;
    // Shape A: `{ rules: { … } }` — a plugin. Shape B: `{ … }` — the rules themselves, as in
    // tex-build.
    const rules = d?.rules ?? d;
    const looksLikeRules =
      rules && typeof rules === "object" && Object.values(rules).every((r) => r && typeof r.create === "function");
    if (!looksLikeRules) {
      unknown.push(f);
      continue;
    }
    total += Object.keys(rules).length;
  }
  if (unknown.length) {
    const e = new Error(
      `could not recognize the export shape: ${unknown.join(", ")}. ` +
        `This is an ERROR, not a skip: a silent skip has already cost two rules. ` +
        `Either the module exports rules, or it is named in NOT_RULE_PLUGINS with a reason.`,
    );
    e.unknown = unknown;
    throw e;
  }
  return total;
}

/**
 * Files by suffix, recursively, skipping node_modules.
 *
 * 🔴 `lstatSync`, NOT `statSync`, AND THIS IS LOAD-BEARING. `statSync` FOLLOWS THE SYMLINK, and
 * in this repository `.claude/skills/*` is twenty-four symlinks back into `skills/`. The first
 * version counted 83 harnesses instead of 49: the same files were counted twice, once for each
 * path leading to them. Caught not by eye but by a discrepancy with two independent commands —
 * `git ls-files` and `find` both give 49. A symlink to a directory is not a new directory.
 */
export function countFiles(root, suffix) {
  let n = 0;
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      if (e === "node_modules" || e === ".git") continue;
      const p = join(d, e);
      const st = lstatSync(p);
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) walk(p);
      else if (e.endsWith(suffix)) n++;
    }
  };
  walk(root);
  return n;
}

export async function actualCounts(root = ROOT) {
  return {
    rules: await countRules(root),
    harnesses: countFiles(root, ".harness.mjs"),
    batteries: countFiles(root, ".mutations.mjs"),
    skills: readdirSync(join(root, "skills")).filter((d) => lstatSync(join(root, "skills", d)).isDirectory()).length,
  };
}

/**
 * The numbers DECLARED in the README. The form is an explicit marker, not prose:
 * `<!-- count:rules -->10`. In digits, not in words, precisely because there is nothing to
 * compare "Forty-five" against.
 */
export function declaredCounts(text) {
  const out = {};
  for (const { key, value } of countDeclarations(text)) out[key] = value;
  return out;
}

/**
 * EVERY occurrence, in order — not a map keyed by counter name.
 *
 * 🔴 WHY THIS EXISTS, AND IT IS A MEASURED HOLE IN THIS VERY CHECK (2026-09-19). `declaredCounts`
 * assigns into an object, so a second `<!-- count:rules -->` in the same file SILENTLY REPLACES
 * the first and the first is never compared against anything. Proven by mutation: a duplicate
 * marker was added to the README's intro and set to `11` against `12` on disk, and this check
 * stayed GREEN at exit 0. Two markers read as twice the coverage and delivered less than one.
 *
 * That is the exact class this repository keeps re-finding: a counter that counts what it
 * ignores. The verdict loop below now judges every occurrence, so a wrong copy is a finding no
 * matter where it sits — and the same applies across DECLARING_FILES, where `declared[k] = v`
 * used to let CONTRIBUTING.md's value shadow the README's.
 */
export function countDeclarations(text) {
  const out = [];
  for (const m of text.matchAll(/<!--\s*count:([a-z]+)\s*-->\s*(\d+)/g))
    out.push({ key: m[1], value: Number(m[2]) });
  return out;
}

/**
 * 🔴 TWO FILES, NOT ONE, and this is not a relaxation. On 17.09 the README was cut down to what
 * the user needs, and the testing methodology was moved to CONTRIBUTING.md — together with the
 * harness and battery numbers. A check that knows one file would have answered "the README has
 * not a single marker" and would have been FORMALLY right: the numbers did not go anywhere, they
 * moved. The requirement stayed the same and just as strong: EVERY number on disk must be
 * declared somewhere in these files. All that changes is where exactly.
 */
export const DECLARING_FILES = ["README.md", "CONTRIBUTING.md"];

if (import.meta.url === `file://${process.argv[1]}`) {
  // Every occurrence is kept, because judging only the last one is how this check went hollow.
  const occurrences = {}; // counter -> [{ file, value }], in file then document order
  for (const f of DECLARING_FILES) {
    for (const { key, value } of countDeclarations(readFileSync(join(ROOT, f), "utf-8"))) {
      (occurrences[key] ??= []).push({ file: f, value });
    }
  }
  const declared = Object.fromEntries(
    Object.entries(occurrences).map(([k, list]) => [k, list[0].value]),
  );
  const actual = await actualCounts();
  const keys = Object.keys(actual);

  // An empty scan is NOT "there are no discrepancies". Without this guard, deleting every marker
  // from the README would make the check green forever.
  if (Object.keys(declared).length === 0) {
    console.error(`🔴 none of ${DECLARING_FILES.join(", ")} has a \`<!-- count:… -->\` marker — there is nothing to check against, so the check asserts nothing`);
    process.exit(1);
  }

  const bad = [];
  for (const k of keys) {
    if (!(k in occurrences)) {
      bad.push(`  ${k}: ${actual[k]} on disk, and declared neither in README nor in CONTRIBUTING`);
      continue;
    }
    // EVERY copy is compared. A duplicate that disagrees is a finding wherever it sits.
    occurrences[k].forEach(({ file, value }, i) => {
      if (value === actual[k]) return;
      const which = occurrences[k].length > 1 ? ` (copy ${i + 1} of ${occurrences[k].length})` : "";
      bad.push(`  ${k}: ${file}${which} promises ${value}, ${actual[k]} on disk`);
    });
  }
  for (const k of Object.keys(declared)) {
    if (!keys.includes(k)) bad.push(`  ${k}: ${declared[k]} declared, but there is no such counter`);
  }

  if (bad.length) {
    console.error("🔴 numbers are named that are not on disk:");
    for (const b of bad) console.error(b);
    console.error("\n  The numbers in the README are produced by this command, not written by hand.");
    process.exit(1);
  }
  console.log(
    `✓ ${keys.map((k) => `${k} ${actual[k]}`).join(" · ")} — every number checked against disk`,
  );
}
