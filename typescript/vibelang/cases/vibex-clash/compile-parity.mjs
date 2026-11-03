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
  fs.writeFileSync(fixture, `declare global { namespace JSX { interface IntrinsicElements { [tag: string]: any } } }
declare const render: any;
` + fs.readFileSync(path.join(dir, "r36.vibex"), "utf8"));
  const config = path.join(scratch, "tsconfig.json");
  fs.writeFileSync(config, JSON.stringify({ compilerOptions: {
    target: "ESNext", module: "ESNext", moduleResolution: "bundler", jsx: "preserve",
    strict: true, noEmit: true, skipLibCheck: true, types: [],
  }, files: [fixture] }));
  const result = spawnSync(compiler, ["--pretty", "false", "-p", config], { encoding: "utf8", timeout: 60000 });
  if (result.error || result.signal) throw result.error ?? new Error(result.signal);
  if (result.status === 0 || !/error EK1101:/.test(result.stdout + result.stderr)) {
    throw new Error("row 36 must reject legacy trailing blocks with EK1101: " + result.stdout + result.stderr);
  }
  console.log("TypeScript " + ts.version + ": " + count + " full compiler controls passed; row 36 rejected with EK1101");
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
