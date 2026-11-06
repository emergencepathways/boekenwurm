// Build the playtest page: compile the engine, inline it with the app into one HTML file.
//   node apps/playtest/build.mjs   ->  apps/playtest/dist/boekenwurm-playtest.html
// One file on purpose: it opens from disk, and publishes as a single artifact.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const engine = join(here, "..", "..", "packages", "engine");
const out = mkdtempSync(join(tmpdir(), "boekenwurm-engine-"));

// Order matters: each module only uses the ones above it.
const MODULES = ["checkpoint", "definitions", "badges", "session", "words", "progress"];

execFileSync("tsc", [
  ...MODULES.map((m) => join(engine, "src", `${m}.ts`)),
  "--outDir", out, "--target", "ES2022", "--module", "ES2022", "--moduleResolution", "bundler",
  "--rewriteRelativeImportExtensions", "--strict", "--skipLibCheck", "--types", "",
], { stdio: "inherit" });

const exported = [];
// packages/dutch: the base-form finder, compiled the same way
const dutchOut = mkdtempSync(join(tmpdir(), "boekenwurm-dutch-"));
execFileSync("tsc", [join(here, "..", "..", "packages", "dutch", "src", "lemma.ts"), "--outDir", dutchOut, "--target", "ES2022",
  "--module", "ES2022", "--moduleResolution", "bundler", "--strict", "--skipLibCheck", "--types", ""], { stdio: "inherit" });
const dutchJs = readFileSync(join(dutchOut, "lemma.js"), "utf8").replace(/^export\s+(function|const)/gm, "$1");
rmSync(dutchOut, { recursive: true, force: true });
const irregular = readFileSync(join(here, "..", "..", "data", "nl", "irregular-verbs.json"), "utf8");
const dutch = `const Dutch = (() => {\n${dutchJs}\nconst IRREGULAR = ${irregular};\nreturn { createLemmatizer, IRREGULAR };\n})();`;

const body = MODULES.map((m) => {
  const js = readFileSync(join(out, `${m}.js`), "utf8")
    .replace(/^import[^;]*;\s*$/gm, "")
    .replace(/^export\s+(function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm, (_, kind, name) => {
      exported.push(name);
      return `${kind} ${name}`;
    })
    .replace(/^export\s*\{\s*\};?\s*$/gm, "");
  return `// ---- engine/${m}.ts ----\n${js}`;
}).join("\n");
rmSync(out, { recursive: true, force: true });

const bundle = `const Engine = (() => {\n${body}\nreturn { ${exported.join(", ")} };\n})();\n${dutch}`;
const html = readFileSync(join(here, "src", "index.html"), "utf8")
  .replace("/*__ENGINE__*/", () => bundle)
  .replace("/*__SAMPLE__*/", () => readFileSync(join(here, "src", "sample.js"), "utf8")
    + `\nSAMPLE.paragraphs = ${JSON.stringify(readFileSync(join(here, "src", "story.txt"), "utf8").trim().split("\n"))};`)
  .replace("/*__APP__*/", () => readFileSync(join(here, "src", "app.js"), "utf8"));

mkdirSync(join(here, "dist"), { recursive: true });
writeFileSync(join(here, "dist", "boekenwurm-playtest.html"), html);
console.log(`built dist/boekenwurm-playtest.html (${(html.length / 1024).toFixed(0)} KB, engine exports: ${exported.length})`);
