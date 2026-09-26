/**
 * `engine.ts` — which TeX Live `paperlint build` compiles with.
 *
 * Tables, in order:
 *   1. `resolveEngine` over `EngineFacts` — one row per branch of the order;
 *   2. the fact readers: `missingPackages` over kpsewhich output, `missingTools`, `whichOnPath`,
 *      `probeTree` through a fake runner.
 * All pure or port-driven: no TeX needed. The real-TeX half is `test/e2e/build.mjs`.
 */
import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const {
  resolveEngine,
  missingPackages,
  missingTools,
  whichOnPath,
  isExecutable,
  probeTree,
  missingDependencies,
  supportedPlatform,
} = await import(join(HERE, "engine.ts"));

let n = 0;
const check = (label, cond, detail = "") => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ""}`);
  n++;
};

// ── 1. resolveEngine ────────────────────────────────────────────────────────────────────
const tree = (label, missing = []) => ({ label, bin: `/${label}`, missing });
const COMPLETE_CACHE = tree("cache");
const PARTIAL_CACHE = tree("cache", ["kastrup"]);
const COMPLETE_SYS = tree("sys");
const PARTIAL_SYS = tree("sys", ["cm-super", "libertine"]);
const REQUIRED = ["acmart", "cm-super", "kastrup", "libertine"];
const facts = (o) => ({
  supported: true,
  cache: null,
  system: null,
  interactive: false,
  required: REQUIRED,
  ...o,
});
const ROWS = [
  // Guards: the order — paperlint's own verified cache first, so a build does not depend on whatever TeX
  // Live the machine happens to carry.
  [
    "a complete cache wins, even over a complete system TeX",
    facts({ cache: COMPLETE_CACHE, system: COMPLETE_SYS }),
    { kind: "use-cache", tree: COMPLETE_CACHE },
  ],
  [
    "a partial cache yields to a complete system TeX",
    facts({ cache: PARTIAL_CACHE, system: COMPLETE_SYS }),
    { kind: "use-system", tree: COMPLETE_SYS },
  ],
  [
    "no cache, a complete system TeX is used",
    facts({ system: COMPLETE_SYS }),
    { kind: "use-system", tree: COMPLETE_SYS },
  ],
  // Guards: the whole point of #26 — a TeX Live without libertine would build an acmart paper
  // GREEN, in Computer Modern.
  [
    "🔴 a system TeX that LACKS a declared package is NOT used — not even non-interactively",
    facts({ system: PARTIAL_SYS }),
    { kind: "refuse", reason: "not-installed", missing: REQUIRED },
  ],
  [
    "nothing qualifies, a terminal: ask, for everything",
    facts({ interactive: true, system: PARTIAL_SYS }),
    { kind: "ask", missing: REQUIRED },
  ],
  // Guards: installing only what the cache lacks — a partial cache must not be offered a full
  // reinstall.
  [
    "nothing qualifies, a terminal, a partial cache: ask for the cache's gaps only",
    facts({ interactive: true, cache: PARTIAL_CACHE }),
    { kind: "ask", missing: ["kastrup"] },
  ],
  [
    "nothing qualifies, no terminal: refuse (never a silent install)",
    facts({}),
    { kind: "refuse", reason: "not-installed", missing: REQUIRED },
  ],
  [
    "unsupported platform, nothing qualifies: refuse as unsupported, even on a terminal",
    facts({ supported: false, interactive: true }),
    { kind: "refuse", reason: "unsupported", missing: REQUIRED },
  ],
  [
    "unsupported platform, a complete system TeX: used",
    facts({ supported: false, system: COMPLETE_SYS }),
    { kind: "use-system", tree: COMPLETE_SYS },
  ],
];
for (const [label, f, want] of ROWS) {
  const got = resolveEngine(f);
  check(
    `resolveEngine: ${label}`,
    JSON.stringify(got) === JSON.stringify(want),
    JSON.stringify(got),
  );
}
check(
  "supportedPlatform: linux and darwin, not win32",
  supportedPlatform("linux") &&
    supportedPlatform("darwin") &&
    !supportedPlatform("win32"),
);

// ── 2. the fact readers ─────────────────────────────────────────────────────────────────
const PKGS = {
  acmart: ["acmart.cls"],
  latex: ["latex.ltx", "article.cls"],
  libertine: ["libertine.sty"],
};
check(
  "missingPackages: matched by FILE NAME of each printed path, sorted",
  JSON.stringify(missingPackages(PKGS, "/t/tex/latex/acmart/acmart.cls\n")) ===
    '["latex","libertine"]',
);
// Guards: a package counts as present only when EVERY file that proves it resolves.
check(
  "missingPackages: one proof of two missing is enough to count the package missing",
  missingPackages(
    { latex: ["latex.ltx", "article.cls"] },
    "/t/latex.ltx\n",
  ).includes("latex"),
);
check(
  "missingPackages: all present → none",
  missingPackages(
    PKGS,
    "/a/acmart.cls\n/b/latex.ltx\n/b/article.cls\n/c/libertine.sty\n",
  ).length === 0,
);
check(
  "missingTools: by executable in the bin directory",
  JSON.stringify(
    missingTools(
      { texcount: ["texcount"], checkcites: ["checkcites"] },
      "/bin",
      (p) => p === "/bin/texcount",
    ),
  ) === '["checkcites"]',
);
check(
  "whichOnPath: the first directory that has it; empty segments skipped",
  whichOnPath("pdflatex", ":/a:/b:/c", (p) =>
    ["/b/pdflatex", "/c/pdflatex"].includes(p),
  ) === "/b",
);
check(
  "whichOnPath: nowhere → null",
  whichOnPath("pdflatex", "/a:/b", () => false) === null,
);
{
  const calls = [];
  const run = (cmd, args) => {
    calls.push([cmd, args]);
    return { stdout: "/x/acmart.cls\n", status: 1 };
  };
  const missing = probeTree("/tl/bin", PKGS, run);
  check(
    "probeTree: runs THAT tree's kpsewhich, once, with every proof file once",
    calls.length === 1 &&
      calls[0][0] === "/tl/bin/kpsewhich" &&
      calls[0][1].length === 4,
    JSON.stringify(calls),
  );
  check(
    "probeTree: kpsewhich's exit code is not the verdict — the printed paths are",
    JSON.stringify(missing) === '["latex","libertine"]',
  );
}
// Guards: "could not ask" must never read as "nothing missing" — a broken tree would be used.
check(
  "🔴 probeTree: a kpsewhich that cannot start finds NOTHING — never 'all present'",
  JSON.stringify(
    probeTree("/none", PKGS, () => ({ error: new Error("ENOENT") })),
  ) === '["acmart","latex","libertine"]',
);

// ── 3. "installed" means a regular file that can be run — on a REAL filesystem ─────────────
// 🔴 `existsSync` says yes to a directory and to a file without the execute bit; both then fail
// to start, while `paperlint toolchain --check` reported the tree verified. Checked on disk, not
// through an injected predicate, because the predicate is exactly what was wrong.
{
  const bin = realpathSync(
    mkdtempSync(join(tmpdir(), "paperlint-engine-bin-")),
  );
  try {
    mkdirSync(join(bin, "texcount"));
    writeFileSync(join(bin, "checkcites"), "#!/bin/sh\n");
    chmodSync(join(bin, "checkcites"), 0o644);
    writeFileSync(join(bin, "pdflatex"), "#!/bin/sh\n");
    chmodSync(join(bin, "pdflatex"), 0o755);
    const tools = {
      texcount: ["texcount"],
      checkcites: ["checkcites"],
      pdflatex: ["pdflatex"],
    };
    const missing = missingTools(tools, bin);
    // Guards: the runnable-file check — `existsSync` says yes to a directory, and `paperlint toolchain
    // --check` once reported a verified tree whose texcount could not start.
    check(
      "🔴 missingTools: a DIRECTORY named like the tool is missing",
      missing.includes("texcount"),
      JSON.stringify(missing),
    );
    // Guards: the POSIX permission half — a file the installer left at 0644 fails to start and must
    // not read as present.
    check(
      "🔴 missingTools: a regular file WITHOUT the execute bit is missing",
      missing.includes("checkcites"),
      JSON.stringify(missing),
    );
    check(
      "missingTools: an executable regular file is present",
      !missing.includes("pdflatex"),
      JSON.stringify(missing),
    );
    check(
      "whichOnPath: a directory without a runnable pdflatex is passed over",
      whichOnPath("texcount", bin) === null &&
        whichOnPath("pdflatex", bin) === bin,
    );
    check(
      "isExecutable: a path that does not exist is not executable",
      !isExecutable(join(bin, "nope")),
    );
    check(
      "isExecutable on win32: no execute bit to ask — a regular file counts, a directory does not",
      isExecutable(join(bin, "checkcites"), "win32") &&
        !isExecutable(join(bin, "texcount"), "win32"),
    );
  } finally {
    rmSync(bin, { recursive: true, force: true });
  }
}

