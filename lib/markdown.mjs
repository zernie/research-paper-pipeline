/**
 * markdown.mjs — markup parsing for EVERYTHING in this repo that reads markdown.
 *
 * Three kinds of consumer: two advisory linters (`kb-lint`, `paper-lint` — through the
 * re-export from `lint-core.mjs`) and skill scripts (`tighten-paper/structure.mjs`,
 * `grade-paper-writing/prose-lint.mjs`, `paper-pipeline/scripts/*`). Hence the home is
 * here and not in the linter core: importing "the linter core" from a skill script
 * would be a lie about the direction of the dependency.
 *
 * CHECKS NOTHING AND PRINTS NOTHING: text in, data out. What to do with a missing
 * parser is the caller's decision, and the decisions DIFFER:
 *   • a linter — degrades and nags LOUDLY about it (the blocking gate must keep
 *     working meanwhile: PreToolUse counts only exit code 2 as a block, and a
 *     failure on import would switch the gate off silently);
 *   • a skill script — fails through `requireMarkdown()`, because its output goes
 *     into the pipeline gates, and "0 headings" reads there as a fact about the paper.
 */
// THE RULE (`CLAUDE.md`, 2026-08-11): markdown structure is parsed with a PARSER, not
// with regexes. Stepped on four times, three of them the same defect: JS `\b` is
// defined over `[A-Za-z0-9_]`, and next to a Cyrillic letter there is NO word boundary,
// and the `u` flag does not change that. A level-2 heading whose text is a Cyrillic word
// never matched once over the whole life of the check. A heading out of the parser has a
// LEVEL and a TEXT — "word boundary" does not exist there in nature, and the mistake
// becomes IMPOSSIBLE to express.
//
// The helper moved here from `paper-lint.mjs` on 2026-08-11, when a second consumer
// appeared (`kb-lint.checkRejectedRowsCited` cut `topics/*.md` into sections with a
// regex — and did so TWO LINES ABOVE its own comment about this very bug). The
// condition for the move had been written down in advance, for exactly this case.
//
// 🔴 THE IMPORT IS OPTIONAL. Before 2026-08-11 the hooks had not a single dependency, and
// a bare top-level `import` changed the shape of the failure: no `node_modules` → exit 1
// → **the blocking `pre` gate in paper-lint stops blocking silently**, because
// PreToolUse counts only exit code 2 as a block. Measured: `ERR_MODULE_NOT_FOUND`, exit 1.
let md = null;
try {
  const { default: MarkdownIt } = await import("markdown-it");
  md = new MarkdownIt();
} catch {
  md = null;
}

/**
 * Whether the parser resolved. A linter must check this ITSELF and say out loud that
 * its heading checks are off: with no parser `headings()` returns an empty list, and
 * silent emptiness reads as "the document has no headings", that is, as a clean
 * document. The nudge lives in the linters, because by contract (see the header) this
 * file has no right to produce a single finding.
 */
export const MD_AVAILABLE = () => md !== null;

/**
 * The frontmatter is BLANKED with spaces, not cut out: the offsets must stay the
 * same, because the checks cut the document by offset. Blanking is necessary — inside
 * a YAML block scalar a line indented by two spaces (`  ## Foo`) is a real ATX
 * heading to CommonMark, and without blanking the frontmatter starts supplying
 * sections.
 */
const FRONTMATTER_RE = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?=\r?\n|$)/;
export function blankFrontmatter(text) {
  const m = FRONTMATTER_RE.exec(text);
  return m ? m[0].replace(/[^\n]/g, " ") + text.slice(m[0].length) : text;
}

/**
 * The frontmatter body (between the fences), or `null` — if the file opens without one.
 *
 * Added 2026-08-20, when eight places in `.claude/**` cut the frontmatter with eight
 * slightly different regexes: some knew about `\r\n`, some did not; some required a
 * newline after the closing fence, some did not. The difference between them is not
 * style, it is a different answer on one and the same file.
 *
 * ⚠️ This is NOT a parser and does not claim to be: `---` frontmatter is not markdown,
 * no markdown parser models it (the analysis is in the root `CLAUDE.md`, "Considered
 * and rejected: gray-matter"). The value here is one fence instead of eight, and the
 * parsing of VALUES is done by `js-yaml` at the caller.
 */
export function frontmatterBlock(text) {
  const m = FRONTMATTER_RE.exec(text);
  if (!m) return null;
  const inner = m[0].replace(/^---[ \t]*\r?\n/, "").replace(/\r?\n---[ \t]*$/, "");
  return inner;
}

