/**
 * INSTALL E2E: pack the package and install it into a CLEAN consumer with every available
 * manager, then check what the consumer actually does.
 *
 * 🔴 WHY A SEPARATE RUN AND NOT A CELL IN `npm test`. Everything the 55 harnesses check lives
 * INSIDE the repository, where `node_modules`, the sources and the config all sit side by side.
 * The consumer gets a different tree: a tarball unpacked by a manager BY ITS OWN RULES. One
 * decision has already diverged between those two worlds — moving `vigiles` from peer to regular
 * dependencies works on npm and does NOT work on pnpm, because the hook wiring addresses the
 * runtime from the project root, and pnpm does not put transitive dependencies at the root. That
 * was not found by a test.
 *
 * 🔴 THE MAIN CHECK IS THAT THE HOOK COMMAND RUNS, NOT THAT IT MATCHES A STRING. Grepping the
 * path in `hooks.json` is useless: the string there is correct under any manager, while whether
 * it resolves is a property of the tree laid out on disk. So the command is launched, and the
 * verdict is based on whether it died on `Cannot find module`.
 *
 * Run: node scripts/install-e2e.mjs [--keep]
 * Exit code: 0 — every manager passed; 1 — at least one did not.
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  cpSync,
  readdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const KEEP = process.argv.includes("--keep");

const sh = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, { encoding: "utf8", ...opts });

/** A manager counts as available only if it actually launches. */
function managers() {
  const out = [];
  for (const [name, probe, install] of [
    [
      "npm",
      ["npm", ["--version"]],
      (tgz) => ["npm", ["install", "--silent", tgz]],
    ],
    [
      "pnpm",
      ["pnpm", ["--version"]],
      (tgz) => ["pnpm", ["install", "--silent", tgz]],
    ],
  ]) {
    const r = sh(probe[0], probe[1]);
    if (r.status === 0)
      out.push({ name, version: (r.stdout ?? "").trim(), install });
  }
  return out;
}

/**
 * The corpus `lint` must pass clean. TWO papers, and they are different ON PURPOSE.
 *
 * ⚠️ The comment here used to call this "a small but REAL corpus". It was not: the source was the
 * four bytes `abcd` and the PDF was a hundred `x`. That is enough to drive the STAGE machinery —
 * a declared stage, its pdf, its byte counts, the cross-check between them — and it is the reason
 * those stubs stay. But calling it real overstated what the run proves, and a label that
 * overstates is how a test stops being read.
 *
 * So the stub paper keeps the stage rules honest, and `fixtures/build-e2e/acmart` — an actual
 * `\documentclass{acmart}` source, the same one the build e2e compiles with a real `pdflatex` —
 * makes sure the LaTeX rules see LaTeX rather than a placeholder. Neither covers the other:
 * measured 2026-09-19, the acmart fixture alone linted 2 files, the stub alone drives the stages.
 */
function stageCorpus(root) {
  const paper = join(root, "papers", "p1");
  mkdirSync(join(paper, "versions"), { recursive: true });
  writeFileSync(join(paper, "versions", "s.tex"), "abcd");
  writeFileSync(
    join(paper, "versions", "2026-07-22-submitted.pdf"),
    "x".repeat(100),
  );
  writeFileSync(join(paper, "paper.md"), "# Intro\n\nRQ1: does it hold?\n");
  writeFileSync(
    join(paper, "PIPELINE-STATUS.md"),
    `---\nstages:\n  - stage: submitted\n    date: 2026-07-22\n    pdf: versions/2026-07-22-submitted.pdf\n    bytes: 100\n    source: versions/s.tex\n    sourceBytes: 4\nresearchQuestion: "does it hold?"\n---\n# S\n\n| id | note |\n|---|---|\n| cites | bib-authors run |\n`,
  );
  // The real LaTeX half. Copied from this repository's own fixture rather than written inline:
  // a second inline copy of an acmart preamble would drift from the one the build e2e compiles,
  // and then the two tests would disagree about what a paper looks like.
  cpSync(
    join(ROOT, "fixtures", "build-e2e", "acmart"),
    join(root, "papers", "acmart"),
    { recursive: true },
  );
}

/**
 * The hook commands are taken FROM THE PUBLISHED `hooks.json`, not from the copy in the
 * repository: we check what arrived, not what we shipped.
 */
function hookCommands(consumer) {
  const file = join(
    consumer,
    "node_modules",
    "research-paper-pipeline",
    "plugin",
    "hooks",
    "hooks.json",
  );
  if (!existsSync(file))
    return { err: `plugin/hooks/hooks.json did not arrive in the tarball: ${file}` };
  let json;
  try {
    json = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    return { err: `hooks.json does not parse: ${e.message}` };
  }
  const cmds = [];
  for (const entries of Object.values(json.hooks ?? {}))
    for (const entry of entries ?? [])
      for (const h of entry.hooks ?? []) if (h.command) cmds.push(h.command);
  if (cmds.length === 0)
    return { err: "zero commands in hooks.json — there is nothing to check" };
  return { cmds };
}

