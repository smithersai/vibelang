import assert from "node:assert/strict";
import fs from "node:fs";
for (const stem of ["main", "plain"]) {
  assert.ok(fs.existsSync("out/" + stem + ".jsx"), stem + " must emit .jsx");
  assert.ok(!fs.existsSync("out/" + stem + ".js"), stem + " must not emit .js");
  const map = JSON.parse(fs.readFileSync("out/" + stem + ".jsx.map", "utf8"));
  assert.equal(map.file, stem + ".jsx");
  assert.ok(map.sources.some(source => source.endsWith(stem + ".vibex")));
  assert.ok(fs.existsSync("out/" + stem + ".d.ts"));
  assert.ok(fs.existsSync("out/" + stem + ".d.ts.map"));
}
assert.match(fs.readFileSync("out/main.jsx", "utf8"), /<div\s*\/>/);
console.log("preserved JSX output suffixes and maps");