/**
 * The document WITHOUT the frontmatter — the block is cut out together with the
 * newline after it.
 *
 * Differs from {@link blankFrontmatter} in that the offsets SHIFT. Both forms are
 * needed and both have been used already: blanking — where character positions are
 * later shown to the user; cutting — where the text is merely counted. Choose by what
 * the caller does, not by taste.
 */
export function stripFrontmatter(text) {
  const m = FRONTMATTER_RE.exec(text);
  return m ? text.slice(m[0].length).replace(/^\r?\n/, "") : text;
}

/** Line-start offsets — so that `token.map` becomes a position in the source string. */
function lineStarts(text) {
  const out = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") out.push(i + 1);
  return out;
}

/**
 * All the document's headings: `[{ depth, text, line, offset }]`, in order of occurrence.
 *
 * `offset` — the index of the start of the heading's line IN THE SAME text that was
 * passed in, in `slice`/`indexOf` units (UTF-16), because those are exactly what the
 * checks cut the document with. `line` — 0-based line number. `text` — without the
 * hashes, trimmed at the edges.
 *
 * ⚠️ ATX ONLY (`## Heading`). Setext (`Heading\n---`) is deliberately NOT counted as a
 * heading: in this knowledge base `---` is a prose separator, and a paragraph it stands
 * under without a blank line would become a level-2 heading per CommonMark. The former
 * regexps knew only ATX, so this preserves the contract rather than narrowing it.
 */
export function headings(text) {
  if (md === null) return [];
  const toks = md.parse(blankFrontmatter(text), {});
  const starts = lineStarts(text);
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.type !== "heading_open" || !t.map) continue;
    if (!t.markup || !t.markup.startsWith("#")) continue; // setext — see the caveat above
    const inline = toks[i + 1];
    out.push({
      depth: Number(t.tag.slice(1)),
      text: inline?.type === "inline" ? inline.content.trim() : "",
      line: t.map[0],
      offset: starts[t.map[0]] ?? 0,
    });
  }
  return out;
}

/** Offsets of the `---` thematic breaks (in this knowledge base — a prose separator). */
export function thematicBreaks(text) {
  if (md === null) return [];
  const starts = lineStarts(text);
  return md
    .parse(blankFrontmatter(text), {})
    .filter((t) => t.type === "hr" && t.map)
    .map((t) => starts[t.map[0]] ?? 0);
}

/**
 * A section's body: from the line AFTER the heading matching `match`, up to the next
 * heading of THE SAME OR A LOWER level. `{ heading, body }` or `null`.
 *
 * `match` — a regex over the heading text OR a predicate over `{depth,text,line,offset}`.
 *
 * Level-or-lower, not "exactly `##`": a `###` subsection inside the section does not
 * end it — that is exactly how the former expressions with the `(?=\n## )` lookahead
 * behaved. A regex cannot know this distinction in principle: it has no notion of level.
 *
 * `depth` — the CEILING on the level of the heading itself. Without it an `### Abstract`
 * quoted in an appendix becomes the abstract — and the abstract is judged with a
 * threshold of ZERO.
 *
 * `stopAtRule` additionally cuts the section off at the first `---`. That is NOT markdown
 * structure but a paper convention, and it is preserved deliberately: the conclusion has
 * a `---` before the appendices, and without that boundary a section with no following
 * `##` would reach to the end of the file.
 *
 * 🔴 A MERGED VERSION. On 2026-08-11 this function appeared SIMULTANEOUSLY in two places:
 * here (for `kb-lint`) and in `paper-lint.mjs` (richer — with the level ceiling, the
 * heading in the result and `stopAtRule`). Both were written within one hour by two
 * parallel passes, neither saw the other. Merged into the rich version: the weak one was
 * a subset, and keeping both would have meant diverging in behaviour at the very next edit.
 */
export function sectionBody(text, match, { depth = 6, stopAtRule = false } = {}) {
  const test = typeof match === "function" ? match : (h) => match.test(h.text);
  const hs = headings(text);
  const i = hs.findIndex((h) => h.depth <= depth && test(h));
  if (i === -1) return null;
  const h = hs[i];
  const next = hs.slice(i + 1).find((n) => n.depth <= h.depth);
  let end = next ? next.offset : text.length;
  if (stopAtRule) {
    const hr = thematicBreaks(text).find((o) => o > h.offset && o < end);
    if (hr !== undefined) end = hr;
  }
  // The body starts on the line AFTER the heading: the heading itself is not part of the
  // section, just as the former expressions' group did not capture it.
  const nl = text.indexOf("\n", h.offset);
  const start = nl === -1 || nl + 1 > end ? end : nl + 1;
  return { heading: h, body: text.slice(start, end) };
}

