/** CLAIM 3, script half: transitive third-party import closure over the scripts
 *  the SKILL.md files actually reference. Reads only; never executes them. */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";

const REPO = "/home/user/research-paper-pipeline";
const SKILLS = join(REPO, "skills");

// 1. what do SKILL.md files reference?
const refs = new Set();
for (const d of readdirSync(SKILLS)) {
  const md = join(SKILLS, d, "SKILL.md");
  if (!existsSync(md)) continue;
  for (const m of readFileSync(md, "utf8").matchAll(/\.claude\/skills\/paper-pipeline\/(scripts\/[A-Za-z0-9_-]+\.mjs)/g))
    refs.add(m[1]);
}
console.log("=== scripts referenced by SKILL.md files ===");
const entry = [];
for (const r of [...refs].sort()) {
  const p = join(SKILLS, "paper-pipeline", r);
  const ok = existsSync(p);
  console.log(`  ${ok ? "EXISTS " : "MISSING"}  ${r}`);
  if (ok) entry.push(p);
}

// 2. transitive closure of local imports; collect bare specifiers
const IMPORT = /(?:^|\s)(?:import|export)\s[^;]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|await import\(\s*([A-Za-z_$][\w$]*)\s*\)/gm;
const seen = new Set(), thirdParty = new Map(), dynamicNonLiteral = [];
const queue = [...entry];
while (queue.length) {
  const f = resolve(queue.pop());
  if (seen.has(f) || !existsSync(f)) continue;
  seen.add(f);
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(IMPORT)) {
    const spec = m[1] ?? m[2];
    if (!spec) { dynamicNonLiteral.push(`${f.replace(REPO+"/","")}: import(<variable ${m[3]}>)`); continue; }
    if (spec.startsWith("node:")) continue;
    if (spec.startsWith(".") || spec.startsWith("/")) { queue.push(resolve(dirname(f), spec)); continue; }
    if (!thirdParty.has(spec)) thirdParty.set(spec, []);
    thirdParty.get(spec).push(f.replace(REPO + "/", ""));
  }
}
console.log("\n=== transitive local module closure (" + seen.size + " files) ===");
for (const f of [...seen].sort()) console.log("  " + f.replace(REPO + "/", ""));
console.log("\n=== THIRD-PARTY (bare) SPECIFIERS IN THAT CLOSURE ===");
if (!thirdParty.size) console.log("  (none)");
for (const [spec, where] of [...thirdParty].sort()) console.log(`  ${spec}  <-  ${[...new Set(where)].join(", ")}`);
console.log("\n=== non-literal dynamic imports (cannot be resolved statically) ===");
console.log(dynamicNonLiteral.length ? dynamicNonLiteral.map(s=>"  "+s).join("\n") : "  (none)");
