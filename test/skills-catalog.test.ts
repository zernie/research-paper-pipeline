/**
 * THE SKILL CATALOG CANNOT DRIFT FROM THE SKILLS THAT SHIP.
 *
 * `docs/skills.md` lists every skill by stage, and the README names a few headline skills and the
 * count. Both are compared against `skills/<name>/SKILL.md` on disk, the directory `paperlint init`
 * links from — so adding, renaming or removing a skill turns this red until the prose follows. The
 * README's pipeline diagram and `docs/skills.md` must name the same stages, in the same order.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error — markdown-it ships no types in this repository
import MarkdownIt from "markdown-it";

interface Token {
  type: string;
  tag: string;
  info: string;
  content: string;
  children: Token[] | null;
}

const ROOT = join(import.meta.dirname, "..");
const read = (p: string): string => readFileSync(join(ROOT, p), "utf8");
const parse = (text: string): Token[] =>
  (new MarkdownIt() as { parse: (s: string, e: object) => Token[] }).parse(
    text,
    {},
  );

const SHIPPED = readdirSync(join(ROOT, "skills"), { withFileTypes: true })
  .filter(
    (e) =>
      e.isDirectory() && existsSync(join(ROOT, "skills", e.name, "SKILL.md")),
  )
  .map((e) => e.name)
  .sort();

/** The code spans of one inline token. */
const codeSpans = (t: Token): string[] =>
  (t.children ?? [])
    .filter((c) => c.type === "code_inline")
    .map((c) => c.content);

/** The code spans in the SECOND column of every table body row of `text`. */
function secondColumn(text: string): string[] {
  const out: string[] = [];
  let col = 0;
  for (const t of parse(text)) {
    if (t.type === "tr_open") col = 0;
    if (t.type === "td_open") col++;
    if (t.type === "inline" && col === 2) out.push(...codeSpans(t));
  }
  return out;
}

/** The README's pipeline diagram: the `text` fence whose first word is `stage`. */
function diagram(): string {
  const fence = parse(read("README.md")).find(
    (t) =>
      t.type === "fence" && t.info === "text" && t.content.startsWith("stage"),
  );
  if (!fence)
    throw new Error(
      "README.md: no pipeline diagram (a `text` fence starting `stage`)",
    );
  return fence.content;
}

/** The code spans in the README section whose level-2 heading ends with `title`. */
function spansIn(title: string): string[] {
  const tokens = parse(read("README.md"));
  const out: string[] = [];
  let inside = false;
  tokens.forEach((t, i) => {
    const prev = tokens[i - 1];
    if (prev?.type === "heading_open" && prev.tag === "h2")
      inside = t.content.endsWith(title);
    else if (inside && t.type === "inline") out.push(...codeSpans(t));
  });
  return out;
}

const SKILL_NAME = /^[a-z]+(?:-[a-z]+)+$/;

describe("the skill catalog matches the skills that ship", () => {
  it("there is something to compare — the shipped set is not empty", () => {
    // Guards: a wrong directory would make every comparison below pass on two empty sets.
    expect(SHIPPED.length).toBeGreaterThan(10);
  });

  it("docs/skills.md lists every shipped skill once, and nothing else", () => {
    const listed = secondColumn(read("docs/skills.md"));
    expect([...listed].sort()).toEqual(SHIPPED);
  });

  it("the README diagram's stages are docs/skills.md's stages, in the same order", () => {
    const fromDiagram = diagram()
      .split("\n")
      .map((l) => /^(\d) (\S+)/.exec(l))
      .filter((m) => m !== null)
      .map((m) => `${m[1]} · ${m[2]}`);
    const fromCatalog = parse(read("docs/skills.md"))
      .filter(
        (t, i, all) =>
          all[i - 1]?.type === "heading_open" && /^\d · /.test(t.content),
      )
      .map((t) => t.content.toLowerCase());
    expect(fromDiagram.length).toBe(8);
    expect(fromDiagram).toEqual(fromCatalog);
  });

  it("the README's headline skills are shipped skills, and its count is the real one", () => {
    const headline = spansIn("Skills").filter((s) => SKILL_NAME.test(s));
    expect(headline.length).toBeGreaterThanOrEqual(3);
    for (const s of headline) expect(SHIPPED).toContain(s);
    const readme = read("README.md");
    expect(readme).toContain(`optional, ${String(SHIPPED.length)} of them`);
    expect(readme).toContain(`All ${String(SHIPPED.length)}, by stage`);
  });
});
