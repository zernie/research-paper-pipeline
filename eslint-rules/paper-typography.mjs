/**
 * Three mechanical conventions a reviewer already raised, ONE RULE EACH, reported where each
 * occurrence is and fixed by `paperlint lint --fix`:
 *
 *   paper/section-word      `§5`, `\S\ref{…}`  →  `Section 5`, `Section~\ref{…}`
 *   paper/leading-zero      `.05`              →  `0.05`
 *   paper/figure-ref-style  `Fig.~\ref` beside `Figure~\ref` in one document → the majority form
 *
 * The fourth check of the old `paper/typography`, an unreachable bibliography entry, is
 * `bib/reachable-entry` (bib-reachable-entry.mjs): it is about the bibliography, not the prose,
 * and it has no fix.
 *
 * ── PROVENANCE: every one is a real review finding, not an invented style ───────────────
 * From HotCRP #20 (2026-08-23). Reviewer B listed two as literal to-dos:
 *   B#11  "§ -> Section"   one paper in the source corpus carried 246
 *   B#12  ".05 -> 0.05"    four in the submitted text, fixed by hand
 *   (own) `Fig.` and `Figure` side by side
 *
 * ── WHY THERE IS NO DEBT OPTION ANY MORE (3.0.0) ──────────────────────────────────────────
 * Until 3.0.0 this was ONE rule, `paper/typography`, that counted all four per paper against a
 * declared `debt` and spoke only when a count grew. A ratchet was needed because the rule could
 * only COUNT: 246 section signs meant 246 edits by hand, so the only way to turn it on was to
 * freeze the backlog. Every check here now has a FIX, so the backlog costs one command
 * (`paperlint lint --fix`), and the ratchet — per-paper numbers in the project config, keyed by
 * a path — has nothing left to protect. A deliberate exception is an ESLint disable directive on
 * the line (`% eslint-disable-next-line paper/section-word -- reason`), the standard escape
 * hatch every ESLint user already knows, not a counter.
 *
 * ── WHY section-word AND figure-ref-style READ `sourceCode.raw` ───────────────────────────
 * They are about MARKUP. The prose projection of the LaTeX language blanks macros — that is its
 * purpose — so `\S\ref{}` and `Fig.~\ref{}` reach a normal rule as spaces. Offsets coincide
 * between the two (blanking preserves length), so scanning `raw` and reporting the offset found
 * there points at the right byte. Comments and the inline bibliography are skipped.
 *
 * 🔴 BOTH forms of the section sign, and the second one is why this check was ever wrong. The
 * first version counted only the literal `§` and returned ZERO on the very paper whose reviewer
 * raised it: the source writes `\S\ref{sec:threats}`, which RENDERS as `§5`.
 *
 * ── WHY leading-zero READS THE PARSED TREE (paperlint#44) ──────────────────────────────────
 * ISO 80000-1 ("the decimal sign shall be preceded by a zero" for magnitudes below 1) and the
 * IEEE Editorial Style Manual ("0.25, not .25") require the zero. A regex over the raw source
 * found 22 decimals on a real corpus and none was a defect: every one sat in markup (an option,
 * a column spec, a comment, a listing, a tikz coordinate). So this walks the TREE and keeps only
 * what the reader sees as a number:
 *   LaTeX     prose, inline and display math, table cells, and the text arguments of a known
 *             set of text macros. Not: any other macro's arguments, environment arguments,
 *             comments, verbatim/listings/`\lstinline`, tikz, the preamble, the bibliography.
 *   Markdown  text nodes, table cells included. Not: code, inline code, html, front matter.
 * Each character of a run keeps its source offset, so the finding points at the dot and the fix
 * inserts the zero there. The arXiv lookbehind stays: in `2310.05736` the dot follows a digit.
 * A text macro outside the known set (`\hl{.05}`) is read as a parameter and NOT reported — a
 * miss costs less than a finding on markup.
 *
 * 🔴 A NUMBER AFTER `¶` OR `§` IS A DESIGNATOR, NOT A DECIMAL (#102). An auditing standard is cited
 * by paragraph as `¶¶.42`, and `--fix` rewrote it to `¶¶0.42` — a fix that changed a reference.
 * So a lexeme right after the sign (`¶`, `§`, `\P`, `\S`, spaces or `~` between) is silent. The
 * same sentence then goes on `and .44`: a paragraph number continuing the list, or a decimal —
 * the text does not say which. In a paragraph that already cites `¶.nn` this way, a bare decimal
 * is REPORTED WITHOUT A FIX and the zero is offered as a suggestion: an autofix must never be the
 * one to decide what a number means. A real `.05` in any other paragraph is fixed as before.
 */
import { getParser } from "@unified-latex/unified-latex-util-parse";

