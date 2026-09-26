/**
 * `paperlint toolchain` — install upstream TeX Live, with exactly the packages the venue profiles
 * declare, into paperlint's own cache, and banal (the page-geometry script HotCRP runs) at its pinned
 * commit (`adapters/banal/`). `paperlint build` offers the TeX Live install on a terminal.
 *
 * 🔴 WHY paperlint INSTALLS TeX AT ALL (rule 11). "Install TeX Live yourself" was a manual step with a
 * trap in it: the distribution packages cost 2.1 GB, and a smaller hand-picked set silently typeset
 * acmart papers in Computer Modern. The engine decision (2026-09-24) is TeX Live's pdflatex,
 * installed the way Playwright installs browsers: one command, a cache directory, idempotent.
 *
 * ── WHAT IT DOES ───────────────────────────────────────────────────────────────
 *   1. download install-tl-unx from the first CTAN mirror that returns a real archive — several
 *      mirrors, each download with its own time limit, TLS always verified (no `-k`, ever);
 *   2. install `scheme-basic` into `<cache>/<TeX Live year>` (measured 2026-09-01: 147 MB, 65 s);
 *   3. `tlmgr install` the union of every package the profiles declare;
 *   4. ACCEPT BY RESULT, NOT BY EXIT CODE: `kpsewhich` must find every declared proof file and
 *      every declared tool must be an executable in the bin directory. A gap fails the command
 *      and names the package. (tlmgr exits 1 on "package already present", and an apt step here
 *      once reported success having installed nothing: installers' exit codes are not evidence.)
 * A second run with everything present does nothing and says so; `--check` only reports.
 *
 * Where: `$PAPERLINT_TEXLIVE_DIR` when set (CI points its cache there), else
 * `$XDG_CACHE_HOME/paperlint/texlive`, else `~/.cache/paperlint/texlive` — one tree per TeX Live year inside.
 * Processes run through the injected `run` (the port `build.ts` uses), so the harness drives the
 * real download/unpack/verify logic against a fake mirror on disk, never the network.
 */
// eslint-disable-next-line boundaries/dependencies -- legacy I/O, moves behind a port in #76
import { spawnSync } from "node:child_process";
/* eslint-disable boundaries/dependencies -- legacy I/O, moves behind a port in #76 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
/* eslint-enable boundaries/dependencies */
// eslint-disable-next-line boundaries/dependencies -- legacy I/O, moves behind a port in #76
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  isExecutable,
  missingTools,
  missingDependencies,
  probeTree,
  supportedPlatform,
  type Runner,
} from "./engine.ts";
import type { Ready, ToolInstaller } from "./ports/tool-installer.ts";
import {
  declaredUnion,
  packageNames,
  type TexRequirements,
} from "./tex-requirements.ts";

export const CACHE_ENV = "PAPERLINT_TEXLIVE_DIR";
export const MIRROR_ENV = "PAPERLINT_CTAN_MIRROR";

/**
 * The CTAN mirrors, redirector first. 🔴 SEVERAL, AND THAT IS A MEASUREMENT: run 33650803245 died
 * on `curl: (60) SSL certificate problem` because `mirror.ctan.org` REDIRECTED to a community
 * mirror with an incomplete chain, and retrying follows the same redirect. The named university
 * mirrors after it keep stable chains. The cure is another mirror, never an unverified connection.
 */
export const DEFAULT_MIRRORS: readonly string[] = [
  "https://mirror.ctan.org/systems/texlive/tlnet",
  "https://ctan.math.illinois.edu/systems/texlive/tlnet",
  "https://mirrors.mit.edu/CTAN/systems/texlive/tlnet",
  "https://ftp.tu-chemnitz.de/pub/tex/systems/texlive/tlnet",
];

/** Per-download time limit, seconds: install-tl-unx is ~6 MB. */
export const DOWNLOAD_SECONDS = 180;
/** install-tl and tlmgr fetch hundreds of files; a hang still has to end. */
const INSTALL_MS = 20 * 60 * 1000;
const TLMGR_MS = 15 * 60 * 1000;

/** What the installer needs from the world. Everything else is computed. */
export interface ToolchainIO {
  readonly run: Runner;
  readonly log: (line: string) => void;
  readonly env: NodeJS.ProcessEnv;
}

