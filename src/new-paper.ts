/**
 * `paperlint new <name>` — a paper folder the linter accepts, made from a template FILE.
 *
 * 🔴 WHY THIS EXISTS. `paperlint lint` requires `PIPELINE-STATUS.md` in every paper folder, and until
 * this command nothing made one: the template sat inside a fenced block of a reference page and a
 * human copied it. The README's own "First run" example opened with the error for the missing file.
 *
 * Every rule below is taken from a tool that already solved it (docs/prior-art/paper-folder-scaffolding.md):
 *   - the template is a FILE with a lookup order — the project's `<papers>/.template/<file>` first,
 *     the package's `templates/paper/<file>` second (Hugo's archetypes);
 *   - it NEVER overwrites: on an existing folder it adds only the missing required files, which is
 *     also the migration for an old folder that has only `paper.md` (`cargo init`);
 *   - the name is validated, because it becomes a path and, through the hooks, a shell argument.
 *
 * The only substitution is `{{name}}` → the folder name. Nothing else in a template is touched.
 */
/* eslint-disable boundaries/dependencies -- legacy I/O, moves behind a port in #76 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
/* eslint-enable boundaries/dependencies */
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_FILE } from "../lib/paper-config.mjs";

export type PaperFormat = "tex" | "md";
export const FORMATS: readonly PaperFormat[] = ["tex", "md"];
export const DEFAULT_FORMAT: PaperFormat = "tex";

/** The package's default templates. Read from disk, so they ship in the tarball (`files`). */
export const PACKAGE_TEMPLATES = fileURLToPath(
  new URL("../templates/paper/", import.meta.url),
);

/**
 * The project's override directory, inside the papers directory. It starts with a dot, and that
 * is what keeps it from being a paper: discovery (`papersIn`, `checkStructure`, `detectPapers`)
 * skips dot-directories, and `buildConfig` ignores it for ESLint.
 */
export const OVERRIDE_DIR = ".template";

export const STATUS_FILE = "PIPELINE-STATUS.md";
export const SOURCE_FILE: Readonly<Record<PaperFormat, string>> = {
  tex: "paper.tex",
  md: "paper.md",
};

export const isFormat = (v: unknown): v is PaperFormat =>
  FORMATS.includes(v as PaperFormat);

/**
 * Why a name is refused, or null. `[a-z0-9._-]+` is the charset; a LEADING dot is refused on top
 * of it, because discovery skips dot-directories — a paper named `.x` would be created and then
 * never linted, which is worse than a refusal.
 */
export function nameProblem(name: string): string | null {
  if (!/^[a-z0-9._-]+$/.test(name))
    return `\`${name}\` — a paper name may hold only a-z, 0-9, dot, underscore and hyphen (it becomes a path and a shell argument)`;
  if (name.startsWith("."))
    return `\`${name}\` — a name starting with a dot is skipped by paper discovery, so it would never be linted`;
  return null;
}

export interface FileOutcome {
  readonly file: string;
  /** `created` from a template, `kept` because it was already there. */
  readonly status: "created" | "kept";
  /** Which template it came from, for a created file. */
  readonly from?: "project" | "package";
}

export type NewPaperResult =
  | {
      readonly ok: true;
      readonly dir: string;
      /** The folder did not exist before this run. */
      readonly fresh: boolean;
      readonly files: readonly FileOutcome[];
    }
  | { readonly ok: false; readonly reason: string };

/**
 * The files a paper folder must end up with: the scorecard, a source in `format` — unless it
 * already has a source in EITHER format, in which case that one stands — and `paperlint.json`.
 */
export function wantedFiles(dir: string, format: PaperFormat): string[] {
  return [...scorecardAndSource(dir, format), CONFIG_FILE];
}

function scorecardAndSource(dir: string, format: PaperFormat): string[] {
  const hasSource = Object.values(SOURCE_FILE).some((f) =>
    existsSync(join(dir, f)),
  );
  return hasSource ? [STATUS_FILE] : [STATUS_FILE, SOURCE_FILE[format]];
}

/** The venue `paperlint new --venue` chose: what goes into the new paper's `paperlint.json`. */
export interface VenueSetting {
  /** `paperlint:<name>`, or a path relative to the paper's `paperlint.json`. */
  readonly extends: string;
  readonly kind: string | null;
}

