import assert from "node:assert/strict"
import fs from "node:fs"
import { result } from "./out/main.js"

assert.deepEqual(result, ["Über", "a_9z", "Z", "$x", "astral", "macron", "decomposed", "escaped", "other.vibe"])
const stems = ["main.vibex.-dc-ber", "main.vibex.a_9z", "main.vibex.-5a-", "main.vibex.-24-x", "main.vibex.-1d4b3-",
  "main.vibex.-101-", "main.vibex.-55--308-ber", "main.vibex.ab", "other.vibe.-dc-ber"]
const suffixes = [".js", ".d.ts", ".js.map", ".d.ts.map"]
const want = stems.flatMap(stem => suffixes.map(suffix => stem + suffix)).sort()
const got = fs.readdirSync(new URL("./out/", import.meta.url)).filter(name => /^(main\.vibex|other\.vibe)\./.test(name)).sort()
assert.deepEqual(got, want)
// JavaScript and declarations name the same stem.
const js = fs.readFileSync(new URL("./out/main.js", import.meta.url), "utf8")
const dts = fs.readFileSync(new URL("./out/main.vibex.-dc-ber.d.ts", import.meta.url), "utf8")
assert.ok(js.includes('"./main.vibex.-dc-ber.js"'), js)
assert.ok(dts.startsWith('export declare const n = "\\u00DCber";'), dts)
console.log(JSON.stringify(stems))
