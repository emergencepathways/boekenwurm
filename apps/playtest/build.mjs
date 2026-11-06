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

// packages/ai: prompts, parsing and checks for level work
const aiOut = mkdtempSync(join(tmpdir(), "boekenwurm-ai-"));
execFileSync("tsc", [join(here, "..", "..", "packages", "ai", "src", "level.ts"), "--outDir", aiOut, "--target", "ES2022",
  "--module", "ES2022", "--moduleResolution", "bundler", "--strict", "--skipLibCheck", "--types", ""], { stdio: "inherit" });
const aiNames = [];
const aiJs = readFileSync(join(aiOut, "level.js"), "utf8").replace(/^export\s+(function|const)\s+([A-Za-z_$][\w$]*)/gm, (_, k, n) => {
  aiNames.push(n);
  return `${k} ${n}`;
});
rmSync(aiOut, { recursive: true, force: true });
const ai = `const AI = (() => {\n${aiJs}\nreturn { ${aiNames.join(", ")} };\n})();`;
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

const bundle = `const Engine = (() => {\n${body}\nreturn { ${exported.join(", ")} };\n})();\n${dutch}\n${ai}`;
const html = readFileSync(join(here, "src", "index.html"), "utf8")
  .replace("/*__ENGINE__*/", () => bundle)
  .replace("/*__SAMPLE__*/", () => readFileSync(join(here, "src", "sample.js"), "utf8")
    + `\nSAMPLE.paragraphs = ${JSON.stringify(readFileSync(join(here, "src", "story.txt"), "utf8").trim().split("\n"))};`)
  .replace("/*__APP__*/", () => readFileSync(join(here, "src", "app.js"), "utf8"));

mkdirSync(join(here, "dist", "site"), { recursive: true });
writeFileSync(join(here, "dist", "boekenwurm-playtest.html"), html);

// The hosted site: a full document with a strict content-security policy. Scripts only from this page and
// cdnjs (JSZip); network calls only to Anthropic's API. Book text can't be sent anywhere else.
const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' https://cdnjs.cloudflare.com",
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "connect-src https://api.anthropic.com",
  "img-src data: blob:",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");
const site = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="referrer" content="no-referrer">
<meta name="description" content="Boekenwurm: read Dutch books you own at your level.">
<style>[hidden]{display:none!important} body{margin:0} img{max-width:100%}</style>
</head>
<body>
${html}
</body>
</html>
`;
writeFileSync(join(here, "dist", "site", "index.html"), site);
console.log(`built dist/boekenwurm-playtest.html and dist/site/index.html (${(html.length / 1024).toFixed(0)} KB; engine ${exported.length}, ai ${aiNames.length} exports)`);
