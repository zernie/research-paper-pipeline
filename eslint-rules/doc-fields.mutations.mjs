/**
 * Батарея на `doc/fields`: шесть мутаций, каждая снимает своё несущее свойство.
 *
 * Две последние — про раны, которых у предшественницы не было бы видно вовсе:
 * приведение `Date` из js-yaml (иначе гейт от даты молча перестаёт работать) и
 * фейл-закрыто на отсутствующей шапке (иначе проверка обходится её удалением).
 */
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { runMutations } from "../lib/mutation-driver.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const RULE = join(HERE, "doc-fields.mjs");
const HARNESS = join(HERE, "doc-fields.harness.mjs");

process.exit(
  runMutations({
    root: ROOT,
    runner: "node",
    cases: [
      {
        name: "отсутствующее поле перестаёт быть находкой",
        harness: HARNESS,
        expect: "случай 2: находка обязана называть «нет поля»",
        disables: "сам вердикт — карточка без объявленного поля проходит молча",
        edits: [[RULE, 'if (!(name in data) || data[name] === null || data[name] === "") {', "if (false) {"]],
      },
      {
        name: "значение перестаёт сверяться со словарём",
        harness: HARNESS,
        expect: "случай 3: значение вне словаря обязано давать одну находку",
        disables: "проверку значения — `read: полностью` становится допустимым",
        edits: [[RULE, "if (!values.includes(actual))", "if (false)"]],
      },
      {
        name: "«правило от даты» перестаёт освобождать",
        harness: HARNESS,
        expect: "известный долг, а не находка",
        disables: "освобождение исторического корпуса — 22 старые карточки краснеют разом",
        edits: [
          [RULE, "if (sinceCreated && (!created || created < sinceCreated)) return;", "if (false) return;"],
        ],
      },
      {
        name: "🔴 отсутствие фронтматтера снова освобождает",
        harness: HARNESS,
        expect: "случай 7: документ без фронтматтера обязан давать находку",
        disables: "фейл-закрыто — гейт опять обходится удалением шапки, как у предшественницы",
        edits: [[RULE, "if (seenFrontmatter) return;", "if (true) return;"]],
      },
      {
        name: "🔴 `Date` из js-yaml перестаёт приводиться к строке",
        harness: HARNESS,
        expect: "случай 8: неквотированная НОВАЯ дата обязана ВКЛЮЧАТЬ проверку",
        disables:
          "приведение таймстампа YAML 1.1 — сравнение Date со строкой даёт false МОЛЧА, и дата-гейт умирает незаметно",
        edits: [[RULE, "if (v instanceof Date) return v.toISOString().slice(0, 10);", ""]],
      },
      {
        name: "сломанный YAML перестаёт иметь свой вердикт",
        harness: HARNESS,
        expect: "не разбирается как YAML",
        disables: "разделение причин — неразбираемая шапка становится неотличимой от тишины",
        edits: [[RULE, 'messageId: "malformed",\n                data: { why: e.reason', 'messageId: "missing",\n                data: { why: e.reason']],
      },
    ],
  }),
);
