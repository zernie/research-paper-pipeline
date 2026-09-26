/**
 * INSTALL E2E: pack the package and install it into a CLEAN consumer with every available
 * manager, then check what the consumer actually does.
 *
 * 🔴 WHY A SEPARATE RUN AND NOT A CELL IN `npm test`. Everything the harnesses check lives
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
 * Run: node test/e2e/install.mjs [--keep]
 * Exit code: 0 — every manager passed; 1 — at least one did not.
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  installedSkills,
  PACKAGE_NAME,
  SHIPPED_SKILLS_DIR,
} from "../../skills/paper-pipeline/scripts/consumer.mjs";
import {
  mkdtempSync,
  mkdirSync,
  cpSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
  readlinkSync,
  realpathSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  compareToBaseline,
  countByRule,
} from "../../fixtures/real-markdown-paper/baseline.mjs";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const KEEP = process.argv.includes("--keep");
// See `managers()`: a manager that will not launch is a declared skip here and a failure in CI.
const STRICT = process.argv.includes("--strict");

const sh = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, { encoding: "utf8", ...opts });

/**
 * The managers this run is SUPPOSED to measure, declared as data with the reason each is here.
 * A list, because "which managers did this run actually cover" has to be answerable from the
 * output — not inferred from how many `──` headers scrolled past.
 */
const WANTED = [
  {
    name: "npm",
    probe: ["npm", ["--version"]],
    install: (tgz) => ["npm", ["install", "--silent", tgz]],
    why: "the default; `.bin` holds a symlink to the .mjs",
  },
  {
    name: "pnpm",
    probe: ["pnpm", ["--version"]],
    // The BARE command a reader of the README types, with no flags. Until vigiles 31.0.0 this
    // needed three `--allow-build` flags: vigiles pulled @ast-grep/lang-{python,ruby,rust}, each
    // with a postinstall, and pnpm 10+ exits 1 (ERR_PNPM_IGNORED_BUILDS) on an unapproved
    // dependency script. vigiles 31 parses those languages with bundled WASM grammars and has no
    // install scripts (zernie/vigiles#280), so the flags and the pin that watched for this day
    // are gone. A dependency that brings a postinstall back turns this install red.
    install: (tgz) => ["pnpm", ["install", "--silent", tgz]],
    why:
      "does NOT put transitive dependencies at the project root, and `.bin` holds a shell " +
      "wrapper rather than a symlink — both have already broken this package",
  },
];

/**
 * Split WANTED into the managers that launch here and the ones that do not.
 *
 * 🔴 WHY THIS RETURNS THE MISSING ONES INSTEAD OF DROPPING THEM. The first edition simply
 * skipped a manager that would not start, and only failed when NONE would. So on a machine
 * without pnpm the run measured npm alone and said nothing about it — and pnpm is the entire
 * reason this file exists. "pnpm passed" and "pnpm was never tried" printed identically.
 *
 * That is the failure class this package is written against, reproduced inside it: a skipped
 * check and a passed one look the same. `test/e2e/build.mjs` already had the cure — declare the skip,
 * and let `--strict` turn it into a failure where absence means a broken environment.
 */
