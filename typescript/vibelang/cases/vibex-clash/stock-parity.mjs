// Generated receipts keep Go tests independent of Node installs. This runner
// verifies the receipt against the pinned, independent TypeScript parser.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const ts = require("../../../../docs/tools/node_modules/typescript");
if (ts.version !== "5.9.3") throw new Error("Install docs/tools: TypeScript 5.9.3 required");
const dir = path.dirname(fileURLToPath(import.meta.url));
const controls = {};
for (const name of fs.readdirSync(dir).filter(n => n.endsWith(".tsx")).sort()) {
  const source = fs.readFileSync(path.join(dir, name), "utf8");
  const file = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  controls[name] = file.parseDiagnostics.map(d => ({
    code: d.code,
    start: Buffer.byteLength(source.slice(0, d.start)),
    length: Buffer.byteLength(source.slice(d.start, d.start + d.length)),
  }));
}
const actual = { version: ts.version, controls };
const receipt = path.join(dir, "stock-diagnostics.json");
if (process.argv.includes("--write")) fs.writeFileSync(receipt, JSON.stringify(actual, null, 2) + "\n");
else if (JSON.stringify(JSON.parse(fs.readFileSync(receipt, "utf8"))) !== JSON.stringify(actual)) {
  throw new Error("Stock parser receipt differs; run stock-parity.mjs --write and review diagnostic changes");
}
console.log("TypeScript " + ts.version + ": " + Object.keys(controls).length + " parser controls passed");
