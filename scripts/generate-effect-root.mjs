#!/usr/bin/env node
// Regenerate the root inventory from pinned Effect exports and prelude names.
// Preserve the file's ordinary Go definitions above the generated map.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--write")) throw new Error("usage: node scripts/generate-effect-root.mjs [--write]");
const modules = process.env.EFFECT_NODE_MODULES || join(root, "packages/runtime/node_modules");
const effect = join(modules, "effect");
const pin = JSON.parse(readFileSync(join(root, "packages/runtime/package.json"), "utf8")).peerDependencies.effect;
const version = JSON.parse(readFileSync(join(effect, "package.json"), "utf8")).version;
if (version !== pin) throw new Error(`Effect ${version} does not match runtime pin ${pin}`);
const index = readFileSync(join(effect, "dist/index.d.ts"), "utf8").replace(/\/\*\*[\s\S]*?\*\//g, "");
const names = new Map();
for (const match of index.matchAll(/^export \* as (\w+) from "\.\/([A-Za-z/]+)\.ts";/gm)) {
  names.set(match[1], { module: `effect/${match[2]}`, namespace: true });
}
const functions = index.match(/export \{([^}]*)\} from "\.\/Function\.ts"/);
if (!functions) throw new Error("Effect root has no Function export list");
for (const name of functions[1].split(",").map((s) => s.trim()).filter(Boolean)) {
  if (!/^\w+$/.test(name)) throw new Error(`unsupported Effect root function export: ${name}`);
  names.set(name, { module: "effect/Function", namespace: false });
}
const prelude = readFileSync(join(root, "typescript/tsc/internal/vibelang/prelude.go"), "utf8");
const declaration = prelude.match(/var preludeModules = map\[string\]string\{([\s\S]*?)\n\}/);
if (!declaration) throw new Error("missing explicit prelude module declaration");
for (const match of declaration[1].matchAll(/^\s*"([^"]+)"\s*:/gm)) names.delete(match[1]);
if (names.size < 100) throw new Error("unexpectedly small Effect root inventory");
const target = join(root, "typescript/tsc/internal/vibelang/effectroot.go");
const old = readFileSync(target, "utf8");
const marker = "var effectRootNames = map[string]effectRootExport{";
const offset = old.indexOf(marker);
if (offset < 0 || old.indexOf(marker, offset + 1) >= 0) throw new Error("missing or repeated root inventory");
const end = old.indexOf("\n}", offset);
if (end < 0 || old.slice(end + 2).trim()) throw new Error("unexpected definitions below root inventory");
const rows = [...names].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, entry]) =>
  `\t${JSON.stringify(name)}: {module: ${JSON.stringify(entry.module)}${entry.namespace ? ", namespace: true" : ""}},`);
const source = old.slice(0, offset) + marker + "\n" + rows.join("\n") + "\n}\n";
const next = execFileSync("gofmt", [], { input: source, encoding: "utf8" });
if (args.includes("--write")) writeFileSync(target, next);
else if (old !== next) {
  process.stderr.write("Effect root inventory is stale; run node scripts/generate-effect-root.mjs --write\n");
  process.exit(1);
}
process.stdout.write(`Effect root inventory: ${names.size} exports from ${version}\n`);
