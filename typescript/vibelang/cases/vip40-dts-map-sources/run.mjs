// The emitted layout, the body's declaration file and its source maps.
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { Effect } from "effect"

const dir = new URL("./", import.meta.url)
const out = new URL("./out/", dir)
const text = (name) => readFileSync(new URL(name, out), "utf8")
const js = readdirSync(out).filter((name) => /\.js$/.test(name)).sort()
console.log("js " + JSON.stringify(js))
console.log("main imports body " + text("main.js").includes('"./main.vibe.parse.js"'))
const { main } = await import(new URL("main.js", out))
console.log("result " + await Effect.runPromise(main()))

const dts = text("main.vibe.parse.d.ts")
console.log("d.ts throws " + /@throws \{RangeError\} when the text is not a port/.test(dts))
console.log("d.ts port " + /export declare function port\(raw: string\): number;/.test(dts))

// Decode the first segment of each generated line (base64 VLQ).
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
function firstSegments(mappings) {
  const lines = []
  let source = 0, line = 0, column = 0
  for (const generated of mappings.split(";")) {
    const segments = generated.split(",").filter(Boolean)
    let first
    for (const segment of segments) {
      const values = []
      let value = 0, shift = 0
      for (const char of segment) {
        const digit = alphabet.indexOf(char)
        value += (digit & 31) << shift
        if (digit & 32) shift += 5
        else { values.push(value & 1 ? -(value >> 1) : value >> 1); value = 0; shift = 0 }
      }
      if (values.length >= 4) {
        source += values[1]; line += values[2]; column += values[3]
        first ??= { line, column }
      }
    }
    lines.push(first)
  }
  return lines
}
const source = readFileSync(new URL("main.vibe", dir), "utf8")
const sourceLines = source.split("\n")
for (const name of ["main.vibe.parse.js.map", "main.vibe.parse.d.ts.map"]) {
  const map = JSON.parse(text(name))
  const generated = text(name.slice(0, -4)).split("\n")
  const at = generated.findIndex((line) => /function port\(/.test(line))
  const mapped = firstSegments(map.mappings)[at]
  const want = sourceLines.findIndex((line) => line.includes("export function port("))
  console.log(name + " sources " + JSON.stringify(map.sources.map((s) => s.split("/").pop())) +
    " full sourcesContent " + (map.sourcesContent?.[0] === source) +
    " port line " + (mapped?.line === want) + " column " + (mapped?.column === sourceLines[want].indexOf("export")))
}