/** The inline bibliography — a `filecontents` block writing a `.bib` — with its offsets. */
export function bibRange(text) {
  const m =
    /\\begin\{filecontents\*?\}(?:\[[^\]]*\])?\{[^}]*\.bib\}\r?\n([\s\S]*?)\\end\{filecontents\*?\}/d.exec(
      text,
    );
  if (!m) return null;
  return {
    start: m.index,
    end: m.index + m[0].length,
    bodyStart: m.indices[1][0],
    body: m[1],
  };
}

/**
 * The ranges a markup rule must not read: LaTeX comments (the language gives them as `html`
 * nodes, with positions) and the inline bibliography.
 */
function skippedRanges(sourceCode, raw) {
  const out = [];
  for (const n of sourceCode.ast?.children ?? [])
    if (n.type === "html" && n.position)
      out.push([n.position.start.offset, n.position.end.offset]);
  const bib = bibRange(raw);
  if (bib) out.push([bib.start, bib.end]);
  return out;
}
const inside = (ranges, i) => ranges.some(([s, e]) => i >= s && i < e);

/** Every match of `re` in `raw` outside the skipped ranges. */
function markupMatches(sourceCode, re) {
  const raw = sourceCode.raw;
  const skip = skippedRanges(sourceCode, raw);
  return [...raw.matchAll(re)].filter((m) => !inside(skip, m.index));
}

const isTex = (sourceCode) => typeof sourceCode.raw === "string";

// ── the text a READER sees, with the source offset of every character ─────────────────────

/** A run of visible text; `offs[i]` is the source offset of `text[i]`, or null when unknown. */
const run = () => ({ text: "", offs: [] });

// Environments whose body is not typeset as text: code, drawings, the inline bibliography.
const TEX_HIDDEN_ENV =
  /^(verbatim|Verbatim|lstlisting|minted|tikzpicture|filecontents\*?|comment)$/;
// Text macros whose mandatory argument IS prose. Every other macro's arguments are parameters.
const TEX_PROSE_ARG =
  /^(emph|textbf|textit|textsl|textsc|textup|textmd|textrm|textsf|textnormal|underline|text|mbox|caption|footnote|footnotetext|thanks|title|textsuperscript|textsubscript|part|chapter|section|subsection|subsubsection|paragraph|subparagraph)$/;
// Macros whose LAST mandatory argument is what the reader sees.
const TEX_LAST_ARG = /^(multicolumn|multirow|textcolor|href)$/;
// In math every macro argument is typeset except these.
const TEX_MATH_HIDDEN =
  /^(label|ref|eqref|autoref|cite|hspace|vspace|hskip|vskip|kern|mkern|mskip|rule|phantom|hphantom|vphantom|color|raisebox|includegraphics)$/;

const mandatory = (macro) =>
  (macro.args || []).filter((a) => a.openMark === "{");

/**
 * unified-latex attaches arguments only to what it has a signature for. For the rest the
 * arguments come back as the NEXT SIBLINGS: an optional `[…]` as bare strings, then groups.
 * They are parameters, not prose. Returns the index of the last sibling to skip after `i`.
 */
function unparsedArgsEnd(nodes, i) {
  let j = i + 1;
  if (nodes[j]?.type === "string" && nodes[j].content.startsWith("[")) {
    let k = j;
    while (
      k < nodes.length &&
      !(nodes[k].type === "string" && nodes[k].content.endsWith("]"))
    )
      k++;
    if (k < nodes.length) j = k + 1;
  }
  while (nodes[j]?.type === "group") j++;
  return j - 1;
}

/** Append a string node to the current run, keeping each character's offset. */
function appendString(cur, n, src) {
  const start = n.position?.start?.offset;
  const exact =
    typeof start === "number" &&
    src.slice(start, start + n.content.length) === n.content;
  for (let i = 0; i < n.content.length; i++)
    cur.offs.push(exact ? start + i : null);
  cur.text += n.content;
}

/**
 * Collect runs of visible text from a unified-latex node list. A run is a stretch of sibling
 * `string` nodes with nothing between them: math splits `.05` into `.`, `0`, `5`, and prose
 * keeps `2310.05736` whole — both come back as one word. Anything else ends the run.
 */
