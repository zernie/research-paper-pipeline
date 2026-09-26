/**
 * Battery for `new-paper.ts`.
 *
 * Every case reintroduces a way `paperlint new` damages a paper folder or produces one the linter
 * refuses — the first a loss nobody notices until the text is gone, the second the exact
 * "missing file on the first run" this command was written to end.
 */
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { runMutations } from "../lib/mutation-driver.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const SRC = join(HERE, "new-paper.ts");
const HARNESS = join(HERE, "new-paper.harness.mjs");

process.exit(
  runMutations({
    root: ROOT,
    runner: "node",
    cases: [
      {
        name: "an existing file is overwritten",
        harness: HARNESS,
        expect: "a second run overwrites nothing",
        disables:
          "the one promise that makes `paperlint new` safe on an existing folder. A scorecard with a " +
          "year of journal in it is replaced by the empty template",
        edits: [
          [
            SRC,
            '    if (existsSync(join(dir, file))) {\n      files.push({ file, status: "kept" });\n      continue;\n    }\n',
            "",
          ],
          [SRC, '{ encoding: "utf8", flag: "wx" }', '{ encoding: "utf8" }'],
        ],
      },
      {
        name: "a second source is added beside an existing one",
        harness: HARNESS,
        // The first owner is the re-run on a .tex paper asked for md: it must add no paper.md.
        expect: "adds no second source",
        disables:
          "the migration of an old folder: a paper written in Markdown gains a stub paper.tex, " +
          "and every tex rule starts linting a file the author never wrote",
        edits: [
          [
            SRC,
            "  return hasSource ? [STATUS_FILE] : [STATUS_FILE, SOURCE_FILE[format]];",
            "  return [STATUS_FILE, SOURCE_FILE[format]];",
          ],
        ],
      },
      {
        name: "a leading dot is accepted",
        harness: HARNESS,
        expect: "discovery skips dot-directories",
        disables:
          "the refusal of a name that would be created and then never linted — the scaffold " +
          "would sit beside the papers, invisible to every check",
        edits: [[SRC, '  if (name.startsWith("."))', "  if (false)"]],
      },
    ],
  }),
);
