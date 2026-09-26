/**
 * The shell around `resolveEngine` for `paperlint build`: gather the facts, act on the decision, and
 * hand the build an environment whose PATH starts with the chosen TeX Live.
 *
 * One decision per run, not per paper: the question "install TeX Live?" is asked at most ONCE, for
 * the union of what the targeted papers need. The install itself is `ensureTexLive` — the same code
 * `paperlint toolchain` runs, so "yes" here and the command there cannot install different things.
 */
// eslint-disable-next-line boundaries/dependencies -- legacy I/O, moves behind a port in #76
import { spawnSync } from "node:child_process";
// eslint-disable-next-line boundaries/dependencies -- legacy I/O, moves behind a port in #76
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import {
  resolveEngine,
  missingDependencies,
  probeTree,
  supportedPlatform,
  whichOnPath,
  type EngineDecision,
  type EngineFacts,
  type Runner,
  type TreeProbe,
} from "./engine.ts";
import {
  UNSUPPORTED,
  cacheRoot,
  cachedTrees,
  ensureTexLive,
  usableTree,
  type InstallResult,
} from "./toolchain.ts";
import {
  declaredUnion,
  mergeRequirements,
  type TexRequirements,
} from "./tex-requirements.ts";

export interface EngineOptions {
  /** What the targeted papers need: the base set plus each paper's venue. */
  readonly tex: TexRequirements;
  readonly dryRun?: boolean;
  readonly interactive?: boolean;
  readonly ask?: (question: string) => Promise<string>;
  readonly log?: (line: string) => void;
  readonly err?: (line: string) => void;
  readonly env?: NodeJS.ProcessEnv;
  readonly run?: Runner;
  readonly platform?: NodeJS.Platform;
  readonly home?: string;
  readonly now?: () => number;
  /** The install a "yes" runs — `ensureTexLive` over every declared package by default. */
  readonly install?: () => InstallResult;
}

export type EngineOutcome =
  | { readonly ok: true; readonly env: NodeJS.ProcessEnv }
  | { readonly ok: false; readonly code: number };

type Resolved = Required<Omit<EngineOptions, "install">> & {
  install: () => InstallResult;
};

/** The options a caller actually set — `undefined` must still get its default, so no plain spread. */
const defined = <T extends object>(o: T): Partial<T> =>
  Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== undefined),
  ) as Partial<T>;

function withDefaults(o: EngineOptions): Resolved {
  const r = {
    dryRun: false,
    interactive: false,
    ask: async () => "",
    log: console.log,
    err: console.error,
    // eslint-disable-next-line no-restricted-globals -- legacy I/O, moves behind a port in #76
    env: process.env,
    run: spawnSync,
    // eslint-disable-next-line no-restricted-globals -- legacy I/O, moves behind a port in #76
    platform: process.platform,
    home: homedir(),
    now: Date.now,
    ...defined(o),
    tex: o.tex,
  };
  return {
    ...r,
    // The shipped union AND what the targeted papers need: a project's own preset lives outside
    // the package, and its packages are only in `r.tex`.
    install:
      o.install ??
      (() => ensureTexLive(mergeRequirements(declaredUnion().tex, r.tex), r)),
  };
}

/**
 * The facts `resolveEngine` decides on: paperlint's cache and the PATH's TeX Live, each probed. The cache
 * may hold one tree per TeX Live year; the one reported is the newest COMPLETE one, else the newest
 * (so a new year whose install was interrupted never wins over a complete older year).
 */
export function gatherFacts(o: Resolved): EngineFacts {
  const probes = cachedTrees(cacheRoot(o.env, o.home)).map(
    (tree): TreeProbe => ({
      label: `TeX Live ${tree.year} — paperlint cache (${tree.dir})`,
      bin: tree.bin,
      // Only a cache tree is asked for its dependencies: its tlmgr writes where we own.
      missing: [
        ...probeTree(tree.bin, o.tex.packages, o.run),
        ...missingDependencies(tree.bin, o.run),
      ],
    }),
  );
  const cache = usableTree(probes, (p) => p.missing.length === 0);
  const dir = whichOnPath("pdflatex", o.env["PATH"]);
  const system: TreeProbe | null = dir
    ? {
        label: `TeX Live on PATH (${join(dir, "pdflatex")})`,
        bin: dir,
        missing: probeTree(dir, o.tex.packages, o.run),
      }
    : null;
  return {
    supported: supportedPlatform(o.platform),
    cache,
    system,
    interactive: o.interactive && !o.dryRun,
    required: Object.keys(o.tex.packages).sort(),
  };
}