function texRuns(nodes, math, src, out) {
  let cur = run();
  const flush = () => {
    if (cur.text) out.push(cur);
    cur = run();
  };
  for (let i = 0; i < (nodes || []).length; i++) {
    const n = nodes[i];
    if (n.type === "string") {
      appendString(cur, n, src);
      continue;
    }
    flush();
    if (
      n.type === "inlinemath" ||
      n.type === "displaymath" ||
      n.type === "mathenv"
    )
      texRuns(n.content, true, src, out);
    else if (n.type === "environment") {
      const env = typeof n.env === "string" ? n.env : "";
      if (!TEX_HIDDEN_ENV.test(env)) {
        const body = n.content || [];
        const from = (n.args || []).length ? 0 : unparsedArgsEnd(body, -1) + 1;
        texRuns(body.slice(from), math, src, out);
      }
    } else if (n.type === "group") {
      texRuns(n.content, math, src, out);
    } else if (n.type === "macro") {
      const args = mandatory(n);
      if (math) {
        if (!TEX_MATH_HIDDEN.test(n.content))
          for (const a of args) texRuns(a.content, true, src, out);
      } else if (TEX_PROSE_ARG.test(n.content)) {
        for (const a of args) texRuns(a.content, false, src, out);
      } else if (TEX_LAST_ARG.test(n.content) && args.length) {
        texRuns(args[args.length - 1].content, false, src, out);
      }
      if (!math && !(n.args || []).length) i = unparsedArgsEnd(nodes, i);
    }
  }
  flush();
  return out;
}

function texVisibleRuns(raw) {
  const root = getParser().parse(raw).content;
  // Only the document body is typeset. A fragment with no `document` environment is all body.
  const document = root.find(
    (n) => n.type === "environment" && n.env === "document",
  );
  return texRuns(document ? document.content : root, false, raw, []);
}

// Markdown node types that are not prose.
const MD_HIDDEN = new Set([
  "code",
  "inlineCode",
  "html",
  "yaml",
  "toml",
  "math",
  "inlineMath",
]);
/**
 * The source offset of each character of a text node's value. The value is the source with
 * markdown's escapes (`\*`) and character references (`&lt;`) resolved, so the two are walked
 * side by side; a character whose source cannot be followed gets null (reported, not fixed).
 */
function mdOffsets(value, src, start) {
  const offs = [];
  let j = start;
  for (const ch of value) {
    if (src[j] === ch) offs.push(j++);
    else if (src[j] === "\\" && src[j + 1] === ch) {
      offs.push(j + 1);
      j += 2;
    } else if (src[j] === "&" && /^&#?\w{1,8};/.test(src.slice(j, j + 10))) {
      offs.push(null);
      j = src.indexOf(";", j) + 1;
    } else {
      offs.push(null);
      j++;
    }
  }
  return offs;
}

function mdVisibleRuns(node, src, out = []) {
  if (!node || MD_HIDDEN.has(node.type)) return out;
  if (node.type === "text") {
    const start = node.position?.start?.offset;
    out.push({
      text: node.value,
      offs:
        typeof start === "number"
          ? mdOffsets(node.value, src, start)
          : [...node.value].map(() => null),
    });
  }
  for (const c of node.children || []) mdVisibleRuns(c, src, out);
  return out;
}

const visibleRuns = (sourceCode) =>
  isTex(sourceCode)
    ? texVisibleRuns(sourceCode.raw)
    : mdVisibleRuns(sourceCode.ast, sourceCode.text);

/** A report at `[from, to)` of the file. */
const at = (context, from, to, rest) => {
  const sc = context.sourceCode;
  context.report({
    loc: { start: sc.getLocFromIndex(from), end: sc.getLocFromIndex(to) },
    ...rest,
  });
};

// ── paper/section-word ─────────────────────────────────────────────────────────────────

// The sign (the glyph, or the `\S` macro not followed by a letter), the separator after it, and
// what follows: a reference (group 3) or a number (group 4).
const SECTION_TEX = /(§|\\S(?![A-Za-z]))(~|[ \t]*)(?=(\\(?:auto)?ref\b)|(\d))/g;
const SECTION_GLYPH = /§/g;

function sectionWord(context) {
  const sc = context.sourceCode;
  if (isTex(sc)) {
    const seen = new Set();
    for (const m of markupMatches(sc, SECTION_TEX)) {
      seen.add(m.index);
      const word = m[3] ? "Section~" : "Section ";
      const range = [m.index, m.index + m[0].length];
      at(context, range[0], range[1], {
        messageId: "sign",
        fix: (f) => f.replaceTextRange(range, word),
      });
    }
    // A glyph before neither a reference nor a number: reported, not rewritten — there is no
    // single right word for a doubled sign or a sign before prose.
    for (const m of markupMatches(sc, SECTION_GLYPH))
      if (!seen.has(m.index))
        at(context, m.index, m.index + 1, { messageId: "sign" });
    return;
  }
  for (const r of visibleRuns(sc))
    for (const m of r.text.matchAll(/§([ \t]*)(\d)?/g)) {
      const from = r.offs[m.index];
      if (from === null || from === undefined) continue;
      // The sign and the space after it; the number stays.
      const range = [from, from + 1 + m[1].length];
      at(context, range[0], range[1], {
        messageId: "sign",
        ...(m[2] ? { fix: (f) => f.replaceTextRange(range, "Section ") } : {}),
      });
    }
}

