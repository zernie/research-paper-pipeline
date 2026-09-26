/**
 * THE FILES PAPERLINT OWNS — read off its own config, and made the only thing ESLint may reach.
 *
 * paperlint's blocks name the files they lint (`PIPELINE-STATUS.md`, `paper.md`, `paper.tex`,
 * `reviews/*.md`, …). That list is the whole scope of `paperlint lint`, and this module turns it
 * into two things ESLint understands:
 *
 * 1. **A global ignore of everything else** (`scopeToOwned`). Handing ESLint a directory is not
 *    enough: its built-in defaults lint every JavaScript file it finds, whatever our config says.
 *    Measured on a consumer project with vendored code under a paper's `repro/` folder: 1,877
 *    files, 74 errors ("'return' outside of function", "Definition for rule … was not found"),
 *    zero of them on a paper file, exit 1 — and nothing in the settings could turn it off. With
 *    the ignore, a stray script under the papers directory is never enumerated at all, and a file
 *    named on the command line can be asked about (`ESLint#isPathIgnored`) with ESLint's own
 *    matcher instead of a hand-written one.
 *
 * 2. **Each rule scoped to the files it was written for** (`ruleOwners` + `narrowToOwners`).
 *    One plugin NAME is bound to different plugin objects in different blocks: `paper` holds
 *    `stages`/`source`/`author-list` beside `PIPELINE-STATUS.md` and `research-question`/
 *    `typography` beside `paper.md`/`paper.tex`. So a consumer block that named `paper/source`
 *    for every file under the papers directory reached `paper.tex`, where `paper` has no `source`
 *    — and ESLint threw `Could not find "source" in plugin "paper"` from inside `lintFiles`,
 *    after paperlint's own validation had (correctly) accepted the id. A block is therefore split
 *    per owner and its `files` ANDed with the owner's (ESLint's nested-array form), so a rule can
 *    only land where its plugin is registered.
 *
 * Both read ONE definition of "the files paperlint lints": `ownedScopes`, each own block's `files`
 * together with its `ignores`. The globs alone are not that definition. The sibling-card block
 * claims every markdown file under `siblings/` EXCEPT the index, and a rule whose plugin is
 * registered for every file (`pdf`) used to keep the consumer block's `files` as they were — so a
 * venue preset's rules reached `siblings/README.md`, a block with no `language` matched it, and
 * ESLint parsed the markdown as JavaScript (#101). Now every generated block narrows to scopes,
 * exceptions included, and a plugin registered everywhere owns exactly what paperlint lints.
 *
 * ESLint's semantics that this leans on, each measured against ESLint 10 before writing it:
 * - a global-ignore pattern that matches a DIRECTORY hides everything inside it, so directories
 *   must be un-ignored (`!` + a pattern ending in a slash) before owned files can be;
 * - that un-ignores `node_modules/` and `.git/` too — ESLint's own defaults — so they are
 *   re-ignored after, or a `paper.md` inside a dependency would be linted;
 * - later global-ignore patterns win, across blocks, in config order;
 * - `files: [["a", "b"]]` matches a file only when BOTH patterns match.
 */
import type { RuleBlock, RuleEntry } from "./rules-config.ts";

/** What this module reads of a config block. */
interface Block {
  readonly files?: readonly unknown[];
  readonly ignores?: readonly unknown[];
  readonly plugins?: Readonly<
    Record<string, { readonly rules?: Readonly<Record<string, unknown>> }>
  >;
}

/**
 * A set of files paperlint lints: an own block's globs and the exceptions that block makes. A file is
 * in it when it matches one of `files` and none of `ignores`.
 */
export interface OwnedScope {
  readonly files: readonly string[];
  readonly ignores: readonly string[];
}

/** A `files` entry: one glob, or several that must ALL match. */
export type FilesEntry = string | readonly string[];

/** A consumer block after narrowing: its `files` may carry ANDed pairs. */
export interface ScopedBlock {
  readonly basePath: string;
  readonly files?: readonly FilesEntry[];
  readonly ignores?: readonly string[];
  readonly rules: Readonly<Record<string, RuleEntry>>;
}

const globsOf = (b: Block): string[] =>
  (b.files ?? []).filter((f): f is string => typeof f === "string");

const stringsOf = (xs: readonly unknown[] | undefined): string[] =>
  (xs ?? []).filter((x): x is string => typeof x === "string");