/**
 * Slicing the document into chunks "a heading + everything up to the next heading FROM
 * THE SAME RANGE of levels". → `[{ heading, raw, body }]`.
 *
 * This is exactly what four scripts did as `split(/^(?=## )/m)` and
 * `split(/^(?=#{2,3} )/m)`. The shape of the expression lied about the intent: "two or
 * three hashes" is about CHARACTERS, while what is needed is the LEVEL, and `#{2,3}`
 * also caught a hash inside a ```-block, that is, it cut a quotation from someone
 * else's paper as a section of its own.
 *
 * `heading` — `null` on the zeroth element (the preamble before the first heading). It
 * is ALWAYS there, including empty: the former `split` also always returned the chunk
 * before the first separator as its zeroth element, and callers rely on that
 * (`sub === chunk` in `artifact-coverage` meant "there are no subsections").
 *
 * `raw` — WITH the heading line (it is used to count `§` references and bold numbers,
 * which occur in the heading itself too), `body` — without it (it is used to count words).
 *
 * 2026-08-11: moved here rather than copied into every script, because the chunk
 * boundary is the one place where an off-by-one is easy, and such a mistake has already
 * happened (`recordBlock` in `skill-corpus.mjs` returned a single "#" character for all
 * 21 skills).
 */
export function splitSections(text, { min = 2, max = 6 } = {}) {
  const hs = headings(text).filter((h) => h.depth >= min && h.depth <= max);
  const out = [];
  const preEnd = hs.length ? hs[0].offset : text.length;
  out.push({ heading: null, raw: text.slice(0, preEnd), body: text.slice(0, preEnd) });
  for (let i = 0; i < hs.length; i++) {
    const h = hs[i];
    const end = i + 1 < hs.length ? hs[i + 1].offset : text.length;
    const nl = text.indexOf("\n", h.offset);
    const bodyStart = nl === -1 || nl + 1 > end ? end : nl + 1;
    out.push({ heading: h, raw: text.slice(h.offset, end), body: text.slice(bodyStart, end) });
  }
  return out;
}

/**
 * The text without the contents of ```-blocks (the fence lines themselves go too).
 *
 * Through the parser, not `/```[\s\S]*?```/g`: that pattern glues the end of one block
 * to the start of the next when the number of fences is odd, knows nothing about `~~~`
 * fences or indented fences, and silently eats the prose between blocks.
 *
 * `blank: true` — the block's lines are NOT deleted but REPLACED with empty ones. The
 * difference is not cosmetic: deleting the lines GLUES the paragraph before the block to
 * the paragraph after it, and a code block is a block boundary — on the other side a
 * different paragraph starts. Measured 2026-08-11 on `<papers-root>/<paper>/README.md`:
 * `prose-lint` counted 82 sentences there, and after the lines were deleted it counted
 * 81 — the lead paragraph "**Reproduction commands:**" merged with the text AFTER the
 * block into one sentence. That is exactly the failure against which `prose-lint` itself
 * says "Paragraph and heading boundaries END a sentence", and it inflates the
 * claims-per-sentence counter — the threshold at which the file emits findings. The
 * former regex preserved the boundary (it left one newline on each side), so `blank` is
 * also a preservation of the former behaviour where that behaviour was right.
 */
/**
 * The CONTENTS of fenced blocks — the other side of `stripFences`.
 *
 * Added 2026-09-08 for the check "a path as a command argument inside a ```-block"
 * (the sixth form of a reference). A private regex for the fence there would have been
 * the seventh instance of the class this knowledge base has already paid for:
 * `/^```[\s\S]*?^```/gm` knows nothing about nested fences or about `~~~`, and the
 * parser does — the `fence` token has a `content`.
 *
 * No parser — returns an empty list, and the caller must survive that: for hooks
 * degradation is acceptable (see the module comment), while a silent fallback to a
 * regex would mean a working degraded version that nobody notices.
 */
export function fences(text) {
  if (md === null) return [];
  const out = [];
  for (const t of md.parse(blankFrontmatter(text), {}))
    if (t.type === "fence" || t.type === "code_block") out.push(t.content);
  return out;
}

export function stripFences(text, { blank = false } = {}) {
  if (md === null) return text;
  const lines = text.split("\n");
  const drop = new Set();
  for (const t of md.parse(blankFrontmatter(text), {}))
    if ((t.type === "fence" || t.type === "code_block") && t.map)
      for (let i = t.map[0]; i < t.map[1]; i++) drop.add(i);
  return blank
    ? lines.map((l, i) => (drop.has(i) ? "" : l)).join("\n")
    : lines.filter((_, i) => !drop.has(i)).join("\n");
}


