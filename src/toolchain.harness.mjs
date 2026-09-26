/**
 * `toolchain.ts` — the TeX Live installer, driven against a FAKE CTAN MIRROR ON DISK.
 *
 * 🔴 NOT ONE BYTE OF TeX LIVE IS DOWNLOADED HERE. The mirror is a directory served by `file://`
 * URLs: the real `curl` fetches from it, the real `tar` lists and unpacks it, and the installer
 * inside is `fixtures/toolchain-mirror/install-tl`, which lays out a tree whose `kpsewhich` and
 * `tlmgr` answer from two text files. So what runs is paperlint's own download, fallback, unpack,
 * install and verify logic — the part that decides success — and what is faked is only TeX.
 * The real TeX Live half is `test/e2e/toolchain.mjs`.
 *
 * Tables, in order:
 *   1. the pure pieces (year, profile, tlmgr's unknown names, cache location);
 *   2. the download: mirror fallback, archive check, the time limit;
 *   3. the command: fresh install, second run is a no-op, --check, partial add, and the three
 *      ways an install must FAIL naming the package;
 *   4. banal, the command's second half: a stand-in banal served from `file://`, never HotCRP —
 *      the installer's own tests are `banal.harness.mjs`; here only the wiring into the command.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "..", "fixtures", "toolchain-mirror");
const T = await import(join(HERE, "toolchain.ts"));
// The harness is its own composition root for banal: `runToolchain` takes an installer, it does
// not build one.
const B = await import(join(HERE, "adapters", "banal", "index.ts"));
const N = await import(join(HERE, "adapters", "node", "index.ts"));
const C = await import(join(HERE, "adapters", "curl", "index.ts"));

let n = 0;
const check = (label, cond, detail = "") => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ""}`);
  n++;
};

// ── 1. pure pieces ──────────────────────────────────────────────────────────────────────
check(
  "tlYear: the year from release-texlive.txt's first line",
  T.tlYear("TeX Live (https://tug.org/texlive) version 2026\n\nmore") ===
    "2026",
);
check(
  "tlYear: a year on a LATER line is not the release",
  T.tlYear("something else\nversion 2026") === null,
);
const profile = T.tlProfile("/c/2026");
check(
  "tlProfile: scheme-basic, TEXDIR and every tree variable inside it, no docs, no sources",
  profile.includes("selected_scheme scheme-basic\n") &&
    profile.includes("TEXDIR /c/2026\n") &&
    profile.includes("TEXMFHOME /c/2026/texmf-home\n") &&
    profile.includes("tlpdbopt_install_docfiles 0\n") &&
    profile.includes("tlpdbopt_install_srcfiles 0\n"),
  profile,
);
check(
  "unknownPackages: tlmgr's own wording names the package",
  JSON.stringify(
    T.unknownPackages(
      "tlmgr install: package urw-base35 not present in repository.\npackage already present: acmart\n",
    ),
  ) === '["urw-base35"]',
);
check(
  "cacheRoot: PAPERLINT_TEXLIVE_DIR wins",
  T.cacheRoot(
    { PAPERLINT_TEXLIVE_DIR: "/ci/tl", XDG_CACHE_HOME: "/x" },
    "/h",
  ) === "/ci/tl",
);
check(
  "cacheRoot: then XDG_CACHE_HOME",
  T.cacheRoot({ XDG_CACHE_HOME: "/x" }, "/h") === "/x/paperlint/texlive",
);
check(
  "cacheRoot: then ~/.cache",
  T.cacheRoot({}, "/h") === "/h/.cache/paperlint/texlive",
);
check(
  "mirrorsFrom: PAPERLINT_CTAN_MIRROR is the ONLY mirror, trailing slash dropped",
  JSON.stringify(
    T.mirrorsFrom({ PAPERLINT_CTAN_MIRROR: "https://m/tlnet/" }),
  ) === '["https://m/tlnet"]',
);
check(
  "mirrorsFrom: several defaults, every one https",
  T.mirrorsFrom({}).length > 1 &&
    T.mirrorsFrom({}).every((m) => m.startsWith("https://")),
);
check("formatDuration", T.formatDuration(118_400) === "1m58s");

// tlmgr's two wordings for "the repository is another TeX Live year" (tlmgr.pl 7644-7648, 7655-7663).
const OLDER =
  "tlmgr: Local TeX Live (2026) is older than remote repository (2027).\n" +
  "Cross release updates are only supported with\n" +
  "  update-tlmgr-latest(.sh/.exe) -- --upgrade\n";
const INCOMPAT = (local, remote) =>
  "tlmgr: The TeX Live versions of the local installation\n" +
  "and the repository are not compatible:\n" +
  `      local: ${local}\n` +
  ` repository: ${remote} (https://m/tlnet)\n` +
  "Perhaps that particular CTAN mirror is outdated? Just a guess.\n";
check(
  "releaseGap: 'Local TeX Live (Y) is older than remote repository (Y)' — both years",
  JSON.stringify(T.releaseGap(OLDER)) === '{"local":"2026","remote":"2027"}',
);
check(
  "releaseGap: the 'not compatible' wording with a NEWER repository",
  JSON.stringify(T.releaseGap(INCOMPAT("2026", "2027"))) ===
    '{"local":"2026","remote":"2027"}',
);
// Guards: the direction of the year check — an outdated mirror would trigger a whole new install.
check(
  "releaseGap: a STALE mirror (repository older than the tree) is not a new release",
  T.releaseGap(INCOMPAT("2027", "2026")) === null,
);
check(
  "releaseGap: ordinary tlmgr output is not a release gap",
  T.releaseGap(
    "tlmgr install: package urw-base35 not present in repository.\n",
  ) === null,
);
// Guards: the complete-tree preference — an interrupted new-year install would otherwise be the
// tree the build uses.
check(
  "usableTree: the newest COMPLETE tree, not simply the newest",
  T.usableTree(["2027", "2026", "2025"], (y) => y !== "2027") === "2026",
);
check(
  "usableTree: nothing complete — the newest, so packages go where the next build will look",
  T.usableTree(["2027", "2026"], () => false) === "2027",
);
check("usableTree: an empty cache", T.usableTree([], () => true) === null);

// ── the fake mirror ────────────────────────────────────────────────────────────────────
const work = realpathSync(
  mkdtempSync(join(tmpdir(), "paperlint-toolchain-h-")),
);
const good = join(work, "good");
const garbage = join(work, "garbage");
const staging = join(work, "staging", "install-tl-20260924");
mkdirSync(staging, { recursive: true });
mkdirSync(good);
mkdirSync(garbage);
for (const f of [
  "install-tl",
  "stub-pdflatex",
  "stub-kpsewhich",
  "stub-tlmgr",
  "stub-fmtutil-sys",
  "release-texlive.txt",
])
  copyFileSync(join(FIXTURE, f), join(staging, f));
spawnSync("chmod", [
  "+x",
  ...[
    "install-tl",
    "stub-pdflatex",
    "stub-kpsewhich",
    "stub-tlmgr",
    "stub-fmtutil-sys",
  ].map((f) => join(staging, f)),
]);
spawnSync(
  "tar",
  [
    "czf",
    join(good, "install-tl-unx.tar.gz"),
    "-C",
    dirname(staging),
    "install-tl-20260924",
  ],
  { stdio: "inherit" },
);
copyFileSync(join(FIXTURE, "catalog.txt"), join(good, "catalog.txt"));
copyFileSync(join(FIXTURE, "release-year"), join(good, "release-year"));
writeFileSync(
  join(garbage, "install-tl-unx.tar.gz"),
  "<html>503 Service Unavailable</html>",
);
const url = (dir) => pathToFileURL(dir).href;
const MISSING = url(join(work, "no-such-mirror"));

/** A call that downloads or installs. `tlmgr check depends` only reads, so it is not one. */
const installs = (c) =>
  c.cmd === "curl" || (c.cmd.endsWith("tlmgr") && c.args.includes("install"));