/**
 * Scopes with the same exceptions, merged into one: their globs united, once, in order. Keeps a
 * generated block per distinct set of exceptions rather than one per own block.
 */
const merged = (scopes: readonly OwnedScope[]): OwnedScope[] => {
  const byIgnores = new Map<string, OwnedScope>();
  for (const s of scopes) {
    const key = JSON.stringify(s.ignores);
    const had = byIgnores.get(key);
    byIgnores.set(key, {
      files: [...new Set([...(had?.files ?? []), ...s.files])],
      ignores: s.ignores,
    });
  }
  return [...byIgnores.values()];
};

/**
 * THE FILES PAPERLINT LINTS: every own block that names `files`, with its `ignores`. A block without
 * `files` (a global ignore, or the block registering `pdf` for every file) claims nothing.
 */
export function ownedScopes(own: readonly unknown[]): OwnedScope[] {
  return merged(
    own
      .map((raw) => raw as Block)
      .filter((b) => b.files !== undefined)
      .map((b) => ({ files: globsOf(b), ignores: stringsOf(b.ignores) })),
  );
}

/** Every glob paperlint's own blocks lint, once, in config order. */
export function ownedPatterns(own: readonly unknown[]): string[] {
  return [...new Set(ownedScopes(own).flatMap((s) => s.files))];
}

/** ESLint's default ignores, re-applied after directories are un-ignored. */
const ESLINT_DEFAULT_IGNORES = ["**/node_modules/", "**/.git/"];

/** A global-ignore block that leaves ESLint nothing to lint but `owned`. */
export function scopeToOwned(owned: readonly string[]): {
  readonly ignores: string[];
} {
  return {
    ignores: [
      "**/*",
      "!**/*/",
      ...owned.map((p) => `!${p}`),
      ...ESLINT_DEFAULT_IGNORES,
    ],
  };
}

/** Every `<plugin>/<rule>` a block registers. */
const ruleIdsOf = (b: Block): string[] =>
  Object.entries(b.plugins ?? {}).flatMap(([name, plugin]) =>
    Object.keys(plugin.rules ?? {}).map((rule) => `${name}/${rule}`),
  );

/**
 * Rule id → the scopes of the blocks that register its plugin with that rule. A plugin registered
 * for every file (a block without `files`) owns every scope — everything paperlint lints, and not
 * one file more.
 */
export function ruleOwners(
  own: readonly unknown[],
): Map<string, readonly OwnedScope[]> {
  const all = ownedScopes(own);
  const found = new Map<string, OwnedScope[]>();
  for (const raw of own) {
    const b = raw as Block;
    const scopes =
      b.files === undefined
        ? all
        : [{ files: globsOf(b), ignores: stringsOf(b.ignores) }];
    for (const id of ruleIdsOf(b))
      found.set(id, [...(found.get(id) ?? []), ...scopes]);
  }
  return new Map([...found].map(([id, scopes]) => [id, merged(scopes)]));
}

/**
 * One consumer block → one block per owner scope, each carrying only that owner's rules, its `files`
 * ANDed with the scope's globs and its `ignores` joined by the scope's exceptions. A rule no block
 * of this config registers (the LaTeX block is absent when its parser did not load) gets no block:
 * it has no file to reach in this run, and naming it to ESLint would only crash.
 */
export function narrowToOwners(
  block: RuleBlock,
  owners: ReadonlyMap<string, readonly OwnedScope[]>,
): ScopedBlock[] {
  const groups = new Map<string, Record<string, RuleEntry>>();
  for (const [id, entry] of Object.entries(block.rules)) {
    const owner = owners.get(id);
    if (owner === undefined) continue;
    const key = JSON.stringify(owner);
    groups.set(key, { ...groups.get(key), [id]: entry });
  }
  return [...groups].flatMap(([key, rules]) =>
    (JSON.parse(key) as OwnedScope[]).map((scope) =>
      within(block, scope, rules),
    ),
  );
}

/** `block`'s rules over the files both it and `scope` claim, minus both sets of exceptions. */
function within(
  block: RuleBlock,
  scope: OwnedScope,
  rules: Readonly<Record<string, RuleEntry>>,
): ScopedBlock {
  const files: readonly FilesEntry[] = block.files
    ? block.files.flatMap((f) => scope.files.map((o) => [f, o]))
    : scope.files;
  const ignores = [...(block.ignores ?? []), ...scope.ignores];
  return {
    basePath: block.basePath,
    files,
    ...(ignores.length ? { ignores } : {}),
    rules,
  };
}
