import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { pathToFileURL } from "node:url"
import fc from "fast-check"

const inspector = new URL("../bun-export-surface.mjs", import.meta.url).href
const hasBun = spawnSync("bun", ["--version"]).status === 0

function compare(extension, code) {
  const root = mkdtempSync(join(tmpdir(), "vibelang-bun-surface-"))
  try {
    const source = join(root, "source." + extension), marker = join(root, "executed")
    writeFileSync(join(root, "package.json"), '{"type":"module"}')
    writeFileSync(join(root, "leaf.ts"), 'export let value = 1; export { value as default };')
    writeFileSync(join(root, "types.ts"), 'export default interface Value { n: number }')
    const sideEffect = extension === "cjs" || code.includes("module.exports")
      ? 'require("node:fs").writeFileSync(' + JSON.stringify(marker) + ', "ran");\n'
      : 'import { writeFileSync } from "node:fs"; writeFileSync(' + JSON.stringify(marker) + ', "ran");\n'
    writeFileSync(source, sideEffect + code)
    const script = `
import { exportsDefault } from ${JSON.stringify(inspector)};
import { existsSync } from "node:fs";
const source = ${JSON.stringify(source)};
const detected = exportsDefault(source, () => { throw new Error("native source must not compile"); }, f => /\\.[cm]?ts$/.test(f) ? "ts" : "js");
if (existsSync(${JSON.stringify(marker)})) throw new Error("inspection executed source");
const namespace = await import(${JSON.stringify(pathToFileURL(source).href)});
console.log(JSON.stringify([detected, Object.hasOwn(namespace, "default")]));
`
    const result = spawnSync("bun", ["--input-type=module", "-e", script], { encoding: "utf8" })
    assert.equal(result.status, 0, result.stderr)
    const [detected, native] = JSON.parse(result.stdout.trim().split("\n").at(-1))
    assert.equal(detected, native, extension + ": " + code)
    assert.equal(existsSync(marker), true, "the side-effect control must actually run on import")
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("Bun export inspection matches native namespaces without executing source", { skip: !hasBun }, () => {
  for (const [extension, code] of [
    ["ts", 'export type { default } from "./types.ts"; export const value = 1;'],
    ["ts", 'export default interface Value { n: number }'],
    ["ts", 'export * from "./leaf.ts";'],
    ["ts", 'export { default } from "./leaf.ts";'],
    ["js", 'export let value = 1; export { value as default };'],
    ["js", 'export {};'],
    ["js", 'module.exports = { value: 1 };'],
    ["cjs", 'module.exports = { value: 1 };'],
    ["cts", 'export const value = 1;']
  ]) compare(extension, code)
})

test("property: native TypeScript default erasure and aliases match Bun", { skip: !hasBun }, () => {
  fc.assert(fc.property(
    fc.integer({ min: -20, max: 20 }),
    fc.constantFrom("binding", "expression", "type", "none", "star"),
    (n, kind) => {
      const code = `export let value: number = ${n};\n` + {
        binding: "export { value as default };",
        expression: "export default value;",
        type: 'export type { default } from "./types.ts";',
        none: "",
        star: 'export * from "./leaf.ts";'
      }[kind]
      compare("ts", code)
    }
  ), { seed: 160017, numRuns: 40 })
})

test("VibeLang export inspection reads compiled JavaScript only", { skip: !hasBun }, () => {
  const script = `
import { exportsDefault } from ${JSON.stringify(inspector)};
for (const extension of ["vibe", "vibex"]) {
  for (const expected of [false, true]) {
    let calls = 0;
    const detected = exportsDefault("/not-on-disk/source." + extension, file => {
      calls++;
      return { code: "export let value = 1;" + (expected ? "export { value as default };" : "") };
    }, () => { throw new Error("native loader requested"); });
    if (detected !== expected || calls !== 1) throw new Error("wrong emitted surface");
  }
}
`
  const result = spawnSync("bun", ["--input-type=module", "-e", script], { encoding: "utf8" })
  assert.equal(result.status, 0, result.stderr)
})
