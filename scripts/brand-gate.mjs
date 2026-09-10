#!/usr/bin/env node
// Brand gate: the tree must carry the VibeLang identity and nothing of the
// previous one. It fails on any remaining old brand spelling, old package name,
// old diagnostic-code prefix, or old source extension, so a stray reintroduction
// (a merge, a generated file, a copied snippet) is caught by `npm run check`
// and CI rather than by a user.
//
// A line that must mention an old spelling on purpose — a changelog entry, a
// historical note — carries the marker `brand-gate: allow` on the same line.
//
//   node scripts/brand-gate.mjs            # scan the repository
//   node scripts/brand-gate.mjs --root DIR # scan another tree (used by the test)
import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";

const args = process.argv.slice(2);
const rootIndex = args.indexOf("--root");
const root = rootIndex >= 0 ? resolve(args[rootIndex + 1] ?? ".") : process.cwd();

const EXCLUDED_DIRECTORIES = new Set(["node_modules", "dist", ".git", ".jj", "vendor", "coverage", ".cache", ".fork-cache"]);
const EXEMPT_FILES = new Set(["scripts/rename-to-vibelang.mjs", "scripts/brand-gate.mjs", "CHANGELOG.md"]);
const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".woff", ".woff2", ".ttf", ".otf",
  ".bundle", ".zip", ".gz", ".tgz", ".wasm", ".pdf", ".mp4", ".sqlite", ".db", ".node",
]);
const ALLOW_MARKER = "brand-gate: allow";
// A block that discusses the Smithers product on purpose (the owner's durable
// execution library, a separate product this language interoperates with) is
// fenced with these two markers.  // brand-gate: allow
const ALLOW_START = "brand-gate: allow-start";
const ALLOW_END = "brand-gate: allow-end";
// Identifiers that can only mean the other product now: its npm scope and repo.
const OTHER_PRODUCT = /@smthrs\/|smithersai\/smithers\b/gu; // brand-gate: allow

// The GitHub organisation `smithersai` is not a brand spelling; it is the org.
const OLD_SPELLINGS = /Smithers|smithers(?!ai\b)|SMITHERS|smthrs|\.smx?\b/gu;
const OLD_EXTENSIONS = new Set([".sm", ".smx"]);

function walk(directory, files) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRECTORIES.has(entry.name)) walk(path, files);
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

const findings = [];
for (const path of walk(root, []).sort()) {
  const rel = relative(root, path).split(sep).join("/");
  if (EXEMPT_FILES.has(rel)) continue;
  const extension = extname(path).toLowerCase();
  if (OLD_EXTENSIONS.has(extension)) findings.push(`${rel}: file uses the retired source extension ${extension}`);
  if (BINARY_EXTENSIONS.has(extension)) continue;
  const lines = readFileSync(path, "utf8").split("\n");
  let allowed = false;
  lines.forEach((line, index) => {
    if (line.includes(ALLOW_START)) { allowed = true; return; }
    if (line.includes(ALLOW_END)) { allowed = false; return; }
    if (allowed || line.includes(ALLOW_MARKER)) return;
    const matches = line.replace(OTHER_PRODUCT, "").match(OLD_SPELLINGS);
    if (matches) findings.push(`${rel}:${index + 1}: ${[...new Set(matches)].join(", ")}`);
  });
}

if (findings.length > 0) {
  process.stderr.write(`brand-gate: ${findings.length} finding(s)\n${findings.slice(0, 200).join("\n")}\n`);
  if (findings.length > 200) process.stderr.write(`… and ${findings.length - 200} more\n`);
  process.stderr.write("\nRemedy: node scripts/rename-to-vibelang.mjs, or mark a deliberate mention with `brand-gate: allow`.\n");
  process.exit(1);
}
process.stdout.write("brand-gate: ok\n");