/** A `spawnSync` that records every program it was asked to run. */
const recorder = () => {
  const calls = [];
  const run = (cmd, args, opts) => {
    calls.push({ cmd, args });
    return spawnSync(cmd, args, opts);
  };
  return { run, calls };
};

// ── 2. the download ─────────────────────────────────────────────────────────────────────
{
  const lines = [];
  const { run, calls } = recorder();
  const dest = join(work, "dl.tar.gz");
  const got = T.downloadInstaller(
    { run, log: (l) => lines.push(l), env: process.env },
    [MISSING, url(garbage), url(good)],
    dest,
  );
  // Guards: the archive check — a mirror's error page would be unpacked as install-tl.
  check(
    "download: falls through a missing mirror and a non-archive to the good one",
    got === url(good),
    `${got}\n${lines.join("\n")}`,
  );
  check(
    "download: both failures are SAID, one line each",
    lines.length === 2 &&
      lines[0].includes("no-such-mirror") &&
      lines[1].includes("not a .tar.gz"),
    lines.join("\n"),
  );
  const curls = calls.filter((c) => c.cmd === "curl");
  // Guards: the per-download bond — a hung mirror would hold the job until the job's own timeout.
  check(
    "download: every curl carries its own time limit",
    curls.length === 3 &&
      curls.every(
        (c) =>
          c.args[c.args.indexOf("--max-time") + 1] ===
          String(T.DOWNLOAD_SECONDS),
      ),
  );
  check(
    "🔴 download: TLS is never switched off",
    curls.every((c) => !c.args.some((a) => a === "-k" || a === "--insecure")),
  );
  check(
    "download: -f — an HTTP error page is a failure, not a file",
    curls.every((c) => c.args[0].includes("f")),
  );
}
{
  const lines = [];
  const got = T.downloadInstaller(
    { run: spawnSync, log: (l) => lines.push(l), env: process.env },
    [MISSING, url(garbage)],
    join(work, "dl2.tar.gz"),
  );
  check("download: no good mirror → null, not a half file", got === null);
}

