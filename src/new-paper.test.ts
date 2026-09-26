/**
 * `paperlint new` writes `<paper>/paperlint.json` — from the package's template, or from the
 * project's `<papers>/.template/` when it has one — with no venue chosen yet, which lint then names
 * in one warning instead of staying silent.
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { newPaper, OVERRIDE_DIR } from "./new-paper.ts";
import { parsePaperSettings } from "./paper-settings.ts";
import { chooseVenue, run } from "./cli.ts";
import { shippedPresets } from "./presets.ts";
import { packageVenuesDir } from "../skills/paper-pipeline/scripts/consumer.mjs";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), "paperlint-new-")));
  dirs.push(d);
  return d;
};
const settingsOf = (dir: string) =>
  JSON.parse(readFileSync(join(dir, "paperlint.json"), "utf8")) as Record<
    string,
    unknown
  >;

describe("paperlint new — paperlint.json", () => {
  it("is always written, from the package template: no venue chosen yet, and valid", () => {
    const papers = join(tmp(), "papers");
    const r = newPaper(papers, "demo", "tex");
    expect(r.ok && r.files.find((f) => f.file === "paperlint.json")).toEqual({
      file: "paperlint.json",
      status: "created",
      from: "package",
    });
    const s = settingsOf(join(papers, "demo"));
    expect(s["extends"]).toBeNull();
    expect(String(s["$comment"])).toMatch(/paperlint:agenticdev/);
    expect(parsePaperSettings(s)).toEqual({
      ok: true,
      value: { extends: null, kind: null, pdf: null, rules: null },
    });
  });

  it("comes from the project's <papers>/.template/ when it has one", () => {
    const papers = join(tmp(), "papers");
    mkdirSync(join(papers, OVERRIDE_DIR), { recursive: true });
    writeFileSync(
      join(papers, OVERRIDE_DIR, "paperlint.json"),
      '{ "extends": "paperlint:aisec", "kind": "research" }\n',
    );
    const r = newPaper(papers, "house", "tex");
    expect(r.ok && r.files.find((f) => f.file === "paperlint.json")?.from).toBe(
      "project",
    );
    expect(settingsOf(join(papers, "house"))).toEqual({
      extends: "paperlint:aisec",
      kind: "research",
    });
  });

  it("is never overwritten", () => {
    const papers = join(tmp(), "papers");
    mkdirSync(join(papers, "p"), { recursive: true });
    writeFileSync(
      join(papers, "p", "paperlint.json"),
      '{"extends":"paperlint:aisec"}',
    );
    const r = newPaper(papers, "p", "tex");
    expect(
      r.ok && r.files.find((f) => f.file === "paperlint.json")?.status,
    ).toBe("kept");
    expect(settingsOf(join(papers, "p"))).toEqual({
      extends: "paperlint:aisec",
    });
  });
});

describe("paperlint lint — a paper with no venue preset chosen", () => {
  async function lintNew(extendsValue: string | null) {
    const root = tmp();
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "c", private: true }),
    );
    newPaper(join(root, "papers"), "demo", "tex");
    if (extendsValue !== null)
      writeFileSync(
        join(root, "papers", "demo", "paperlint.json"),
        JSON.stringify({ extends: extendsValue, kind: "short" }),
      );
    const out: string[] = [];
    const code = await run(["lint", "--json"], {
      cwd: root,
      log: (s: string) => out.push(s),
      err: () => {},
    });
    const messages = (
      JSON.parse(out.join("\n")) as {
        messages: { ruleId: string; severity: number; message: string }[];
      }[]
    ).flatMap((r) => r.messages);
    return { code, messages };
  }

  it("gets exactly one warning naming the file to set, and exits 0", async () => {
    const { code, messages } = await lintNew(null);
    expect(code).toBe(0);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.ruleId).toBe("pdf/measured");
    expect(messages[0]?.severity).toBe(1);
    expect(messages[0]?.message).toMatch(/names no venue preset yet/);
    expect(messages[0]?.message).toMatch(
      /set "extends" in .*papers\/demo\/paperlint\.json/,
    );
  });

  it("a paper with a real extends does not get it", async () => {
    const { messages } = await lintNew("paperlint:agenticdev");
    expect(messages.map((m) => m.message).join("\n")).not.toMatch(
      /names no venue preset yet/,
    );
  });
});

/** `paperlint new <args>` in a fresh project (not a terminal: vitest's stdin is not a TTY). */
async function newIn(args: string[], files: Record<string, string> = {}) {
  const root = tmp();
  const all = {
    "package.json": JSON.stringify({ name: "c", private: true }),
    ...files,
  };
  for (const [p, text] of Object.entries(all)) {
    mkdirSync(join(root, p, ".."), { recursive: true });
    writeFileSync(join(root, p), text);
  }
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(["new", "demo", ...args], {
    cwd: root,
    log: (s: string) => out.push(s),
    err: (s: string) => err.push(s),
  });
  const dir = join(root, "papers", "demo");
  return {
    code,
    out: out.join("\n"),
    err: err.join("\n"),
    dir,
    settings: () => settingsOf(dir),
  };
}