// ── missingDependencies: what an install that "continued anyway" left out ──────────────────
// Real stdout of `tlmgr check depends` on a tree whose install-tl lost unicode-data to a mirror
// (2026-09-26): the pdflatex format could not be built, yet every venue .sty was present.
// Byte for byte: tlmgr opens every section header with a FORM FEED, then a space.
const BROKEN_DEPENDS =
  "\f DEPENDS WITHOUT PACKAGES:\n" +
  "unicode-data in: collection-basic latex-bin luahbtex luatex\n" +
  "\f PACKAGES NOT IN ANY COLLECTION: acmart booktabs caption\n";
{
  const calls = [];
  const run = (cmd, args) => {
    calls.push([cmd, args]);
    return {
      stdout: BROKEN_DEPENDS,
      stderr: "tlmgr: An error has occurred.",
      status: 2,
    };
  };
  const missing = missingDependencies("/tl/bin", run);
  check(
    "missingDependencies: asks THAT tree's tlmgr `check depends`",
    calls.length === 1 &&
      calls[0][0] === "/tl/bin/tlmgr" &&
      JSON.stringify(calls[0][1]) === '["check","depends"]',
    JSON.stringify(calls),
  );
  // Guards: a package the tree's own database requires but never installed is a gap.
  check(
    "🔴 missingDependencies: names the dependency the install dropped",
    JSON.stringify(missing) === '["unicode-data"]',
    JSON.stringify(missing),
  );
}
check(
  "missingDependencies: packages outside any collection are not gaps",
  JSON.stringify(
    missingDependencies("/tl/bin", () => ({
      stdout: "\f PACKAGES NOT IN ANY COLLECTION: acmart booktabs\n",
      status: 2,
    })),
  ) === "[]",
);
check(
  "missingDependencies: a clean tree has none",
  JSON.stringify(
    missingDependencies("/tl/bin", () => ({ stdout: "", status: 0 })),
  ) === "[]",
);

console.log(`engine: ${n} checks passed`);