// ── 3. the command ─────────────────────────────────────────────────────────────────────
const TEX = {
  packages: {
    latex: ["latex.ltx", "article.cls"],
    acmart: ["acmart.cls"],
  },
  tools: { texcount: ["texcount"] },
};
const root = join(work, "cache");
// 🔴 banal goes into the work directory, never the developer's cache: without PAPERLINT_BANAL_DIR the
// command installs into ~/.cache/paperlint/banal, and a harness must not leave files in a home.
const banalDir = join(work, "banal");
const env = {
  ...process.env,
  PAPERLINT_TEXLIVE_DIR: root,
  PAPERLINT_CTAN_MIRROR: url(good),
  PAPERLINT_BANAL_DIR: banalDir,
};
// A stand-in banal: a Perl script that prints what banal prints for a one-page, 10 pt probe.
const fakeBanal = join(work, "fake-banal");
writeFileSync(
  fakeBanal,
  'print qq({"bodyfontsize": 10.3, "columns": 1, "pages": [{}]}\\n);\n',
);
const BANAL = {
  url: url(fakeBanal),
  sha256: createHash("sha256").update(readFileSync(fakeBanal)).digest("hex"),
};
/** banal's installer over the real ports, every process going through the recorder. */
const installer = (e, source, run) => {
  const s = B.parseBanalSettings(e, N.hostDirs());
  const ports = N.nodeAdapters({ tmpDir: s.tmpDir, spawn: run });
  const download = C.curlDownload({
    run: ports.run,
    env: s.processEnv,
    tmpDir: s.tmpDir,
  });
  return B.banalInstaller({ ...ports, download }, s, source);
};
const cmd = ({ banal = BANAL, ...over } = {}) => {
  const out = [];
  const err = [];
  const rec = recorder();
  const code = T.runToolchain({
    log: (l) => out.push(l),
    err: (l) => err.push(l),
    env,
    run: rec.run,
    platform: "linux",
    tex: TEX,
    banal: installer(over.env ?? env, banal, rec.run),
    now: (() => {
      let t = 0;
      return () => (t += 1000);
    })(),
    ...over,
  });
  return { code, out: out.join("\n"), err: err.join("\n"), calls: rec.calls };
};

