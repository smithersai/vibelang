#!/usr/bin/env node
// Brand codemod: Smithers -> VibeLang, applied forward to the current tree.
//
// This is a *rename*, not a revert. It rewrites names inside files and renames
// files and directories so the product, package, CLI, intrinsic specifiers,
// diagnostic codes and source extension all carry the VibeLang identity:
//
//   package        smthrs               -> vibelang
//   subpaths       smthrs/context       -> vibelang/context (and every other subpath)
//   API subpath    smthrs/smithers      -> vibelang/vibe
//   specifiers     smithers:flows       -> vibelang:flows (comptime, exceptions, schema alike)
//   codes          SMITHERS1601         -> VIBE1601
//   constants      SMITHERS_X           -> VIBELANG_X (env vars included)
//   binaries       smithers / smithersc / smithers-tsserver -> vibe / vibec / vtsserver
//   extension      .sm / .smx           -> .vibe / .vibex
//   identifiers    Smithers* / smithers* -> VibeLang* / vibelang*
//   domain         docs.smithers.sh     -> vibelang.sh
//
// The GitHub organisation `smithersai` is deliberately left alone: the org, and the
// pinned TypeScript fork `smithersai/TypeScript`, keep their names. The repository
// path `smithersai/smithers` becomes `smithersai/vibelang`, which is this repo's
// actual remote.
//
// The script is idempotent: a second run finds nothing to change and exits 0. That
// is the point — a concurrent lane that reintroduces an old spelling can re-run it.
// Generated output (dist/, poc/dist/, docs/dist/) is excluded and must be rebuilt.
//
//   node scripts/rename-to-vibelang.mjs --dry-run   # report, write nothing
//   node scripts/rename-to-vibelang.mjs             # apply
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, sep } from "node:path";

const root = process.cwd();
const dryRun = process.argv.includes("--dry-run");
const verbose = process.argv.includes("--verbose");

const EXCLUDED_DIRECTORIES = new Set(["node_modules", "dist", ".git", ".jj", "vendor", "coverage", ".cache"]);
// Files that legitimately contain the old spellings: this script, the gate that
// enforces the rename, and the changelog entry that records it.
const EXEMPT_FILES = new Set(["scripts/rename-to-vibelang.mjs", "scripts/brand-gate.mjs", "CHANGELOG.md", "test/brand-gate.test.mjs"]);
// A line that mentions a retired spelling on purpose carries this marker (the brand
// gate honours it too); the codemod leaves such lines exactly as written.
const ALLOW_MARKER = "brand-gate: allow";
const ALLOW_START = "brand-gate: allow-start";
const ALLOW_END = "brand-gate: allow-end";
const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".woff", ".woff2", ".ttf", ".otf",
  ".bundle", ".zip", ".gz", ".tgz", ".wasm", ".pdf", ".mp4", ".sqlite", ".db", ".node",
]);

/** Ordered: specific spellings first, generic brand words last. */
const RULES = [
  // The repository path `smithersai/smithers` is NOT rewritten: this repo's own
  // remote was renamed in the first pass, and every later mention names the
  // Smithers product (the owner's durable execution library). Likewise `@smthrs/`.
  // Domains.
  [/docs\.smithers\.sh/g, "vibelang.sh"],
  [/\bsmithers\.sh\b/g, "vibelang.sh"],
  // Binaries and their files.
  [/smithers-tsserver/g, "vtsserver"],
  [/smithersc-go/g, "vibec-go"],
  [/smithersc/g, "vibec"],
  [/bin\/smithers\.js/g, "bin/vibe.js"],
  [/\.bin\/smithers\b/g, ".bin/vibe"],
  [/\b(npx|bunx|pnpm exec|pnpm dlx|yarn) smithers\b/g, "$1 vibe"],
  [/\bsmithers (check|compile|run|test|inspect|plan|build|format|lsp|doctor|init|skills|mcp|completions|--[a-z])/g, "vibe $1"],
  [/`smithers`/g, "`vibe`"],
  // The programmatic compiler API subpath keeps its historical short name.
  [/smthrs\/smithers\b/g, "vibelang/vibe"],
  [/"\.\/smithers"/g, "\"./vibe\""],
  [/dist\/smithers\.(js|d\.ts)/g, "dist/vibe.$1"],
  [/src\/smithers\.ts/g, "src/vibe.ts"],
  // Package name and compiler-owned specifiers.
  [/(?<!@)smthrs/g, "vibelang"],
  [/\bsmithers:(?=[a-z])/g, "vibelang:"],
  [/@smithersEffects/g, "@vibelangEffects"],
  // Diagnostic codes and constants.
  [/SMITHERS_/g, "VIBELANG_"],
  [/SMITHERS/g, "VIBE"],
  // Brand words. `smithersai` (the GitHub org) is protected.
  [/Smithers/g, "VibeLang"],
  [/smithers(?!ai\b)/g, "vibelang"],
  // Source extension.
  [/\.smx\b/g, ".vibex"],
  [/\.sm\b/g, ".vibe"],
];

function rewriteLine(line) {
  let output = line;
  for (const [pattern, replacement] of RULES) output = output.replace(pattern, replacement);
  return output;
}

function rewrite(text) {
  let allowed = false;
  return text.split("\n").map((line) => {
    if (line.includes(ALLOW_START)) { allowed = true; return line; }
    if (line.includes(ALLOW_END)) { allowed = false; return line; }
    return allowed || line.includes(ALLOW_MARKER) ? line : rewriteLine(line);
  }).join("\n");
}

function walk(directory, files) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRECTORIES.has(entry.name)) continue;
      walk(path, files);
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

const files = walk(root, []).sort();
let rewrittenFiles = 0;
let renamedFiles = 0;
let replacedOccurrences = 0;
const touchedDirectories = new Set();

for (const path of files) {
  const rel = relative(root, path).split(sep).join("/");
  if (EXEMPT_FILES.has(rel)) continue;
  const binary = BINARY_EXTENSIONS.has(extname(path).toLowerCase());

  if (!binary) {
    const before = readFileSync(path, "utf8");
    const after = rewrite(before);
    if (after !== before) {
      // Count occurrences by diffing against a version with every rule applied once more.
      let count = 0;
      for (const [pattern] of RULES) count += (before.match(pattern) ?? []).length;
      replacedOccurrences += count;
      rewrittenFiles += 1;
      if (verbose) process.stdout.write(`rewrite ${rel} (${count})\n`);
      if (!dryRun) writeFileSync(path, after);
    }
  }

  const newRel = rewriteLine(rel);
  if (newRel !== rel) {
    renamedFiles += 1;
    if (verbose) process.stdout.write(`rename  ${rel} -> ${newRel}\n`);
    if (!dryRun) {
      const target = join(root, ...newRel.split("/"));
      if (existsSync(target)) throw new Error(`rename target already exists: ${newRel}`);
      mkdirSync(dirname(target), { recursive: true });
      renameSync(path, target);
      touchedDirectories.add(dirname(path));
    }
  }
}

// Remove directories the renames emptied (deepest first).
if (!dryRun) {
  for (const directory of [...touchedDirectories].sort((a, b) => b.length - a.length)) {
    let current = directory;
    while (current !== root && existsSync(current) && readdirSync(current).length === 0) {
      rmdirSync(current);
      current = dirname(current);
    }
  }
}

process.stdout.write(
  `${dryRun ? "[dry-run] " : ""}rename-to-vibelang: ${rewrittenFiles} files rewritten ` +
    `(${replacedOccurrences} occurrences), ${renamedFiles} files renamed\n`,
);