/**
 * 🔴 WHAT ARRIVED, COUNTED AGAINST WHAT EXISTS — not against a number written here.
 *
 * The README claims the install brings the skills. Until now nothing checked it: the only
 * delivery assertion was that `plugin/hooks/hooks.json` reached the tarball, so a package that
 * shipped ZERO skills would have passed a test written for exactly that defect. A hardcoded
 * count would be no better — it would go stale the first time a skill is added, and the staleness
 * would read as a pass.
 *
 * The second half is the one that catches the real class: a skill that names a script by a path
 * which only resolves from one working directory. That path is correct in the repository and
 * absent in the consumer, which is why reading the prose never finds it.
 */
function contentDelivery(consumer) {
  const installed = join(consumer, "node_modules", "research-paper-pipeline");
  const listSkills = (root) => {
    const dir = join(root, "skills");
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, "SKILL.md")))
      .map((d) => d.name);
  };
  const here = listSkills(ROOT);
  const there = listSkills(installed);
  const missing = here.filter((n) => !there.includes(n));

  // Resolve every script a delivered SKILL.md names, from the consumer's tree.
  const unresolved = [];
  let refs = 0;
  for (const name of there) {
    const body = readFileSync(join(installed, "skills", name, "SKILL.md"), "utf8");
    for (const m of body.matchAll(/([\w./-]*scripts\/[\w-]+\.mjs)/g)) {
      refs++;
      const raw = m[1];
      const candidates = [
        join(installed, raw),
        join(installed, "skills", name, raw),
        // The install-path spelling the port rule exists to retire; counted as resolvable only
        // if the file is genuinely there under `skills/`.
        join(installed, raw.replace(/^\.claude\/skills\//, "skills/")),
      ];
      if (!candidates.some(existsSync)) unresolved.push(`${name}: ${raw}`);
    }
  }
  return { here: here.length, there: there.length, missing, refs, unresolved };
}

const results = [];
// realpathSync is NOT decoration: on macOS `/var` is a symlink to `/private/var`, and a path
// recorded before resolution does not match what a process returns from inside. This is a
// separate class, and it has already cost a red npm test on macOS only (vigiles#241).
const work = realpathSync(mkdtempSync(join(tmpdir(), "rpp-e2e-")));
try {
  const packed = execFileSync(
    "npm",
    ["pack", "--silent", "--pack-destination", work],
    {
      cwd: ROOT,
      encoding: "utf8",
    },
  )
    .trim()
    .split("\n")
    .pop();
  const tgz = join(work, packed);
  if (!existsSync(tgz)) throw new Error(`npm pack left no tarball: ${tgz}`);
  console.log(`tarball: ${packed}\n`);

  const mgrs = managers();
  if (mgrs.length === 0)
    throw new Error("not a single package manager launches");

  for (const m of mgrs) {
    const consumer = join(work, `consumer-${m.name}`);
    mkdirSync(consumer, { recursive: true });
    writeFileSync(
      join(consumer, "package.json"),
      '{"name":"c","version":"1.0.0","private":true}',
    );
    const fail = [];
    const ok = (label) => console.log(`  ✓ ${label}`);
    const bad = (label, detail) => {
      fail.push(label);
      console.log(
        `  ✗ ${label}${detail ? `\n      ${String(detail).trim().split("\n").slice(0, 3).join("\n      ")}` : ""}`,
      );
    };

    console.log(`── ${m.name} ${m.version}`);
    const [cmd, args] = m.install(tgz);
    const inst = sh(cmd, args, { cwd: consumer });
    if (inst.status === 0) ok("the install went through");
    else bad("the install went through", inst.stderr || inst.stdout);

    // 🔴 THE BIN IS LAUNCHED DIRECTLY, NOT THROUGH `node <path>`. Under npm `.bin` holds a
    // SYMLINK to the `.mjs`, and `node` swallows it; under pnpm it holds a SHELL WRAPPER, and
    // `node` chokes on its very first line `basedir=$(dirname …)`. The first edition of this test
    // called `node bin` and reported three false failures on pnpm — that is, it measured my way
    // of launching, not the package. The consumer calls `npx rpp`, which executes the file rather
    // than feeding it to node.
    const bin = join(consumer, "node_modules", ".bin", "rpp");
    const help = sh(bin, ["--help"], { cwd: consumer });
    help.status === 0
      ? ok("`rpp --help` answers with zero")
      : bad("`rpp --help` answers with zero", help.stderr);

    // 🔴 THE CORPUS IS STAGED BEFORE `init`, AND THIS IS NOT A REORDERING FOR CONVENIENCE. `init`
    // now MEASURES the papers directory instead of guessing it; a run over an empty tree would
    // measure the default branch and stay silent about the one the command was rewritten for.
    stageCorpus(consumer);
    const init = sh(bin, ["init"], { cwd: consumer });
    const declared = (() => {
      try {
        return JSON.parse(readFileSync(join(consumer, "package.json"), "utf8"))[
          "research-paper-pipeline"
        ]?.papers;
      } catch (e) {
        return `unreadable: ${e.message}`;
      }
    })();
    declared === "papers"
      ? ok("`rpp init` declared the papers directory in package.json")
      : bad(
          "`rpp init` declared the papers directory in package.json",
          `package.json ended up with ${JSON.stringify(declared)}\n${init.stdout ?? ""}${init.stderr ?? ""}`,
        );
    // ONE declaration: no second carrier is created, otherwise the two diverge silently — that is
    // defect #33 exactly, only reintroduced by our own install command.
    !existsSync(join(consumer, "rpp.json"))
      ? ok("and did NOT create a second carrier rpp.json")
      : bad("and did NOT create a second carrier rpp.json", "rpp.json appeared");
    init.status === 0
      ? ok("`rpp init` finished with zero — doctor found no discrepancy")
      : bad(
          "`rpp init` finished with zero — doctor found no discrepancy",
          (init.stdout ?? "") + (init.stderr ?? ""),
        );

    const lint = sh(bin, ["lint"], { cwd: consumer });
    lint.status === 0 && /no findings/.test(lint.stdout ?? "")
      ? ok("`rpp lint` passed the corpus clean")
      : bad(
          "`rpp lint` passed the corpus clean",
          (lint.stdout ?? "") + (lint.stderr ?? ""),
        );

    // 🔴 The load-bearing check: the commands ARE EXECUTED.
    const { cmds, err } = hookCommands(consumer);
    if (err) bad("hooks.json arrived and parses", err);
    else {
      let resolved = 0;
      for (const command of cmds) {
        const r = sh("bash", ["-c", command], {
          cwd: consumer,
          input: "{}",
          env: { ...process.env, CLAUDE_PROJECT_DIR: consumer },
        });
        const out = (r.stderr ?? "") + (r.stdout ?? "");
        // The exit code is not judged: a guard may legitimately return 2 on the merits. What is
        // judged is the RESOLVE.
        if (
          // 🔴 `is NOT running` IN THE LIST IS LOAD-BEARING. The first edition looked only for
          // `Cannot find module`, while `rpp hook` with an unresolvable runtime catches the
          // exception and complains in DIFFERENT words, returning 0 — and the test printed "all
          // 3 commands resolve" with the hooks completely broken. A false green of exactly the
          // class this test is written for: the check looked for the spelling it REMEMBERED, not
          // for the thing itself.
          /Cannot find module|MODULE_NOT_FOUND|No such file or directory|is NOT running/.test(
            out,
          )
        )
          bad(
            `the hook command resolves (${cmds.indexOf(command) + 1}/${cmds.length})`,
            out,
          );
        else resolved++;
      }
      if (resolved === cmds.length)
        ok(`all ${cmds.length} hook command(s) resolve`);
    }

    // Content delivery: the skills, and the paths inside them.
    const d = contentDelivery(consumer);
    d.missing.length === 0 && d.there === d.here
      ? ok(`all ${d.here} skill(s) arrived`)
      : bad(
          `all ${d.here} skill(s) arrived`,
          `${d.there} arrived; missing: ${d.missing.join(", ") || "(count differs without a named gap)"}`,
        );
    d.unresolved.length === 0
      ? ok(`all ${d.refs} script path(s) named by skills resolve in the consumer`)
      : bad(
          `all ${d.refs} script path(s) named by skills resolve in the consumer`,
          [...new Set(d.unresolved)].slice(0, 5).join("\n"),
        );

    results.push({ manager: `${m.name} ${m.version}`, fail });
    console.log("");
  }
} finally {
  if (KEEP) console.log(`(--keep) the tree was kept: ${work}`);
  else rmSync(work, { recursive: true, force: true });
}

console.log("── summary");
let red = 0;
for (const r of results) {
  if (r.fail.length === 0) console.log(`  ✅ ${r.manager}`);
  else {
    red++;
    console.log(`  🔴 ${r.manager} — did not pass: ${r.fail.join(" · ")}`);
  }
}
process.exit(red > 0 ? 1 : 0);