const names = (missing: readonly string[]): string =>
  `${missing.length} package(s): ${missing.join(", ")}`;

/** The one line a run without a human gets. It names the command and what is missing. */
export function refusal(d: EngineDecision, facts: EngineFacts): string {
  const missing = d.kind === "refuse" || d.kind === "ask" ? d.missing : [];
  const sys =
    facts.system && facts.system.missing.length
      ? `; ${join(facts.system.bin, "pdflatex")} lacks: ${facts.system.missing.join(", ")}`
      : "";
  if (d.kind === "refuse" && d.reason === "unsupported")
    return `✗ paperlint build: ${UNSUPPORTED} (missing: ${names(missing)}${sys})`;
  return `✗ paperlint build: no TeX Live with every package these papers need — run \`npx paperlint toolchain\` (missing: ${names(missing)}${sys})`;
}

/** The question a terminal gets — once per run. */
export function question(facts: EngineFacts, root: string): string {
  if (facts.cache)
    return `TeX Live in ${root} lacks ${names(facts.cache.missing)}. Install them now? [Y/n] `;
  return `TeX Live is not installed (needed to compile paper.tex, ~230 MB, ~2 min). Install it now into ${root}? [Y/n] `;
}

/** "", "y", "yes" (any case) is yes — the default is to install. An unanswerable question is no. */
export const isYes = (answer: string | null): boolean =>
  answer !== null && ["", "y", "yes"].includes(answer.trim().toLowerCase());

const onPath = (env: NodeJS.ProcessEnv, bin: string): NodeJS.ProcessEnv => ({
  ...env,
  PATH: [bin, env["PATH"] ?? ""].join(delimiter),
});

async function answerOf(o: Resolved, q: string): Promise<string | null> {
  try {
    return await o.ask(q);
  } catch {
    return null;
  }
}

/** Ask, install on yes, and use the cache when the install verified. */
async function askAndInstall(
  o: Resolved,
  facts: EngineFacts,
  d: EngineDecision,
): Promise<EngineOutcome> {
  const root = cacheRoot(o.env, o.home);
  if (facts.system?.missing.length)
    o.log(
      `${join(facts.system.bin, "pdflatex")} is not used: it lacks ${facts.system.missing.join(", ")}`,
    );
  if (!isYes(await answerOf(o, question(facts, root)))) {
    o.err(refusal(d, facts));
    return { ok: false, code: 1 };
  }
  const installed = o.install();
  if (!installed.ok) return { ok: false, code: 1 };
  const after = gatherFacts(o).cache;
  if (!after || after.missing.length) {
    o.err(
      refusal(
        {
          kind: "refuse",
          reason: "not-installed",
          missing: after?.missing ?? [],
        },
        facts,
      ),
    );
    return { ok: false, code: 1 };
  }
  o.log(`engine: ${after.label}`);
  return { ok: true, env: onPath(o.env, after.bin) };
}

/**
 * Decide which TeX Live builds these papers. `--dry-run` decides and prints, and never asks or
 * installs: a plan must not have side effects.
 */
export async function prepareEngine(
  options: EngineOptions,
): Promise<EngineOutcome> {
  const o = withDefaults(options);
  const facts = gatherFacts(o);
  const d = resolveEngine(facts);
  if (d.kind === "use-cache" || d.kind === "use-system") {
    o.log(`engine: ${d.tree.label}`);
    return {
      ok: true,
      env: d.kind === "use-cache" ? onPath(o.env, d.tree.bin) : o.env,
    };
  }
  if (o.dryRun) {
    o.log(
      `engine: none — a real run would stop here: ${refusal(d, facts).slice(2)}`,
    );
    return { ok: true, env: o.env };
  }
  if (d.kind === "ask") return askAndInstall(o, facts, d);
  o.err(refusal(d, facts));
  return { ok: false, code: 1 };
}