/**
 * For SCRIPTS, not for hooks: fails if there is no parser.
 *
 * For a linter degradation is acceptable — it is advisory and can say so out loud. A
 * skill script hands numbers to a pipeline gate, and an empty list of headings there is
 * indistinguishable from "the paper has no sections". A confident zero has already been
 * read as a finding four times in this repo; here it is inexpressible.
 */
export function requireMarkdown() {
  if (MD_AVAILABLE()) return;
  // 🔴 THE CURE DEPENDS ON THE DELIVERY CHANNEL, AND NAMING THE WRONG ONE WASTES THE ERROR.
  // Measured 2026-09-19: `npm pack` strips `package-lock.json` unconditionally, and a plugin copy
  // gets `npm ci` only when a lockfile is present in the fetched root — so a plugin installed from
  // npm has NO `node_modules`, with no log entry anywhere. Telling that user to run `npm i at the
  // repo root` points at a repository they do not have. The channel is readable from this file's
  // own location, so the message can name it instead of guessing.
  const fromPluginCache = import.meta.url.includes("/.claude/plugins/");
  console.error(
    "markdown-it does not resolve — this script parses markup with a parser and without it " +
      "would produce a confident zero instead of an error.\n" +
      (fromPluginCache
        ? "  Running from a PLUGIN copy, which is installed without dependencies. Install the npm\n" +
          "  package in the project as well (`npm i research-paper-pipeline`) and call it through\n" +
          "  `npx rpp`, which resolves from the project's own tree."
        : "  Cured by `npm i` at the repo root."),
  );
  process.exit(2);
}

/**
 * GFM tables — rows, cells and the line range, WITH THE PARSER.
 *
 * The only consumer as of 2026-08-20 is `crosspost-article`, which needs to re-lay a
 * table into a monospace block for a platform without tables (Medium). It lives here
 * and not in the skill, by the rule "markup is parsed with a parser, and in one place":
 * with a regex a table is told apart from a line of text with pipes only by its
 * neighbours, and that is exactly the class that has already cost this repo 27 places.
 *
 * Returns `{ line, endLine, rows }`, where `rows[0]` is the header; the alignment row
 * (`| --- |`) is thrown away, because in monospace output it has nothing to express.
 */
/**
 * The document's paragraphs — `paragraph_open` line ranges, WITH THE PARSER.
 * `[{ line, endLine }]`.
 *
 * The only consumer as of 2026-08-21 is `crosspost-article`: the blog's sources are
 * hard-wrapped at a column (an editorial habit, not markdown), and the platforms render
 * a single `\n` inside a paragraph DIFFERENTLY — dev.to (Redcarpet) keeps it as a
 * literal line break, and the paragraph arrives torn into short lines exactly at the
 * source file's boundaries. Medium has no such defect not because the platform is more
 * honest, but because the paste goes through "Import a story" — the importer takes the
 * ALREADY RENDERED page of the site (where the breaks were collapsed by the browser long
 * ago), not the raw markdown.
 *
 * The range is EXACTLY the one `t.map` gives on `paragraph_open` — that is, a code
 * fence, a heading, a table, a list (in a TIGHT list the item is not wrapped in a
 * `paragraph_open` at all, it has no paragraph of its own) fall outside this function
 * automatically, by the construction of the parser, and not by a separate line-type
 * check.
 */
export function paragraphs(text) {
  if (md === null) return [];
  return md
    .parse(blankFrontmatter(text), {})
    .filter((t) => t.type === "paragraph_open" && t.map)
    .map((t) => ({ line: t.map[0], endLine: t.map[1] }));
}

export function tables(text) {
  if (md === null) return [];
  const lines = blankFrontmatter(text).split("\n");
  const out = [];
  for (const t of md.parse(blankFrontmatter(text), {})) {
    if (t.type !== "table_open" || !t.map) continue;
    const rows = [];
    for (let i = t.map[0]; i < t.map[1]; i++) {
      const raw = lines[i];
      if (/^\s*\|?[\s:|-]+\|?\s*$/.test(raw) && raw.includes("-")) continue; // alignment
      rows.push(
        raw
          .replace(/^\s*\|/, "")
          .replace(/\|\s*$/, "")
          .split("|")
          .map((c) => c.trim()),
      );
    }
    out.push({ line: t.map[0], endLine: t.map[1], rows });
  }
  return out;
}
