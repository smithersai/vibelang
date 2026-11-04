// Live stock-parser receipts and full .tsx CLI diagnostic controls.
import "./stock-parity.mjs";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const ts = require("../../../../docs/tools/node_modules/typescript");
if (ts.version !== "5.9.3") throw new Error("TypeScript 5.9.3 required");
const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, "../../../..");
const compiler = process.env.VIBEX_ORACLE_COMPILER ?? path.join(root, "typescript/built/local/tsc");
const cache = path.join(root, ".cache");
fs.mkdirSync(cache, { recursive: true });
const scratch = fs.mkdtempSync(path.join(cache, "vibex-controls-"));
let count = 0;
try {
  for (const name of fs.readdirSync(dir).filter(n => n.endsWith(".tsx"))) {
    const source = path.join(dir, name);
    const config = path.join(scratch, "tsconfig.json");
    fs.writeFileSync(config, JSON.stringify({ compilerOptions: {
      target: "ESNext", module: "ESNext", jsx: "preserve", strict: true,
      skipLibCheck: true, noEmit: true, types: [],
    }, files: [source] }));
    const stock = spawnSync(process.execPath, [path.join(root, "docs/tools/node_modules/typescript/lib/tsc.js"), "--pretty", "false", "-p", config], { encoding: "utf8", timeout: 60000 });
    if (stock.error || stock.signal) throw stock.error ?? new Error(stock.signal);
    const expected = [...((stock.stdout + stock.stderr).matchAll(/error ((?:TS|EK)\d+):/g))].map(m => m[1]).sort();
    if (stock.status !== 0 && expected.length === 0) throw new Error(stock.stdout + stock.stderr);
    const result = spawnSync(compiler, ["--pretty", "false", "-p", config], { encoding: "utf8", timeout: 60000 });
    if (result.error || result.signal) throw result.error ?? new Error(result.signal);
    const actual = [...((result.stdout + result.stderr).matchAll(/error ((?:TS|EK)\d+):/g))].map(m => m[1]).sort();
    if (result.status !== 0 && actual.length === 0) throw new Error(result.stdout + result.stderr);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(name + ": stock=" + JSON.stringify(expected) + " fork=" + JSON.stringify(actual));
    count++;
  }
  const fixture = path.join(scratch, "legacy.vibex");
  const twin = path.join(scratch, "legacy.tsx");
  const source = fs.readFileSync(path.join(dir, "r36.vibex"), "utf8");
  fs.writeFileSync(fixture, source);
  fs.writeFileSync(twin, source);
  const diagnostics = (executable, args, file) => {
    const config = path.join(scratch, "tsconfig.json");
    fs.writeFileSync(config, JSON.stringify({ compilerOptions: {
      target: "ESNext", module: "ESNext", moduleResolution: "bundler", jsx: "preserve",
      strict: true, noEmit: true, skipLibCheck: true, types: [],
    }, files: [file] }));
    const result = spawnSync(executable, [...args, "--pretty", "false", "-p", config], { encoding: "utf8", timeout: 60000 });
    if (result.error || result.signal) throw result.error ?? new Error(result.signal);
    const rows = [...(result.stdout + result.stderr).matchAll(/\((\d+),(\d+)\): error ((?:TS|EK)\d+): (.*)/g)]
      .map(m => [m[1], m[2], m[3], m[4]]);
    if (result.status === 0 || rows.length === 0) throw new Error("row 36 must fail with native syntax diagnostics: " + result.stdout + result.stderr);
    return rows;
  };
  const expected = diagnostics(process.execPath, [path.join(root, "docs/tools/node_modules/typescript/lib/tsc.js")], twin);
  const actual = diagnostics(compiler, [], fixture);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("row 36: stock=" + JSON.stringify(expected) + " vibex=" + JSON.stringify(actual));
  console.log("TypeScript " + ts.version + ": " + count + " full compiler controls passed; row 36 matches native TSX diagnostics");
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