/** One installed TeX Live in the cache. */
export interface CachedTree {
  readonly dir: string;
  readonly year: string;
  readonly bin: string;
}

// ── where ────────────────────────────────────────────────────────────────────────────

export function cacheRoot(
  env: NodeJS.ProcessEnv,
  home: string = homedir(),
): string {
  if (env[CACHE_ENV]) return env[CACHE_ENV];
  return join(
    env["XDG_CACHE_HOME"] || join(home, ".cache"),
    "paperlint",
    "texlive",
  );
}

/**
 * The platform directory under `<tree>/bin` that holds a RUNNABLE pdflatex — found, not guessed per
 * arch. Runnable, not merely present: the same `isExecutable` that `missingTools` asks.
 */
function binDirOf(tree: string): string | null {
  const bins = join(tree, "bin");
  if (!existsSync(bins)) return null;
  const arch = readdirSync(bins).find((a) =>
    isExecutable(join(bins, a, "pdflatex")),
  );
  return arch ? join(bins, arch) : null;
}

/** Every year in the cache that holds a tree with a pdflatex, newest first. */
export function cachedTrees(root: string): CachedTree[] {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((y) => /^\d{4}$/.test(y))
    .sort()
    .reverse()
    .map((year) => ({
      dir: join(root, year),
      year,
      bin: binDirOf(join(root, year)),
    }))
    .filter((t): t is CachedTree => t.bin !== null);
}

/** The newest tree in the cache, complete or not — where packages are added. */
export function cachedTree(root: string): CachedTree | null {
  return cachedTrees(root)[0] ?? null;
}

/**
 * The tree to USE: the newest one that is complete, else the newest one. 🔴 NOT simply the newest:
 * a new year's install interrupted after install-tl has a pdflatex and none of the venue's
 * packages, and building with it would be the silent font substitution this package exists to
 * refuse — while the complete older tree beside it builds correctly.
 */
export function usableTree<T>(
  trees: readonly T[],
  complete: (t: T) => boolean,
): T | null {
  return trees.find(complete) ?? trees[0] ?? null;
}

export function mirrorsFrom(env: NodeJS.ProcessEnv): readonly string[] {
  const own = env[MIRROR_ENV];
  return own ? [own.replace(/\/+$/, "")] : DEFAULT_MIRRORS;
}

// ── pure pieces ──────────────────────────────────────────────────────────────────────

/** `release-texlive.txt`'s first line: "TeX Live (https://tug.org/texlive) version 2026". */
export function tlYear(release: string): string | null {
  const first = release.split("\n", 1)[0] ?? "";
  return /\bversion (\d{4})\b/.exec(first)?.[1] ?? null;
}

/** The install-tl profile: scheme-basic, no docs or sources, every tree variable inside `dir`. */
export function tlProfile(dir: string): string {
  return [
    "selected_scheme scheme-basic",
    `TEXDIR ${dir}`,
    `TEXMFLOCAL ${dir}/texmf-local`,
    `TEXMFSYSVAR ${dir}/texmf-var`,
    `TEXMFSYSCONFIG ${dir}/texmf-config`,
    `TEXMFVAR ${dir}/user-var`,
    `TEXMFCONFIG ${dir}/user-config`,
    `TEXMFHOME ${dir}/texmf-home`,
    "instopt_adjustpath 0",
    "instopt_adjustrepo 1",
    "tlpdbopt_install_docfiles 0",
    "tlpdbopt_install_srcfiles 0",
    "",
  ].join("\n");
}

/** Package names tlmgr refused as unknown — an invented or renamed name, not a network problem. */
export function unknownPackages(tlmgrOutput: string): string[] {
  return tlmgrOutput
    .split("\n")
    .filter((l) => l.includes("not present in repository"))
    .map((l) => /package (\S+) not present/.exec(l)?.[1])
    .filter((n): n is string => Boolean(n));
}

/** The two release years tlmgr refused to bridge. */
export interface ReleaseGap {
  readonly local: string;
  readonly remote: string;
}