{
  const r = cmd({ check: true });
  check(
    "--check on an empty cache: exit 1, says nothing is installed and what the command installs",
    r.code === 1 &&
      r.out.includes("no TeX Live in") &&
      r.out.includes("`npx paperlint toolchain` installs 3 packages"),
    r.out,
  );
  check("--check changes nothing", !existsSync(join(root, "2026")));
}
{
  const r = cmd();
  check("fresh install: exit 0", r.code === 0, `${r.out}\n${r.err}`);
  check(
    "fresh install: the tree is <cache>/<TeX Live year>",
    existsSync(join(root, "2026", "bin", "x86_64-linux", "pdflatex")),
  );
  check(
    "fresh install: the success line counts what was VERIFIED",
    r.out.includes("✓ TeX Live 2026 is ready in") &&
      r.out.includes(
        "3 packages verified (3 files found by kpsewhich, 1 tools)",
      ),
    r.out,
  );
  const tlmgr = readFileSync(join(root, "2026", "tlmgr.log"), "utf8");
  check(
    "fresh install: tlmgr was asked for every declared package, from the mirror that served install-tl",
    tlmgr.trim() === `${url(good)} acmart latex texcount`,
    tlmgr,
  );
}
{
  const r = cmd();
  // Guards: idempotence — the second run must not touch the network or say it did work.
  check(
    "second run: exit 0 and says there is nothing to do",
    r.code === 0 &&
      r.out.includes("already has all 3 declared packages — nothing to do"),
    r.out,
  );
  check(
    "second run: names the bin directory a script puts on PATH",
    r.out.includes(`  bin: ${join(root, "2026", "bin", "x86_64-linux")}`),
    r.out,
  );
  check(
    "second run: downloads nothing and installs nothing",
    !r.calls.some(installs),
    JSON.stringify(r.calls.map((c) => [c.cmd, ...c.args])),
  );
}
// Guards: a tree with every venue package can still be broken. install-tl that lost a package
// to a mirror prints "continuing anyway"; seen 2026-09-26 with unicode-data, after which the
// pdflatex format was never built and every build died before writing a log.
{
  const tree = join(root, "2026");
  writeFileSync(join(tree, "missing-deps.txt"), "unicode-data\n");
  const check1 = cmd({ check: true });
  check(
    "🔴 a dropped base dependency: --check does not call the tree complete",
    check1.code === 1,
    `${check1.out}\n${check1.err}`,
  );
  const r = cmd();
  check(
    "🔴 a dropped base dependency: the run installs it, then builds the missing formats",
    r.code === 0 &&
      readFileSync(join(tree, "tlmgr.log"), "utf8").includes("unicode-data") &&
      readFileSync(join(tree, "fmtutil.log"), "utf8").trim() === "--missing",
    `${r.out}\n${r.err}`,
  );
  check(
    "a dropped base dependency: the tree is whole afterwards",
    readFileSync(join(tree, "missing-deps.txt"), "utf8").trim() === "",
  );
}
{
  const r = cmd({ check: true });
  check(
    "--check on a complete tree: exit 0",
    r.code === 0 && r.out.includes("has all 3 declared packages"),
    r.out,
  );
}
{
  // A package declared LATER: the tree exists, so only tlmgr runs, for that package alone.
  const tex = {
    ...TEX,
    packages: { ...TEX.packages, libertine: ["libertine.sty"] },
  };
  const before = cmd({ check: true, tex });
  check(
    "--check names the missing package WITH its proof file",
    before.code === 1 &&
      before.out.includes(
        "lacks 1 of 4 declared packages: libertine (libertine.sty)",
      ),
    before.out,
  );
  const r = cmd({ tex });
  check("partial: exit 0", r.code === 0, `${r.out}\n${r.err}`);
  check(
    "partial: no download, one tlmgr call for the one missing package",
    !r.calls.some((c) => c.cmd === "curl") &&
      readFileSync(join(root, "2026", "tlmgr.log"), "utf8")
        .trim()
        .split("\n")
        .at(-1) === `${url(good)} libertine`,
  );
}
{
  const r = cmd({
    tex: { ...TEX, packages: { ...TEX.packages, bogus: ["bogus.sty"] } },
  });
  // Guards: the diagnosis — an invented package name would read as a missing file, not as a wrong
  // name.
  check(
    "🔴 an unknown package name fails and is NAMED",
    r.code === 1 && r.err.includes("tlmgr does not know: bogus"),
    r.err,
  );
}
{
  const r = cmd({
    tex: { ...TEX, packages: { ...TEX.packages, liar: ["liar.sty"] } },
  });
  // Guards: acceptance by result — tlmgr's exit code must not stand for the files; that is how an
  // apt step once 'installed' nothing.
  check(
    "🔴 tlmgr 'installs' it but the proof file is absent: FAIL, package and file named",
    r.code === 1 && r.err.includes("still lacks, after tlmgr: liar (liar.sty)"),
    r.err,
  );
}
{
  // A tool whose program never appears in the bin directory.
  appendFileSync(join(good, "catalog.txt"), "checkcites checkcites.lua\n");
  const r = cmd({
    tex: { ...TEX, tools: { ...TEX.tools, checkcites: ["checkcites"] } },
  });
  check(
    "🔴 a declared tool with no executable fails, named",
    r.code === 1 && r.err.includes("checkcites (checkcites)"),
    r.err,
  );
}
{
  const r = cmd({ platform: "win32" });
  check(
    "Windows: a clear refusal, nothing touched",
    r.code === 1 && r.err.includes("Windows is not supported"),
    r.err,
  );
}
{
  const fresh = join(work, "cache-fail");
  const r = cmd({
    env: {
      ...env,
      PAPERLINT_TEXLIVE_DIR: fresh,
      FAKE_INSTALL_TL_FAIL: "1",
    },
  });
  check(
    "install-tl failing: exit 1 and its own last lines are shown",
    r.code === 1 &&
      r.err.includes("install-tl failed") &&
      r.err.includes("simulated failure"),
    r.err,
  );
}
{
  const r = cmd({
    env: {
      ...env,
      PAPERLINT_TEXLIVE_DIR: join(work, "cache-nomirror"),
      PAPERLINT_CTAN_MIRROR: MISSING,
    },
  });
  check(
    "no mirror answers: exit 1, names the mirrors and the override",
    r.code === 1 &&
      r.err.includes("no CTAN mirror returned install-tl") &&
      r.err.includes("PAPERLINT_CTAN_MIRROR"),
    r.err,
  );
}