function managers() {
  const available = [];
  const missing = [];
  for (const m of WANTED) {
    const r = sh(m.probe[0], m.probe[1]);
    if (r.status === 0)
      available.push({ ...m, version: (r.stdout ?? "").trim() });
    else missing.push(m);
  }
  return { available, missing };
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
 * WHERE THE PACKAGE LANDED, asked of Node rather than spelled out (docs/prior-art/package-location.md).
 *
 * The spelling `node_modules/<package>` is not wrong under npm or pnpm. What
 * resolution adds is a second claim the hardcode cannot see: the package is REACHABLE BY NAME
 * from the consumer. Measured there with a closed `exports` map — the directory still exists, every
 * `existsSync` stays green, and the documented public import is broken. `createRequire`, not
 * `findPackageJSON`: the latter answers past a broken map, which makes it the better locator and
 * the worse canary.
 */
function locateInstalled(consumer) {
  const req = createRequire(
    pathToFileURL(join(consumer, "__consumer__.js")).href,
  );
  try {
    const file = req.resolve(`${PACKAGE_NAME}/package.json`);
    return {
      dir: dirname(file),
      manifest: JSON.parse(readFileSync(file, "utf8")),
    };
  } catch (e) {
    return { err: `${e.code ?? "error"}: ${e.message}` };
  }
}

/**
 * The skills directory under `root`, from the same constant the linker reads. A root without it is
 * an error, not zero skills: an empty list would read as a clean install.
 */
function skillsDir(root) {
  const dir = join(root, SHIPPED_SKILLS_DIR);
  if (!existsSync(dir)) throw new Error(`no skills directory at ${dir}`);
  return dir;
}

/**
 * The hook commands are taken FROM THE PUBLISHED `hooks.json`, not from the copy in the
 * repository: we check what arrived, not what we shipped.
 */
function hookCommands(installed) {
  const file = join(installed, "plugin", "hooks", "hooks.json");
  if (!existsSync(file))
    return {
      err: `plugin/hooks/hooks.json did not arrive in the tarball: ${file}`,
    };
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
function contentDelivery(installed) {
  const listSkills = (root) => {
    const dir = skillsDir(root);
    if (!existsSync(dir)) return [];
    return installedSkills(dir);
  };
  const here = listSkills(ROOT);
  const there = listSkills(installed);
  const missing = here.filter((n) => !there.includes(n));

  // Resolve every script a delivered SKILL.md names, from the consumer's tree.
  const unresolved = [];
  let refs = 0;
  for (const name of there) {
    const skills = skillsDir(installed);
    const body = readFileSync(join(skills, name, "SKILL.md"), "utf8");
    for (const m of body.matchAll(/([\w./-]*scripts\/[\w-]+\.mjs)/g)) {
      refs++;
      const raw = m[1];
      // TWO bases, and both are the declared skills directory. A third — the package root — was
      // measured dead (0 of 104 references, docs/prior-art/package-location.md § 9) and is gone:
      // a candidate nothing uses can only ever hide a wrong-base reference, never find one.
      const candidates = [
        // skill-relative: `scripts/x.mjs`, `../other/scripts/x.mjs`
        join(skills, name, raw),
        // the install-path spelling the port rule exists to retire (paperlint#19); counted as resolvable
        // only if the file is genuinely there under the declared skills directory
        join(skills, raw.replace(/^\.claude\/skills\//, "")),
      ];
      if (!candidates.some(existsSync)) unresolved.push(`${name}: ${raw}`);
    }
  }
  return { here: here.length, there: there.length, missing, refs, unresolved };
}

/**
 * 🔴 THE CONSUMER'S VIEW OF THE SKILLS — what Claude Code actually reads. `contentDelivery` above
 * proves the skills reached `node_modules`; that is necessary and NOT sufficient, because Claude
 * Code discovers project skills only in `<project>/.claude/skills/<name>/SKILL.md` and never looks
 * inside `node_modules`. The README claimed otherwise until Codex caught it on #45, and a consumer
 * who followed it had no `/paper-pipeline` — while every check here stayed green, because every
 * check looked at the package directory.
 *
 * So this walks the SAME list — every skill the installed package declares — from the consumer
 * root, through the links `paperlint init` made, and resolves the script paths the skills name the way
 * the agent will: `.claude/skills/<skill>/scripts/x.mjs` from the project root, `scripts/x.mjs`
 * from the skill's own directory as the project sees it.
 */
function consumerSkillView(consumer, installed) {
  const dir = skillsDir(installed);
  const names = installedSkills(dir);
  const home = join(consumer, ".claude", "skills");
  const unreachable = [];
  const notLinks = [];
  const links = {};
  const unresolved = [];
  let rootRefs = 0;
  let refs = 0;
  for (const name of names) {
    const entry = join(home, name);
    if (!existsSync(join(entry, "SKILL.md"))) {
      unreachable.push(name);
      continue;
    }
    try {
      links[name] = readlinkSync(entry);
    } catch {
      notLinks.push(name);
    }
    const body = readFileSync(join(entry, "SKILL.md"), "utf8");
    for (const m of body.matchAll(/([\w./-]*scripts\/[\w-]+\.mjs)/g)) {
      refs++;
      const raw = m[1];
      const fromRoot = raw.startsWith(".claude/skills/");
      if (fromRoot) rootRefs++;
      const at = fromRoot ? join(consumer, raw) : join(entry, raw);
      if (!existsSync(at)) unresolved.push(`${name}: ${raw}`);
    }
  }
  return { names, unreachable, notLinks, links, refs, rootRefs, unresolved };
}

const results = [];
// Managers that did not launch under --strict. Part of the FINAL verdict, not a `process.exitCode`
// set on the side: the unconditional `process.exit(…)` at the bottom overwrites exitCode, so a
// strict run without pnpm used to print 🔴 and exit 0 (measured, Codex review on #45).
let strictMissing = [];
// Managers that did not launch WITHOUT --strict: a declared skip, reported with exit 77 so
// `npm run check` can tell "measured under npm only" from "measured under both".
let skippedManagers = [];
// realpathSync is NOT decoration: on macOS `/var` is a symlink to `/private/var`, and a path
// recorded before resolution does not match what a process returns from inside. This is a
// separate class, and it has already cost a red npm test on macOS only (vigiles#241).
const work = realpathSync(mkdtempSync(join(tmpdir(), "paperlint-e2e-")));
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

  const { available, missing } = managers();
  if (available.length === 0)
    throw new Error("not a single package manager launches");

  // A declared skip, never a silent one. In STRICT it is a failure: in CI a manager that is not
  // installed is a broken environment, and this run's whole point is the npm/pnpm difference.
  if (missing.length) {
    for (const m of missing) {
      const say = `NOT MEASURED: ${m.name} does not launch on this machine — ${m.why}`;
      if (STRICT) console.error(`  \u{1F534} ${say}`);
      else
        console.log(
          `  \u26A0\uFE0F  ${say} (a legitimate skip for a clone without it; --strict makes it a failure)`,
        );
    }
    if (STRICT) {
      console.error(
        `\nIn --strict a missing manager is a FAILURE: measuring ${available.map((m) => m.name).join(", ")} ` +
          `alone is indistinguishable, in the output, from measuring all of them.`,
      );
      strictMissing = missing.map((m) => m.name);
    } else skippedManagers = missing.map((m) => m.name);
  }
  console.log(`measured under: ${available.map((m) => m.name).join(", ")}\n`);

  for (const m of available) {
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

    const located = locateInstalled(consumer);
    if (located.err) {
      bad("the package resolves BY NAME from the consumer", located.err);
      // Nothing below can be measured against a package Node cannot find; say so and move on
      // rather than guess a path and report on the guess.
      results.push({ manager: `${m.name} ${m.version}`, fail });
      console.log("");
      continue;
    }
    ok("the package resolves BY NAME from the consumer");
    const installed = located.dir;

    // 🔴 THE BIN IS LAUNCHED DIRECTLY, NOT THROUGH `node <path>`. Under npm `.bin` holds a
    // SYMLINK to the `.mjs`, and `node` swallows it; under pnpm it holds a SHELL WRAPPER, and
    // `node` chokes on its very first line `basedir=$(dirname …)`. The first edition of this test
    // called `node bin` and reported three false failures on pnpm — that is, it measured my way
    // of launching, not the package. The consumer calls `npx paperlint`, which executes the file rather
    // than feeding it to node.
    const bin = join(consumer, "node_modules", ".bin", PACKAGE_NAME);
    const help = sh(bin, ["--help"], { cwd: consumer });
    help.status === 0
      ? ok(`\`${PACKAGE_NAME} --help\` answers with zero`)
      : bad(`\`${PACKAGE_NAME} --help\` answers with zero`, help.stderr);
    // The shim above proves the MANAGER did its part. This proves the file the manifest PROMISES
    // exists and runs — the real file under both managers, so `node <it>` is uniform where
    // `node <shim>` is not (pnpm writes a shell wrapper).
    const binField = located.manifest.bin;
    const binRel =
      typeof binField === "string" ? binField : binField?.[PACKAGE_NAME];
    if (!binRel)
      bad(
        `the manifest declares the \`${PACKAGE_NAME}\` bin`,
        JSON.stringify(binField),
      );
    else {
      const real = sh(process.execPath, [join(installed, binRel), "--help"], {
        cwd: consumer,
      });
      real.status === 0
        ? ok(`the manifest's bin (${binRel}) runs under node`)
        : bad(`the manifest's bin (${binRel}) runs under node`, real.stderr);
    }

    // 🔴 THE CORPUS IS STAGED BEFORE `init`, AND THIS IS NOT A REORDERING FOR CONVENIENCE. `init`
    // now MEASURES the papers directory instead of guessing it; a run over an empty tree would
    // measure the default branch and stay silent about the one the command was rewritten for.
    stageCorpus(consumer);
    const init = sh(bin, ["init"], { cwd: consumer });
    // The corpus is staged under `papers/`, the default: init measures it and, finding the
    // default, writes NO paperlint.json. A file here would mean it wrote what it did not need.
    existsSync(join(consumer, "paperlint.json"))
      ? bad(
          "`paperlint init` took the default papers directory and wrote no paperlint.json",
          `${readFileSync(join(consumer, "paperlint.json"), "utf8")}\n${init.stdout ?? ""}${init.stderr ?? ""}`,
        )
      : ok(
          "`paperlint init` took the default papers directory and wrote no paperlint.json",
        );
    init.status === 0
      ? ok("`paperlint init` finished with zero — doctor found no discrepancy")
      : bad(
          "`paperlint init` finished with zero — doctor found no discrepancy",
          (init.stdout ?? "") + (init.stderr ?? ""),
        );

    // The skills, as Claude Code will look for them: in the consumer, not in node_modules.
    const view = consumerSkillView(consumer, installed);
    view.names.length > 0 && view.unreachable.length === 0
      ? ok(
          `all ${view.names.length} shipped skill(s) are reachable as .claude/skills/<name>/SKILL.md`,
        )
      : bad(
          `all ${view.names.length} shipped skill(s) are reachable as .claude/skills/<name>/SKILL.md`,
          `not reachable: ${view.unreachable.join(", ") || "(the package declares zero skills)"}\n${init.stdout ?? ""}`,
        );
    view.notLinks.length === 0 &&
    Object.values(view.links).every((t) => !t.startsWith("/"))
      ? ok("each is a RELATIVE symlink, not a copy")
      : bad(
          "each is a RELATIVE symlink, not a copy",
          `not links: ${view.notLinks.join(", ") || "-"}; absolute: ${
            Object.entries(view.links)
              .filter(([, t]) => t.startsWith("/"))
              .map(([n]) => n)
              .join(", ") || "-"
          }`,
        );
    view.rootRefs > 0 && view.unresolved.length === 0
      ? ok(
          `all ${view.refs} script path(s) resolve FROM THE CONSUMER ROOT (${view.rootRefs} project-root-relative)`,
        )
      : bad(
          `all ${view.refs} script path(s) resolve FROM THE CONSUMER ROOT (${view.rootRefs} project-root-relative)`,
          view.unresolved.slice(0, 5).join("\n") ||
            "zero project-root-relative references — nothing was checked",
        );

    // 🔴 THE HOOKS ARE WIRED WHERE CLAUDE CODE READS THEM, BY init ITSELF. No `/plugin` line is
    // typed anywhere: `init` without a terminal takes the YES default and writes the three
    // commands into `.claude/settings.json` — the same commands `plugin/hooks/hooks.json`
    // publishes, once each. Whether they RESOLVE is judged below, by running them.
    const settingsPath = join(consumer, ".claude", "settings.json");
    const wiredCommands = (() => {
      try {
        const json = JSON.parse(readFileSync(settingsPath, "utf8"));
        return Object.values(json.hooks ?? {}).flatMap((entries) =>
          (entries ?? []).flatMap((e) => (e.hooks ?? []).map((h) => h.command)),
        );
      } catch (e) {
        return { err: e.message };
      }
    })();
    const published = hookCommands(installed);
    Array.isArray(wiredCommands) &&
    !published.err &&
    wiredCommands.length === published.cmds.length &&
    published.cmds.every(
      (c) => wiredCommands.filter((w) => w === c).length === 1,
    )
      ? ok(
          `\`paperlint init\` wired all ${wiredCommands.length} hook command(s) into .claude/settings.json, once each`,
        )
      : bad(
          "`paperlint init` wired the hooks into .claude/settings.json, once each",
          `${JSON.stringify(wiredCommands).slice(0, 300)}\n${init.stdout ?? ""}`,
        );
    /in a fresh clone they cannot run until `npm install`/.test(
      init.stdout ?? "",
    )
      ? ok("and it says the hook commands need `npm install` in a fresh clone")
      : bad(
          "and it says the hook commands need `npm install` in a fresh clone",
          init.stdout,
        );
    const settingsBefore = existsSync(settingsPath)
      ? readFileSync(settingsPath)
      : null;

    // A second `init` is a re-run, not a clash: nothing fails, no link moves.
    const again = sh(bin, ["init"], { cwd: consumer });
    settingsBefore !== null && readFileSync(settingsPath).equals(settingsBefore)
      ? ok(
          "a second `paperlint init` leaves .claude/settings.json byte-identical",
        )
      : bad(
          "a second `paperlint init` leaves .claude/settings.json byte-identical",
          again.stdout,
        );
    const after = consumerSkillView(consumer, installed);
    again.status === 0 &&
    view.names.every((n) => after.links[n] === view.links[n]) &&
    new RegExp(
      `0 linked now, ${view.names.length} already linked, 0 skipped`,
    ).test(again.stdout ?? "")
      ? ok(
          "a second `paperlint init` exits zero and leaves every link as it was",
        )
      : bad(
          "a second `paperlint init` exits zero and leaves every link as it was",
          `exit ${String(again.status)}\n${(again.stdout ?? "")
            .split("\n")
            .filter((l) => /shipped|skills/.test(l))
            .join("\n")}${again.stderr ?? ""}`,
        );

    // 🔴 "CLEAN" MEANS: EXIT 0, AND ONLY THE WARNINGS A CORRECT CORPUS MUST CARRY, one per paper:
    // the acmart paper extends agenticdev and is not built here, so `pdf/measured` says the venue
    // checks did not run; a paper made by `paperlint new` names no venue yet, and `pdf/measured`
    // says that. Their absence would be a green zero; any other finding is a false positive.
    const expectedWarnings = (papers) => (r) => {
      try {
        const ms = JSON.parse(r.stdout ?? "").flatMap((f) =>
          f.messages.map((m) => ({ ...m, file: f.filePath })),
        );
        const want = Object.entries(papers);
        return (
          r.status === 0 &&
          ms.length === want.length &&
          want.every(([paper, text]) =>
            ms.some(
              (m) =>
                m.ruleId === "pdf/measured" &&
                m.severity === 1 &&
                m.file.endsWith(join(paper, "paper.tex")) &&
                text.test(m.message),
            ),
          )
        );
      } catch {
        return false;
      }
    };
    const UNBUILT = /not built yet, so .*page limit/;
    const NO_PRESET = /names no venue preset yet/;
    const lint = sh(bin, ["lint", "--json"], { cwd: consumer });
    expectedWarnings({ acmart: UNBUILT })(lint)
      ? ok("`paperlint lint` passed the corpus clean")
      : bad(
          "`paperlint lint` passed the corpus clean",
          (lint.stdout ?? "") + (lint.stderr ?? ""),
        );

    // `paperlint new` from the INSTALLED package: the templates must have shipped in the tarball, and
    // what they scaffold must be what `paperlint lint` accepts — exit 0, not "missing
    // PIPELINE-STATUS.md", with the one warning that no venue is chosen yet. Then the whole corpus
    // is linted again, now with the new paper in it.
    const fresh = sh(bin, ["new", "demo"], { cwd: consumer });
    fresh.status === 0 &&
    existsSync(join(consumer, "papers", "demo", "PIPELINE-STATUS.md")) &&
    existsSync(join(consumer, "papers", "demo", "paper.tex")) &&
    existsSync(join(consumer, "papers", "demo", "paperlint.json")) &&
    NO_PRESET.test(fresh.stdout ?? "") &&
    /\(0 errors, 1 warning\)/.test(fresh.stdout ?? "")
      ? ok(
          "`paperlint new demo` scaffolds papers/demo from the shipped templates, paperlint.json included, and its lint passes with the one no-venue warning",
        )
      : bad(
          "`paperlint new demo` scaffolds papers/demo from the shipped templates, paperlint.json included, and its lint passes with the one no-venue warning",
          (fresh.stdout ?? "") + (fresh.stderr ?? ""),
        );
    const withDemo = sh(bin, ["lint", "--json"], { cwd: consumer });
    expectedWarnings({ acmart: UNBUILT, demo: NO_PRESET })(withDemo)
      ? ok(
          "`paperlint lint` still passes the corpus clean with the new paper in it",
        )
      : bad(
          "`paperlint lint` still passes the corpus clean with the new paper in it",
          (withDemo.stdout ?? "") + (withDemo.stderr ?? ""),
        );

    // 🔴 THE REAL ARTICLE, AND IT IS NOT EXPECTED TO BE CLEAN. The two papers above were written
    // for the rules; this one was published before the rules existed, so it is the only input on
    // which a false positive can show up. It is added AFTER the clean run, and only its own files
    // are counted, so every finding below is the article's. The verdict is the recorded
    // baseline — growth fails, a full vanish fails, a partial drop does not — read through the
    // same module the in-repo harness uses, so the installed binary and the repository's own are
    // held to one recording.
    cpSync(
      join(ROOT, "fixtures", "real-markdown-paper"),
      join(consumer, "papers", "real-article"),
      { recursive: true, verbatimSymlinks: true },
    );
    const realLint = sh(bin, ["lint", "--json"], { cwd: consumer });
    let found = null;
    try {
      // Only the article's own files: the rest of the corpus is judged above.
      found = countByRule(
        JSON.stringify(
          JSON.parse(realLint.stdout ?? "").filter((f) =>
            f.filePath.includes(join("papers", "real-article")),
          ),
        ),
      );
    } catch (e) {
      bad(
        "`paperlint lint --json` on the real article parses",
        `${e.message}\n${realLint.stderr ?? ""}`,
      );
    }
    if (found) {
      const { grew, vanished } = compareToBaseline(found);
      grew.length === 0 && vanished.length === 0
        ? ok(
            `the real article matches its baseline (${Object.entries(found)
              .map(([r, n]) => `${r} ${n}`)
              .join(", ")})`,
          )
        : bad(
            "the real article matches its baseline",
            [
              ...grew.map(
                (g) => `grew: ${g.rule} ${g.now} > recorded ${g.recorded}`,
              ),
              ...vanished.map((r) => `vanished: ${r}`),
            ].join("\n"),
          );
    }

    // 🔴 The load-bearing check: the commands ARE EXECUTED.
    const { cmds, err } = hookCommands(installed);
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
          // `Cannot find module`, while `paperlint hook` with an unresolvable runtime catches the
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
    const d = contentDelivery(installed);
    d.missing.length === 0 && d.there === d.here
      ? ok(`all ${d.here} skill(s) arrived`)
      : bad(
          `all ${d.here} skill(s) arrived`,
          `${d.there} arrived; missing: ${d.missing.join(", ") || "(count differs without a named gap)"}`,
        );
    d.unresolved.length === 0
      ? ok(
          `all ${d.refs} script path(s) named by skills resolve in the consumer`,
        )
      : bad(
          `all ${d.refs} script path(s) named by skills resolve in the consumer`,
          [...new Set(d.unresolved)].slice(0, 5).join("\n"),
        );

    // 🔴 A NAME THAT IS ALREADY TAKEN STAYS TAKEN. Last, because it deliberately breaks one
    // skill's link: the consumer's own directory under a shipped skill's name, plus one under a
    // name nobody ships. `init` must leave both byte for byte, say which skill it skipped, and
    // still exit zero — refusing to overwrite is not a failure of the install.
    const home = join(consumer, ".claude", "skills");
    const taken = view.names[0];
    if (taken) {
      // `force` + `recursive`: when init linked nothing, the entry is absent — say so below, do not crash here.
      rmSync(join(home, taken), { force: true });
      mkdirSync(join(home, taken), { recursive: true });
      writeFileSync(join(home, taken, "SKILL.md"), "the consumer's own\n");
      mkdirSync(join(home, "consumers-own-skill"), { recursive: true });
      writeFileSync(
        join(home, "consumers-own-skill", "SKILL.md"),
        "untouched\n",
      );
      const third = sh(bin, ["init"], { cwd: consumer });
      const kept =
        readFileSync(join(home, taken, "SKILL.md"), "utf8") ===
          "the consumer's own\n" &&
        readFileSync(join(home, "consumers-own-skill", "SKILL.md"), "utf8") ===
          "untouched\n";
      kept &&
      third.status === 0 &&
      new RegExp(`${taken} — a directory`).test(third.stdout ?? "")
        ? ok(
            `a foreign .claude/skills/${taken} is left untouched, named, and init still exits zero`,
          )
        : bad(
            `a foreign .claude/skills/${taken} is left untouched, named, and init still exits zero`,
            `kept=${String(kept)} exit=${String(third.status)}\n${third.stdout ?? ""}`,
          );
    }

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
for (const name of strictMissing)
  console.log(`  🔴 ${name} — NOT MEASURED, and --strict makes that a failure`);
for (const name of skippedManagers)
  console.log(`  ⏳ ${name} — NOT MEASURED (declared skip, exit 77)`);
process.exit(
  red > 0 || strictMissing.length > 0 ? 1 : skippedManagers.length > 0 ? 77 : 0,
);