/**
 * tlmgr's refusal to install into a tree OLDER than the repository, or null. tlmgr has no
 * machine-readable form for it (`--machine-readable` adds only `fail load <location>`), so the two
 * years are read from its two documented wordings (tlmgr.pl, TeX Live 2026, lines 7644-7648 and
 * 7655-7663; `tldie` prefixes the program name) — the years are the structured part, the prose
 * around them is not relied on:
 *
 *   tlmgr: Local TeX Live (2025) is older than remote repository (2026).
 *
 *   tlmgr: The TeX Live versions of the local installation
 *   and the repository are not compatible:
 *         local: 2025
 *    repository: 2026 (https://…)
 *
 * The second wording also covers a STALE mirror (repository older than the tree); that is not a
 * new release, so only `remote > local` counts.
 */
export function releaseGap(tlmgrOutput: string): ReleaseGap | null {
  const lines = tlmgrOutput.split("\n").map((l) => l.trim());
  const older = lines
    .map((l) =>
      /\bLocal TeX Live \((\d{4})\) is older than remote repository \((\d{4})\)/.exec(
        l,
      ),
    )
    .find(Boolean);
  const local = older?.[1] ?? yearAfter(lines, "local:");
  const remote = older?.[2] ?? yearAfter(lines, "repository:");
  return local && remote && Number(remote) > Number(local)
    ? { local, remote }
    : null;
}

/** The year at the start of the value of the first `label value` line, e.g. `local: 2025`. */
function yearAfter(lines: readonly string[], label: string): string | null {
  const line = lines.find((l) => l.startsWith(label));
  return line
    ? (/^(\d{4})\b/.exec(line.slice(label.length).trim())?.[1] ?? null)
    : null;
}

/**
 * What a tree lacks: the venue's packages by `kpsewhich`, tools by executable, and packages the
 * tree's own database depends on but never installed (`tlmgr check depends`).
 */
export interface Gaps {
  readonly packages: readonly string[];
  readonly tools: readonly string[];
  readonly dependencies: readonly string[];
}

export const noGaps = (g: Gaps): boolean =>
  g.packages.length === 0 &&
  g.tools.length === 0 &&
  g.dependencies.length === 0;

/** `acmart (acmart.cls), texcount (texcount)` — a gap named with the file that proves it. */
export function describeGaps(g: Gaps, tex: TexRequirements): string {
  const named = (
    names: readonly string[],
    proofs: TexRequirements["packages"],
  ) => names.map((n) => `${n} (${(proofs[n] ?? []).join(", ")})`);
  return [
    ...named(g.packages, tex.packages),
    ...named(g.tools, tex.tools),
    ...g.dependencies.map(
      (d) => `${d} (a TeX Live dependency the install left out)`,
    ),
  ].join(", ");
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60
    ? `${s}s`
    : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
}

// ── processes ────────────────────────────────────────────────────────────────────────

const quiet = (io: ToolchainIO, timeout?: number) => ({
  encoding: "utf8" as const,
  stdio: ["ignore", "pipe", "pipe"] as ["ignore", "pipe", "pipe"],
  env: io.env,
  maxBuffer: 64 * 1024 * 1024,
  ...(timeout ? { timeout } : {}),
});

/** The last lines a process printed — what a failure shows. */
function tail(r: ReturnType<Runner>, n = 12): string[] {
  const text = `${String(r.stdout ?? "")}\n${String(r.stderr ?? "")}`;
  return text
    .split("\n")
    .filter((l) => l.trim())
    .slice(-n);
}

/** Ask the tree's own `kpsewhich` and bin directory what is missing. */
export function gapsOf(
  tree: CachedTree,
  tex: TexRequirements,
  run: Runner,
): Gaps {
  return {
    packages: probeTree(tree.bin, tex.packages, run),
    tools: missingTools(tex.tools, tree.bin),
    dependencies: missingDependencies(tree.bin, run),
  };
}

/**
 * Download install-tl-unx from the first mirror that returns a real archive. The archive is
 * judged by LISTING it: a truncated file and a mirror's HTML error page both have a size.
 */
export function downloadInstaller(
  io: ToolchainIO,
  mirrors: readonly string[],
  dest: string,
): string | null {
  for (const mirror of mirrors) {
    const url = `${mirror}/install-tl-unx.tar.gz`;
    const r = io.run(
      "curl",
      [
        "-fsSL",
        "--retry",
        "2",
        "--retry-delay",
        "2",
        "--max-time",
        String(DOWNLOAD_SECONDS),
        "-o",
        dest,
        url,
      ],
      quiet(io),
    );
    if (r.error || r.status !== 0) {
      io.log(
        `  ⚠ ${url}: ${tail(r, 1)[0] ?? r.error?.message ?? `curl exited ${String(r.status)}`}`,
      );
      continue;
    }
    if (io.run("tar", ["tzf", dest], quiet(io)).status === 0) return mirror;
    io.log(
      `  ⚠ ${url} returned something that is not a .tar.gz — trying the next mirror`,
    );
  }
  return null;
}