// ── paper/leading-zero ─────────────────────────────────────────────────────────────────

// The lexeme, matched inside ONE run of visible text. The lookbehind keeps arXiv ids
// (2310.05736) out: there the dot follows a digit.
const BARE_DECIMAL = /(?<![\d.\w])\.\d{2,}\b/g;

// A paragraph or section sign — the glyph, or `\P`/`\S` not followed by a letter — and what may
// sit between it and the number. Both read the SOURCE, because in LaTeX `\P\P.42` reaches the
// visible runs as `.42` alone: the macros end the run.
const DESIGNATOR_BEFORE = /(?:[¶§]|\\[PS](?![A-Za-z]))[ \t~]*$/;
const DESIGNATED = /(?:[¶§]|\\[PS](?![A-Za-z]))[ \t~]*\.\d/;

/** The source of the paragraph holding `i`, up to `i`: from the last blank line before it. */
const paragraphBefore = (src, i) => {
  const head = src.slice(0, i);
  const blank = [...head.matchAll(/\n[ \t]*\n/g)].at(-1);
  return head.slice(blank ? blank.index + blank[0].length : 0);
};

function leadingZero(context) {
  const sc = context.sourceCode;
  const src = isTex(sc) ? sc.raw : sc.text;
  for (const r of visibleRuns(sc))
    for (const m of r.text.matchAll(BARE_DECIMAL)) {
      const dot = r.offs[m.index];
      if (dot === null || dot === undefined) continue;
      const before = paragraphBefore(src, dot);
      if (DESIGNATOR_BEFORE.test(before)) continue;
      const zero = (f) => f.insertTextBeforeRange([dot, dot], "0");
      at(
        context,
        dot,
        dot + 1,
        DESIGNATED.test(before)
          ? {
              messageId: "ambiguous",
              data: { n: m[0] },
              suggest: [
                { messageId: "insertZero", data: { n: m[0] }, fix: zero },
              ],
            }
          : { messageId: "bare", data: { n: m[0] }, fix: zero },
      );
    }
}

// ── paper/figure-ref-style ─────────────────────────────────────────────────────────────

const FIG_REF = /\b(Fig\.|Figure)(?=~?\\(?:ref|autoref)\b)/g;

function figureRefStyle(context) {
  const sc = context.sourceCode;
  if (!isTex(sc)) return;
  const all = markupMatches(sc, FIG_REF);
  const short = all.filter((m) => m[1] === "Fig.");
  const long = all.filter((m) => m[1] === "Figure");
  if (!short.length || !long.length) return;
  // The minority form is rewritten to the majority one; on a tie, to the full word.
  const [minority, word] =
    short.length > long.length ? [long, "Fig."] : [short, "Figure"];
  for (const m of minority) {
    const range = [m.index, m.index + m[1].length];
    at(context, range[0], range[1], {
      messageId: "mixed",
      data: { form: m[1], word, n: String(all.length - minority.length) },
      fix: (f) => f.replaceTextRange(range, word),
    });
  }
}

const rule = (description, messages, check, meta = {}) => ({
  meta: {
    type: "suggestion",
    fixable: "code",
    docs: { description },
    schema: [],
    messages,
    ...meta,
  },
  create: (context) => ({ "root:exit": () => check(context) }),
});

export default {
  rules: {
    "section-word": rule(
      "`§` / `\\S` instead of the word Section (a reviewer's to-do); fixable",
      {
        sign: "`§` instead of the word «Section» — `paperlint lint --fix` writes it",
      },
      sectionWord,
    ),
    "leading-zero": rule(
      "a decimal below 1 written without its leading zero (IEEE / ISO 80000-1); fixable",
      {
        bare: "`{{n}}` has no leading zero — write `0{{n}}` (IEEE / ISO 80000-1); `paperlint lint --fix` inserts it",
        ambiguous:
          "`{{n}}` in a paragraph that cites `¶`/`§` numbers: a decimal without its leading zero, or another paragraph number? Not fixed automatically — write `0{{n}}` for a decimal, or put the sign before a paragraph number",
        insertZero: "It is a decimal: write `0{{n}}`",
      },
      leadingZero,
      { hasSuggestions: true },
    ),
    "figure-ref-style": rule(
      "`Fig.~\\ref` and `Figure~\\ref` mixed in one document; fixable to the majority form",
      {
        mixed:
          "`{{form}}` beside {{n}} × `{{word}}` in one document — use one form; `paperlint lint --fix` writes `{{word}}`",
      },
      figureRefStyle,
    ),
  },
};