describe("paperlint new --venue / --kind", () => {
  const PRESET = `{
  "extends": "paperlint:acm-sigconf",
  "format": { "kinds": { "short": { "body_pages_max": 4 } } },
}
`;

  it("a shipped venue and its kind → extends and kind in paperlint.json, lint resolves it", async () => {
    const r = await newIn(["--venue", "agenticdev", "--kind", "short"]);
    expect(r.settings()).toEqual({
      extends: "paperlint:agenticdev",
      kind: "short",
    });
    expect(r.out).not.toMatch(/pdf\/profile/);
    expect(r.code).toBe(0);
  });

  it("🔴 a path is relative to where you run it, and written relative to the paper's file", async () => {
    const r = await newIn(
      ["--venue", "./venues/my-workshop.jsonc", "--kind", "short"],
      {
        "venues/my-workshop.jsonc": PRESET,
      },
    );
    // Guards: written as typed, `./venues/…` would name papers/demo/venues/…, which does not exist.
    expect(r.settings()).toEqual({
      extends: "../../venues/my-workshop.jsonc",
      kind: "short",
    });
    expect(r.out).not.toMatch(/pdf\/profile/);
    expect(r.code).toBe(0);
  });

  it("an unknown venue exits 2, lists the shipped presets, and creates nothing", async () => {
    const r = await newIn(["--venue", "icse"]);
    expect(r.code).toBe(2);
    // Guards: the list is read from the shipped presets, the same list lint prints.
    expect(r.err).toContain(shippedPresets(packageVenuesDir()).join(", "));
    expect(r.err).toMatch(/--venue icse: no such venue preset/);
    expect(existsSync(r.dir)).toBe(false);
  });
});

describe("paperlint new --venue / --kind — refusals and defaults", () => {
  it.each([
    [
      "a kind the preset lacks",
      ["--venue", "agenticdev", "--kind", "long"],
      /`agenticdev` has no kind `long`; its kinds: short, full, demo/,
    ],
    ["a kind without a venue", ["--kind", "short"], /--kind needs --venue/],
    [
      "a kind for a preset with no kinds",
      ["--venue", "acm-sigconf", "--kind", "short"],
      /`acm-sigconf` has no kinds/,
    ],
    [
      "a path that does not exist",
      ["--venue", "./venues/nope.jsonc"],
      /no such file .* relative to where you run the command/,
    ],
  ])("%s → exit 2, nothing created", async (_, args, message) => {
    const r = await newIn(args);
    expect(r.err).toMatch(message);
    expect(r.code).toBe(2);
    expect(existsSync(r.dir)).toBe(false);
  });

  it("a venue with kinds and no --kind: written, and new says what lint will report", async () => {
    const r = await newIn(["--venue", "agenticdev"]);
    expect(r.settings()).toEqual({ extends: "paperlint:agenticdev" });
    expect(r.out).toMatch(
      /kind: not set — `agenticdev` sets a page limit per kind/,
    );
    expect(r.out).toMatch(/pdf\/profile/);
  });

  it("without a terminal and no --venue: as before, and the hint names --venue", async () => {
    const r = await newIn([]);
    expect(r.settings()["extends"]).toBeNull();
    expect(r.out).toMatch(/venue: none yet .*--venue <preset>/);
    expect(r.code).toBe(0);
  });

  it("an existing paperlint.json is never overwritten: --venue is refused", async () => {
    const r = await newIn(["--venue", "aisec"], {
      "papers/demo/paperlint.json": '{ "extends": null }\n',
    });
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/already exists and is never overwritten/);
    expect(r.settings()).toEqual({ extends: null });
  });
});

describe("chooseVenue — on a terminal", () => {
  const at = (answers: string[]) => {
    const asked: string[] = [];
    return {
      asked,
      opts: {
        paperDir: "/p/papers/demo",
        cwd: "/p",
        interactive: true,
        ask: async (q: string) => (asked.push(q), answers.shift() ?? ""),
      },
    };
  };

  it("asks the venue from the shipped list, then its kind", async () => {
    const t = at(["agenticdev", "full"]);
    const r = await chooseVenue({ venue: null, kind: null }, t.opts);
    expect(r).toMatchObject({
      ok: true,
      value: { extends: "paperlint:agenticdev", kind: "full" },
    });
    expect(t.asked[0]).toContain(
      [...shippedPresets(packageVenuesDir()), "none"].join(" / "),
    );
    expect(t.asked[1]).toMatch(/kind: short \/ full \/ demo \/ later/);
  });

  it("the default answer is none: no venue written", async () => {
    const t = at([""]);
    expect(await chooseVenue({ venue: null, kind: null }, t.opts)).toEqual({
      ok: true,
      value: null,
    });
  });

  it("without a terminal nothing is asked", async () => {
    const t = at(["agenticdev"]);
    const r = await chooseVenue(
      { venue: null, kind: null },
      { ...t.opts, interactive: false },
    );
    expect(r).toEqual({ ok: true, value: null });
    expect(t.asked).toEqual([]);
  });
});
