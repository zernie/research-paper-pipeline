/**
 * WHICH TeX LIVE `paperlint build` COMPILES WITH — decided from facts, and never a TeX Live that lacks a
 * package the paper's venue declares.
 *
 * 🔴 WHY "HAS pdflatex" IS NOT THE QUESTION. A TeX Live without `libertine.sty` builds an acmart
 * paper GREEN: the class notices the missing font, falls back to Computer Modern, and the PDF looks
 * fine in the wrong typeface with another pagination. That is how a submitted paper went out. So a
 * TeX Live qualifies only when `kpsewhich` finds every file the venue declares (issue #26).
 *
 * The order (the Playwright pattern, decided 2026-09-24):
 *   1. paperlint's own cache (`paperlint toolchain` installs it) — when it has everything;
 *   2. a TeX Live already on PATH — when IT has everything;
 *   3. neither: on a terminal, ask once and install; without one (CI, an agent), refuse in one line
 *      that names `npx paperlint toolchain` and the missing packages. Never a silent install without a
 *      human, never a build on a TeX Live that would typeset the wrong font.
 *
 * `resolveEngine` is that order as a PURE function over `EngineFacts`, table-tested. The rest of
 * this file gathers the facts (probing a tree runs `kpsewhich` through the injected `run`, the port
 * `build.ts` already uses) and acts on the decision.
 */
// eslint-disable-next-line boundaries/dependencies -- legacy I/O, moves behind a port in #76
import { spawnSync } from "node:child_process";
// eslint-disable-next-line boundaries/dependencies -- legacy I/O, moves behind a port in #76
import { accessSync, constants, statSync } from "node:fs";
import { basename, delimiter, join } from "node:path";
import type { TexRequirements } from "./tex-requirements.ts";

/** A process runner with `spawnSync`'s shape — the port the harness replaces. */
export type Runner = typeof spawnSync;

/** One TeX Live and what it lacks for the papers at hand. */
export interface TreeProbe {
  /** How to name it to a human: `paperlint cache, TeX Live 2026` / `/usr/bin/pdflatex`. */
  readonly label: string;
  /** The directory holding `pdflatex` and `kpsewhich`. */
  readonly bin: string;
  /** Declared packages whose proof files `kpsewhich` did not find, sorted. */
  readonly missing: readonly string[];
}

export interface EngineFacts {
  /** install-tl-unx runs here (Linux, macOS). */
  readonly supported: boolean;
  /** paperlint's cached TeX Live, probed — or null when there is none. */
  readonly cache: TreeProbe | null;
  /** The `pdflatex` on PATH, probed — or null when there is none. */
  readonly system: TreeProbe | null;
  /** A human can answer a question (a terminal on both ends, CI unset). */
  readonly interactive: boolean;
  /** Every package the papers need — what an install into an EMPTY cache would add. */
  readonly required: readonly string[];
}

export type EngineDecision =
  | { readonly kind: "use-cache"; readonly tree: TreeProbe }
  | { readonly kind: "use-system"; readonly tree: TreeProbe }
  | { readonly kind: "ask"; readonly missing: readonly string[] }
  | {
      readonly kind: "refuse";
      readonly reason: "unsupported" | "not-installed";
      readonly missing: readonly string[];
    };

/**
 * The decision. `missing` in `ask` and `refuse` is what `paperlint toolchain` would install: the cache's
 * gaps when a cache exists, every required package when it does not.
 */
export function resolveEngine(f: EngineFacts): EngineDecision {
  if (f.cache && f.cache.missing.length === 0)
    return { kind: "use-cache", tree: f.cache };
  if (f.system && f.system.missing.length === 0)
    return { kind: "use-system", tree: f.system };
  const missing = f.cache ? f.cache.missing : f.required;
  if (!f.supported) return { kind: "refuse", reason: "unsupported", missing };
  if (f.interactive) return { kind: "ask", missing };
  return { kind: "refuse", reason: "not-installed", missing };
}

// ── facts ───────────────────────────────────────────────────────────────────────────────

/** install-tl-unx covers Linux and macOS; Windows needs install-tl-windows and is not supported. */
export const supportedPlatform = (platform: NodeJS.Platform): boolean =>
  platform === "linux" || platform === "darwin";