// ── 4. a new TeX Live year on CTAN ─────────────────────────────────────────────────────
/**
 * A mirror serving the TeX Live `year` release: an install-tl archive whose release-texlive.txt
 * says `installerYear`, the catalog, and the repository's `release-year`. The two differ only for
 * the case where the mirrors disagree.
 */
const mirrorFor = (name, year, installerYear = year) => {
  const dir = join(work, name);
  const stage = join(
    work,
    `staging-${name}`,
    `install-tl-${installerYear}0401`,
  );
  mkdirSync(dir, { recursive: true });
  mkdirSync(stage, { recursive: true });
  for (const f of [
    "install-tl",
    "stub-pdflatex",
    "stub-kpsewhich",
    "stub-tlmgr",
    "stub-fmtutil-sys",
  ])
    copyFileSync(join(staging, f), join(stage, f));
  writeFileSync(
    join(stage, "release-texlive.txt"),
    `TeX Live (https://tug.org/texlive) version ${installerYear}\n`,
  );
  spawnSync("tar", [
    "czf",
    join(dir, "install-tl-unx.tar.gz"),
    "-C",
    dirname(stage),
    `install-tl-${installerYear}0401`,
  ]);
  copyFileSync(join(FIXTURE, "catalog.txt"), join(dir, "catalog.txt"));
  writeFileSync(join(dir, "release-year"), `${year}\n`);
  return url(dir);
};
const next = mirrorFor("good2027", "2027");
const years = join(work, "cache-years");
const withLibertine = {
  ...TEX,
  packages: { ...TEX.packages, libertine: ["libertine.sty"] },
};
const inYears = (mirror, over = {}) =>
  cmd({
    env: {
      ...env,
      PAPERLINT_TEXLIVE_DIR: years,
      PAPERLINT_CTAN_MIRROR: mirror,
    },
    ...over,
  });
