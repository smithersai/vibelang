import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { pathToFileURL } from "node:url"
import { test } from "node:test"

test("the Babel configuration loads in the documented ESM project", () => {
 const page = readFileSync(new URL("../user/src/setup/react-native.md", import.meta.url), "utf8")
 const block = [...page.matchAll(/\x60{3}js\n([\s\S]*?)\n\x60{3}/g)].map(match => match[1])
   .find(source => source.includes("babel-preset-expo"))
 assert.ok(block)
 const name = /^\/\/ (babel\.config\.[a-z]+)$/m.exec(block)?.[1]
 assert.ok(name)
 const project = mkdtempSync(join(tmpdir(), "metro-babel-config-"))
 try {
  writeFileSync(join(project, "package.json"), '{"type":"module"}')
  writeFileSync(join(project, name), block)
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
   import assert from "node:assert/strict";
   const { default: configure } = await import(process.argv[1]);
   let cached = false;
   const config = configure({ cache(value) { cached = value === true } });
   assert.equal(cached, true);
   assert.deepEqual(config.presets, ["babel-preset-expo", "vibelang/babel"]);
  `, pathToFileURL(join(project, name)).href], { encoding: "utf8" })
  assert.equal(result.status, 0, result.stdout + result.stderr)
 } finally { rmSync(project, { recursive: true, force: true }) }
})