/**
 * The declared packages whose proofs are NOT in `found` (the paths `kpsewhich` printed). kpsewhich
 * given several names prints one line per name it found and nothing for the rest, so the match is
 * by the file name of each printed path.
 */
export function missingPackages(
  packages: TexRequirements["packages"],
  found: string,
): string[] {
  const have = new Set(
    found
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((p) => basename(p)),
  );
  return Object.entries(packages)
    .filter(([, proofs]) => proofs.some((f) => !have.has(f)))
    .map(([name]) => name)
    .sort();
}

/**
 * `path` is a program that can be started: a REGULAR FILE, and on POSIX one this process may
 * execute. `existsSync` is not the question — it says yes to a directory and to a file without
 * the execute bit, and `paperlint toolchain --check` then reported a verified tree whose `texcount`
 * could not run.
 *
 * On win32 `X_OK` means nothing (Node documents it as behaving like `F_OK` there): whether a file
 * runs is decided by its extension, not a permission bit. So on win32 the check is "exists and is
 * a regular file", which is all the platform can answer.
 */
export function isExecutable(
  path: string,
  // eslint-disable-next-line no-restricted-globals -- legacy I/O, moves behind a port in #76
  platform: NodeJS.Platform = process.platform,
): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    if (platform !== "win32") accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** The declared tools (programs) that have no executable in `bin`. */
export function missingTools(
  tools: TexRequirements["tools"],
  bin: string,
  exists: (path: string) => boolean = isExecutable,
): string[] {
  return Object.entries(tools)
    .filter(([, bins]) => bins.some((b) => !exists(join(bin, b))))
    .map(([name]) => name)
    .sort();
}

/** Every proof file, once — the arguments of one `kpsewhich` call. */
const proofFiles = (packages: TexRequirements["packages"]): string[] => [
  ...new Set(Object.values(packages).flat()),
];

/**
 * Ask the `kpsewhich` in `bin` for every proof file. A kpsewhich that cannot be started finds
 * nothing, so every package counts as missing — "could not ask" must never read as "all present".
 */
export function probeTree(
  bin: string,
  packages: TexRequirements["packages"],
  run: Runner = spawnSync,
): string[] {
  const files = proofFiles(packages);
  if (files.length === 0) return [];
  const r = run(join(bin, "kpsewhich"), files, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (r.error) return Object.keys(packages).sort();
  return missingPackages(packages, String(r.stdout ?? ""));
}

/**
 * Packages the tree's OWN database lists as dependencies but never installed, by its `tlmgr check
 * depends`. 🔴 The venue's `.sty` files are not enough evidence of a working tree: install-tl that
 * cannot download a package prints "continuing anyway", and a missing `unicode-data` leaves every
 * `.sty` in place while the pdflatex format cannot be built — pdflatex then dies before writing a
 * log. Only paperlint's cache trees are asked: their tlmgr writes to a directory we own. A tlmgr
 * that cannot start returns nothing here; the tree is then judged by `probeTree` alone.
 */
export function missingDependencies(
  bin: string,
  run: Runner = spawnSync,
): string[] {
  const r = run(join(bin, "tlmgr"), ["check", "depends"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (r.error) return [];
  const lines = String(r.stdout ?? "").split("\n");
  const start = lines.findIndex(
    (l) => l.trim() === "DEPENDS WITHOUT PACKAGES:",
  );
  if (start < 0) return [];
  // The section runs until tlmgr's next header. Headers open with a form feed and a space, entries
  // with the package name, so a header is any line with leading whitespace.
  const section = lines.slice(start + 1);
  const end = section.findIndex((l) => l !== l.trimStart() || !l.trim());
  return [
    ...new Set(
      (end < 0 ? section : section.slice(0, end)).map((l) =>
        l.split(" in: ")[0]!.trim(),
      ),
    ),
  ].sort();
}

/** The first directory on `path` holding a runnable `name` — what a shell would run. */
export function whichOnPath(
  name: string,
  path: string | undefined,
  exists: (p: string) => boolean = isExecutable,
): string | null {
  for (const dir of (path ?? "").split(delimiter))
    if (dir && exists(join(dir, name))) return dir;
  return null;
}