check(
  "years: a 2026 tree to start from",
  inYears(url(good)).code === 0 && existsSync(join(years, "2026")),
);
{
  const r = inYears(next);
  check(
    "🔴 years: a complete 2026 tree and a 2027 mirror, nothing new declared — NO upgrade",
    r.code === 0 &&
      r.out.includes("TeX Live 2026") &&
      r.out.includes("nothing to do") &&
      !existsSync(join(years, "2027")) &&
      !r.calls.some(installs),
    `${r.out}\n${JSON.stringify(r.calls.map((c) => c.cmd))}`,
  );
}
{
  const r = inYears(next, { tex: withLibertine });
  // Guards: the recovery — a new TeX Live year would fail every newly declared package, loudly and
  // forever.
  check(
    "🔴 years: a new package on a 2027 mirror — tlmgr's refusal installs a 2027 tree beside the old one",
    r.code === 0 &&
      r.out.includes(
        "tlmgr refused: the repository is TeX Live 2027, the tree in",
      ) &&
      r.out.includes("✓ TeX Live 2027 is ready in") &&
      existsSync(join(years, "2027", "bin", "x86_64-linux", "pdflatex")),
    `${r.out}\n${r.err}`,
  );
  check(
    "years: the new tree got EVERY declared package, not only the new one",
    readFileSync(join(years, "2027", "tlmgr.log"), "utf8").trim() ===
      `${next} acmart latex libertine texcount`,
  );
  // Guards: the notice — a superseded 300 MB tree would sit in the cache with nothing saying so.
  check(
    "years: the old tree is left in place, said so with its size and never deleted",
    existsSync(join(years, "2026", "bin", "x86_64-linux", "pdflatex")) &&
      r.out.includes(
        `TeX Live 2026 in ${join(years, "2026")} is left in place and no longer used (`,
      ) &&
      r.out.includes("MB); delete that directory to free the space"),
    r.out,
  );
}
{
  const r = inYears(next, { tex: withLibertine });
  check(
    "years: the next run uses 2027 and does nothing",
    r.code === 0 &&
      r.out.includes(
        `TeX Live 2027 in ${join(years, "2027")} already has all 4`,
      ),
    r.out,
  );
}
{
  // tlmgr says 2027, but the installer the mirrors hand out is still 2026.
  const split = join(work, "cache-split");
  cmd({ env: { ...env, PAPERLINT_TEXLIVE_DIR: split } });
  const r = cmd({
    env: {
      ...env,
      PAPERLINT_TEXLIVE_DIR: split,
      PAPERLINT_CTAN_MIRROR: mirrorFor("split2027", "2027", "2026"),
    },
    tex: withLibertine,
  });
  // Guards: the year guard — install-tl for the SAME year would run over the tree that is already
  // there.
  check(
    "🔴 years: mirrors that disagree about the release fail, and install-tl is not run over the old tree",
    r.code === 1 &&
      r.err.includes("the mirrors disagree about the current release") &&
      !r.calls.some((c) => c.cmd.endsWith("install-tl")),
    r.err,
  );
}

// ── 4. banal, the second half of the command ───────────────────────────────────────────
{
  const dir = join(work, "banal-4");
  const e = { ...env, PAPERLINT_BANAL_DIR: dir };
  const before = cmd({ env: e, check: true });
  // Guards: --check covers banal — a complete TeX Live alone must not read as a ready toolchain.
  check(
    "banal: --check with TeX Live complete and no banal exits 1 and names banal",
    before.code === 1 && before.out.includes("banal not found"),
    before.out,
  );
  const r = cmd({ env: e });
  check(
    "banal: the command installs it — exit 0, the ready line says the sha256 was verified",
    r.code === 0 &&
      r.out.includes("sha256 verified, and it measured a probe page"),
    `${r.out}\n${r.err}`,
  );
  const again = cmd({ env: e });
  check(
    "banal: a second run downloads nothing and says so",
    again.code === 0 &&
      again.out.includes("is verified and runs — nothing to do") &&
      !again.calls.some((c) => c.cmd === "curl"),
    again.out,
  );
  check("banal: --check now passes", cmd({ env: e, check: true }).code === 0);
}
{
  const r = cmd({
    env: { ...env, PAPERLINT_BANAL_DIR: join(work, "banal-bad") },
    banal: { ...BANAL, sha256: "0".repeat(64) },
  });
  // Guards: the two halves are independent — a banal failure fails the command, and TeX Live still
  // reports ready rather than being hidden behind it.
  check(
    "🔴 banal with the wrong sha256: exit 1, the refusal named, and TeX Live still reported ready",
    r.code === 1 &&
      r.err.includes("does not have the pinned sha256") &&
      r.out.includes("nothing to do"),
    `${r.out}\n${r.err}`,
  );
}

rmSync(work, { recursive: true, force: true });
console.log(`toolchain: ${n} checks passed`);