/** Unpack the installer into `work` and return its directory (`install-tl-YYYYMMDD`). */
function unpack(io: ToolchainIO, archive: string, work: string): string | null {
  const r = io.run("tar", ["xzf", archive, "-C", work], quiet(io));
  if (r.status !== 0) return null;
  const dir = readdirSync(work).find((d) => d.startsWith("install-tl-"));
  return dir ? join(work, dir) : null;
}

export type Step<T> = { ok: true; value: T } | { ok: false; lines: string[] };

/** Download, unpack and run install-tl: a fresh scheme-basic tree in `<root>/<year>`. */
export function installBase(
  io: ToolchainIO,
  root: string,
  mirrors: readonly string[],
  newerThan: string | null = null,
): Step<{ tree: CachedTree; mirror: string }> {
  const work = realpathSync(
    mkdtempSync(join(tmpdir(), "paperlint-install-tl-")),
  );
  try {
    io.log(`  downloading install-tl…`);
    const mirror = downloadInstaller(
      io,
      mirrors,
      join(work, "install-tl.tar.gz"),
    );
    if (!mirror)
      return {
        ok: false,
        lines: [
          `no CTAN mirror returned install-tl — tried ${mirrors.join(", ")}`,
          `set ${MIRROR_ENV}=<a tlnet URL> to use another one`,
        ],
      };
    const installer = unpack(io, join(work, "install-tl.tar.gz"), work);
    const release = installer ? join(installer, "release-texlive.txt") : "";
    const year =
      installer && existsSync(release)
        ? tlYear(readFileSync(release, "utf8"))
        : null;
    if (!installer || !year)
      return {
        ok: false,
        lines: [
          `the archive from ${mirror} does not hold an install-tl with a release-texlive.txt`,
        ],
      };
    // 🔴 Installing the SAME year again would run install-tl over the tree that is already there.
    if (newerThan && Number(year) <= Number(newerThan))
      return {
        ok: false,
        lines: [
          `tlmgr reported a newer TeX Live than ${newerThan}, but install-tl from ${mirror} is ${year} — the mirrors disagree about the current release`,
          `set ${MIRROR_ENV}=<a tlnet URL> to one that serves the new release`,
        ],
      };
    return runInstallTl(io, { installer, root, year, mirror, work });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function runInstallTl(
  io: ToolchainIO,
  a: {
    installer: string;
    root: string;
    year: string;
    mirror: string;
    work: string;
  },
): Step<{ tree: CachedTree; mirror: string }> {
  const dir = join(a.root, a.year);
  mkdirSync(dir, { recursive: true });
  const profile = join(a.work, "paperlint.profile");
  writeFileSync(profile, tlProfile(dir));
  io.log(
    `  install-tl: TeX Live ${a.year} scheme-basic from ${a.mirror} (~150 MB, about a minute)…`,
  );
  const r = io.run(
    join(a.installer, "install-tl"),
    ["-profile", profile, "-repository", a.mirror, "-no-interaction"],
    quiet(io, INSTALL_MS),
  );
  const bin = binDirOf(dir);
  if (r.error || r.status !== 0 || !bin)
    return {
      ok: false,
      lines: [
        `install-tl failed (${r.error?.message ?? `exit ${String(r.status)}`}) — its last lines:`,
        ...tail(r),
      ],
    };
  return {
    ok: true,
    value: { tree: { dir, year: a.year, bin }, mirror: a.mirror },
  };
}

/**
 * `tlmgr install` the missing packages, trying the mirrors in turn. Success is judged by the
 * GAPS AFTERWARDS, not by tlmgr's exit code (it exits 1 on "already present"). An unknown package
 * name fails at once: another mirror will not know it either.
 */
export type AddStep =
  | { readonly ok: true; readonly value: { gaps: Gaps; tail: string[] } }
  | { readonly ok: false; readonly lines: string[] }
  | { readonly ok: false; readonly newer: ReleaseGap };

export function installPackages(
  io: ToolchainIO,
  tree: CachedTree,
  tex: TexRequirements,
  mirrors: readonly string[],
): AddStep {
  let gaps = gapsOf(tree, tex, io.run);
  let last: string[] = [];
  for (const mirror of mirrors) {
    if (noGaps(gaps)) break;
    const want = [...gaps.packages, ...gaps.tools, ...gaps.dependencies];
    const repairsBase = gaps.dependencies.length > 0;
    io.log(`  tlmgr: installing ${want.length} package(s) from ${mirror}…`);
    const r = io.run(
      join(tree.bin, "tlmgr"),
      ["--repository", mirror, "install", ...want],
      quiet(io, TLMGR_MS),
    );
    const output = `${String(r.stdout ?? "")}\n${String(r.stderr ?? "")}`;
    // A new release: every mirror serves it, so trying the next one only repeats the refusal.
    const newer = releaseGap(output);
    if (newer) return { ok: false, newer };
    const unknown = unknownPackages(output);
    if (unknown.length)
      return {
        ok: false,
        lines: [
          `tlmgr does not know: ${unknown.join(", ")} — the name in the venue profile is wrong or was renamed on CTAN`,
          `find the package by file: tlmgr search --global --file <file>`,
        ],
      };
    last = tail(r);
    // A dependency of the base was missing, so the formats it feeds were never built (pdflatex dies
    // before writing a log without them). Build the missing ones now that the package is in.
    if (repairsBase)
      io.run(join(tree.bin, "fmtutil-sys"), ["--missing"], quiet(io, TLMGR_MS));
    gaps = gapsOf(tree, tex, io.run);
  }
  return { ok: true, value: { gaps, tail: last } };
}

/** Total size of a directory in MB — measured, so the success line never quotes a stale number. */
export function sizeMB(dir: string): number {
  let bytes = 0;
  for (const e of readdirSync(dir, { recursive: true, withFileTypes: true }))
    if (e.isFile()) bytes += statSync(join(e.parentPath, e.name)).size;
  return Math.round(bytes / 1024 / 1024);
}

// ── the command ──────────────────────────────────────────────────────────────────────

export interface ToolchainOptions {
  readonly check?: boolean;
  readonly log?: (line: string) => void;
  readonly err?: (line: string) => void;
  readonly env?: NodeJS.ProcessEnv;
  readonly run?: Runner;
  readonly platform?: NodeJS.Platform;
  readonly home?: string;
  /** The requirements to install — every profile's union by default. */
  readonly tex?: TexRequirements;
  readonly now?: () => number;
  /** banal's installer. The composition root wires it (`cli.ts`); the harness passes its own. */
  readonly banal: ToolInstaller;
}

export type InstallResult =
  { readonly ok: true; readonly tree: CachedTree } | { readonly ok: false };

/**
 * Make the cache hold every package of `tex`: install TeX Live when there is none, add only the
 * missing packages when there is one, verify either way. Used by `paperlint toolchain` and by `paperlint build`
 * after a "yes".
 */
export function ensureTexLive(
  tex: TexRequirements,
  o: Required<Omit<ToolchainOptions, "check" | "platform" | "tex" | "banal">>,
): InstallResult {
  const io: ToolchainIO = { run: o.run, log: o.log, env: o.env };
  const root = cacheRoot(o.env, o.home);
  const mirrors = mirrorsFrom(o.env);
  const started = o.now();
  const existing = cachedTree(root);
  const tree: Step<CachedTree> = existing
    ? { ok: true, value: existing }
    : installFresh(io, root, mirrors, null);
  if (!tree.ok) return fail(o.err, tree.lines);
  let added = installPackages(io, tree.value, tex, mirrors);
  let used = tree.value;
  if (!added.ok && "newer" in added) {
    const next = newRelease(io, {
      root,
      mirrors,
      old: tree.value,
      gap: added.newer,
    });
    if (!next.ok) return fail(o.err, next.lines);
    used = next.value;
    added = installPackages(io, used, tex, mirrors);
  }
  const verified = verify(added, used, tex);
  if (!verified.ok) return fail(o.err, verified.lines);
  o.log(
    `✓ TeX Live ${used.year} is ready in ${used.dir}: ${verified.value} ` +
      `${sizeMB(used.dir)} MB, ${formatDuration(o.now() - started)}`,
  );
  o.log(binLine(used));
  if (used !== tree.value) o.log(leftInPlace(tree.value));
  return { ok: true, tree: used };
}

/** A fresh scheme-basic tree, as a plain Step. */
function installFresh(
  io: ToolchainIO,
  root: string,
  mirrors: readonly string[],
  newerThan: string | null,
): Step<CachedTree> {
  const base = installBase(io, root, mirrors, newerThan);
  return base.ok ? { ok: true, value: base.value.tree } : base;
}

/**
 * 🔴 tlmgr refused: the mirrors serve a newer TeX Live than the cached tree, and tlmgr does not
 * add packages across releases. The cure is a FRESH tree for the new year in its own directory —
 * the same install an empty cache gets — not `update-tlmgr-latest --upgrade` in place: that
 * rewrites a working tree, and an interrupted upgrade leaves no working tree at all. The old one
 * stays until the new one has verified, and after that too: deleting a user's directory is not
 * this command's decision.
 */
function newRelease(
  io: ToolchainIO,
  a: {
    root: string;
    mirrors: readonly string[];
    old: CachedTree;
    gap: ReleaseGap;
  },
): Step<CachedTree> {
  io.log(
    `  tlmgr refused: the repository is TeX Live ${a.gap.remote}, the tree in ${a.old.dir} is ${a.gap.local}, ` +
      `and tlmgr does not install across releases — installing TeX Live ${a.gap.remote} beside it`,
  );
  return installFresh(io, a.root, a.mirrors, a.old.year);
}

/** Accept by result: what the tree still lacks after tlmgr decides, not tlmgr's exit code. */
function verify(
  added: AddStep,
  tree: CachedTree,
  tex: TexRequirements,
): Step<string> {
  if ("newer" in added)
    return {
      ok: false,
      lines: [
        `tlmgr still refuses: the repository is TeX Live ${added.newer.remote} and the new tree in ${tree.dir} is ${added.newer.local}`,
      ],
    };
  if (!added.ok) return added;
  if (!noGaps(added.value.gaps))
    return {
      ok: false,
      lines: [
        `TeX Live ${tree.year} in ${tree.dir} still lacks, after tlmgr: ${describeGaps(added.value.gaps, tex)}`,
        `add the package that carries the file to the venue profile; find it with: tlmgr search --global --file <file>`,
        ...(added.value.tail.length
          ? [`tlmgr's last lines:`, ...added.value.tail]
          : []),
      ],
    };
  const files = new Set(Object.values(tex.packages).flat()).size;
  return {
    ok: true,
    value:
      `${packageNames(tex).length} packages verified ` +
      `(${files} files found by kpsewhich, ${Object.keys(tex.tools).length} tools),`,
  };
}

/** The superseded tree is named, with the space it holds — and left alone. */
export const leftInPlace = (old: CachedTree): string =>
  `  TeX Live ${old.year} in ${old.dir} is left in place and no longer used (${sizeMB(old.dir)} MB); ` +
  `delete that directory to free the space`;

/**
 * `paperlint build` finds the tree itself; a script that calls `pdflatex` directly needs this directory
 * first on PATH, so every success says where it is.
 */
export const binLine = (tree: CachedTree): string => `  bin: ${tree.bin}`;

function fail(
  err: (line: string) => void,
  lines: readonly string[],
): InstallResult {
  const [head, ...rest] = lines;
  err(`✗ paperlint toolchain: ${head ?? "failed"}`);
  for (const l of rest) err(`    ${l}`);
  return { ok: false };
}

/** The options with defaults filled in. */
type Resolved = Required<ToolchainOptions>;

function withDefaults(o: ToolchainOptions): Resolved {
  return {
    check: o.check ?? false,
    log: o.log ?? console.log,
    err: o.err ?? console.error,
    // eslint-disable-next-line no-restricted-globals -- legacy I/O, moves behind a port in #76
    env: o.env ?? process.env,
    run: o.run ?? spawnSync,
    // eslint-disable-next-line no-restricted-globals -- legacy I/O, moves behind a port in #76
    platform: o.platform ?? process.platform,
    home: o.home ?? homedir(),
    tex: o.tex ?? declaredUnion().tex,
    now: o.now ?? Date.now,
    banal: o.banal,
  };
}

export const UNSUPPORTED =
  "Windows is not supported: paperlint installs TeX Live with install-tl-unx (Linux, macOS). " +
  "Install TeX Live yourself (https://tug.org/texlive/windows.html) — paperlint build uses a TeX Live on PATH " +
  "once it has every package the venue declares.";

/** `--check`: report, change nothing. Exit 0 only when every declared package is present. */
function report(o: Resolved, tree: CachedTree | null): number {
  const n = packageNames(o.tex).length;
  if (!tree) {
    o.log(
      `✗ no TeX Live in ${cacheRoot(o.env, o.home)} — \`npx paperlint toolchain\` installs ${n} packages (~230 MB, ~2 min)`,
    );
    return 1;
  }
  const gaps = gapsOf(tree, o.tex, o.run);
  if (noGaps(gaps)) {
    o.log(
      `✓ TeX Live ${tree.year} in ${tree.dir} has all ${n} declared packages`,
    );
    o.log(binLine(tree));
    return 0;
  }
  const declared = gaps.packages.length + gaps.tools.length;
  // A dependency the install left out is not one of the venue's declared packages: counted apart,
  // so the line never reads "lacks 0 of 51" followed by a name.
  const what = [
    ...(declared ? [`${declared} of ${n} declared packages`] : []),
    ...(gaps.dependencies.length
      ? [`${gaps.dependencies.length} TeX Live base package(s)`]
      : []),
  ].join(" and ");
  o.log(
    `✗ TeX Live ${tree.year} in ${tree.dir} lacks ${what}: ${describeGaps(gaps, o.tex)}`,
  );
  o.log(`  run \`npx paperlint toolchain\` to install them`);
  return 1;
}

/** The banal half, installed or checked, through its installer. True when banal is ready. */
function banalPart(o: Resolved): boolean {
  const tool = o.banal;
  if (o.check) {
    const r = tool.check();
    if (r.ok) o.log(`✓ ${tool.label} is installed and runs`);
    else {
      o.log(`✗ ${tool.label}: ${r.error.join("; ")}`);
      o.log("  run `npx paperlint toolchain` to install it");
    }
    return r.ok;
  }
  const r = tool.ensure(o.log);
  if (!r.ok) {
    fail(o.err, r.error);
    return false;
  }
  o.log(readyLine(tool.label, r.value));
  return true;
}

/** The ready line takes a `Ready`: only an installer mints one, so it cannot be printed for a tool that was not verified and run. */
export function readyLine(label: string, r: Ready): string {
  return r.fresh
    ? `✓ ${label} is ready in ${r.where}: ${r.verified}`
    : `✓ ${label} in ${r.where} is verified and runs — nothing to do`;
}

/** The TeX Live half: 0 when every declared package is present (or now installed). */
function texPart(o: Resolved): number {
  const complete = (t: CachedTree) => noGaps(gapsOf(t, o.tex, o.run));
  const tree = usableTree(cachedTrees(cacheRoot(o.env, o.home)), complete);
  if (o.check) return report(o, tree);
  const n = packageNames(o.tex).length;
  // 🔴 A complete tree is left alone even when CTAN has moved to a newer year: a new release is
  // reason to install only when tlmgr refuses to add a newly declared package to the old tree.
  if (tree && complete(tree)) {
    o.log(
      `✓ TeX Live ${tree.year} in ${tree.dir} already has all ${n} declared packages — nothing to do`,
    );
    o.log(binLine(tree));
    return 0;
  }
  o.log(
    `paperlint toolchain: TeX Live with ${n} packages into ${cacheRoot(o.env, o.home)}`,
  );
  return ensureTexLive(o.tex, o).ok ? 0 : 1;
}

/**
 * `paperlint toolchain [--check]`. Both halves always run, so one failure does not hide the other; the
 * exit code is 0 only when both are ready.
 */
export function runToolchain(options: ToolchainOptions): number {
  const o = withDefaults(options);
  if (!supportedPlatform(o.platform)) {
    o.err(`✗ paperlint toolchain: ${UNSUPPORTED}`);
    return 1;
  }
  const tex = texPart(o);
  const banal = banalPart(o);
  return tex === 0 && banal ? 0 : 1;
}