/**
 * The template's `paperlint.json` with the chosen venue written in. The template's `$comment`
 * explains how to choose one, so it goes once one is chosen. A template that is not plain JSON (a
 * project's own, with comments) cannot be edited safely and is refused by name.
 */
function withVenue(
  text: string,
  src: string,
  venue: VenueSetting,
): { ok: true; text: string } | { ok: false; reason: string } {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {
      ok: false,
      reason: `--venue cannot be written into ${src}: it is not plain JSON — set "extends" by hand`,
    };
  }
  const out: Record<string, unknown> = { ...obj, extends: venue.extends };
  delete out["$comment"];
  if (venue.kind !== null) out["kind"] = venue.kind;
  return { ok: true, text: `${JSON.stringify(out, null, 2)}\n` };
}

/** A file `newPaper` will write: its text, and which template it came from. */
interface Planned {
  readonly file: string;
  readonly text: string;
  readonly from: "project" | "package";
}

/** One file's text from its template — the project's override first, the package's second. */
function fromTemplate(
  file: string,
  {
    papersRoot,
    packageTemplates,
    name,
    venue,
  }: {
    papersRoot: string;
    packageTemplates: string;
    name: string;
    venue: VenueSetting | null;
  },
): { ok: true; value: Planned } | { ok: false; reason: string } {
  const project = join(papersRoot, OVERRIDE_DIR, file);
  const [src, from] = existsSync(project)
    ? [project, "project" as const]
    : [join(packageTemplates, file), "package" as const];
  // A missing package template is a broken install, not a reason to write an empty file.
  if (!existsSync(src))
    return { ok: false, reason: `no template for ${file}: ${src} is missing` };
  const text = readFileSync(src, "utf8").split("{{name}}").join(name);
  if (file !== CONFIG_FILE || venue === null)
    return { ok: true, value: { file, text, from } };
  const edited = withVenue(text, src, venue);
  return edited.ok
    ? { ok: true, value: { file, text: edited.text, from } }
    : edited;
}

// Documented in README.md#getting-started — update it when this changes.
export function newPaper(
  papersRoot: string,
  name: string,
  format: PaperFormat,
  {
    packageTemplates = PACKAGE_TEMPLATES,
    venue = null,
  }: { packageTemplates?: string; venue?: VenueSetting | null } = {},
): NewPaperResult {
  const problem = nameProblem(name);
  if (problem) return { ok: false, reason: problem };
  const dir = join(papersRoot, name);
  const fresh = !existsSync(dir);
  if (!fresh && !statSync(dir).isDirectory())
    return { ok: false, reason: `${dir} exists and is not a directory` };

  const files: FileOutcome[] = [];
  const toWrite: Planned[] = [];
  for (const file of wantedFiles(dir, format)) {
    if (existsSync(join(dir, file))) {
      files.push({ file, status: "kept" });
      continue;
    }
    const planned = fromTemplate(file, {
      papersRoot,
      packageTemplates,
      name,
      venue,
    });
    if (!planned.ok) return planned;
    toWrite.push(planned.value);
  }
  // Read every template before writing any file, so a missing one leaves no half-made folder.
  mkdirSync(dir, { recursive: true });
  for (const { file, text, from } of toWrite) {
    // `wx`: fail rather than overwrite, even if something appeared since the check above.
    writeFileSync(join(dir, file), text, { encoding: "utf8", flag: "wx" });
    files.push({ file, status: "created", from });
  }
  return { ok: true, dir, fresh, files };
}

/** The report lines, shared by `paperlint new` and the first-paper offer in `paperlint init`. */
export function reportNewPaper(
  result: NewPaperResult,
  here: (p: string) => string,
): string[] {
  if (!result.ok) return [`  ✗ ${result.reason}`];
  const out = [
    `  ${result.fresh ? "✓ created" : "✓ already there, only missing files added:"} ${here(result.dir)}`,
  ];
  for (const f of result.files)
    out.push(
      f.status === "created"
        ? `      + ${f.file}  (from the ${f.from === "project" ? `project's ${OVERRIDE_DIR}/` : "package"} template)`
        : `      = ${f.file}  (kept — never overwritten)`,
    );
  return out;
}
