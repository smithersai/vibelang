import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { checkSyntaxTwin } from "../../test/census-vibex.mjs"
import { Component, rendered } from "./out/main.js"
checkSyntaxTwin(import.meta.url)
const expected = await import("./reference/out/main.js")
assert.deepEqual(rendered, { tag: "span", children: ["plain"] })
assert.deepEqual(Component({ label: "direct" }), expected.Component({ label: "direct" }))
assert.deepEqual(rendered, expected.rendered)
const declaration = name => readFileSync(new URL(name, import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").trim()
assert.equal(declaration("out/main.d.ts"), declaration("reference/out/main.d.ts"))
assert.ok(!declaration("out/main.d.ts").includes("Effect"))
console.log("plain JSX component PASS")
