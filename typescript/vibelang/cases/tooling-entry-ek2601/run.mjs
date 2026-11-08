// Chapter 7, Legacy entry-dispatch migration: EK2601 rejects each retired
// platform side-effect marker, with or without an exported main, with the
// chapter's exact message. A module without a marker gets no EK2601.
import assert from "node:assert/strict"
import { project, baseOptions } from "../_tooling-witness.mjs"

const message = "legacy platform entry marker: write an explicit runner"
const files = {}
for (const platform of ["node", "bun", "browser"]) {
  files[platform + "-bare.vibe"] = `import "vibelang/platform/${platform}"\nexport const value = 1\n`
  files[platform + "-main.vibe"] = `export const before = 0\nimport "vibelang/platform/${platform}"\nexport effect function main() { try Console.log("start") }\n`
}
const unmarked = { "plain-main.vibe": `export effect function main() { try Console.log("start") }\n`, "plain.vibe": `export const value = 1\n` }
project(({ put, invoke }) => {
  const all = { ...files, ...unmarked }
  put("tsconfig.json", { compilerOptions: { ...baseOptions(), noEmit: true }, files: Object.keys(all) })
  for (const [file, text] of Object.entries(all)) put(file, text)
  const text = invoke("-p", ".", "--pretty", "false").text
  const found = [...text.matchAll(/^(\S+)\((\d+),\d+\): (\w+) EK2601: (.*)$/gm)].map(m => `${m[1]}:${m[2]} ${m[3]} ${m[4]}`)
  const want = Object.entries(files).map(([file, text]) => `${file}:${text.split("\n").findIndex(l => l.startsWith("import")) + 1} error ${message}`)
  assert.deepEqual(found.sort(), want.sort(), "EK2601 at each marker:\n" + text)
})
console.log("EK2601 rejects every retired platform marker with the exact message")
