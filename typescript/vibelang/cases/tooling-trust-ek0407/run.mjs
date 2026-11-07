// Chapter 7, Empty legacy trust wrappers: EK0407 reports each resolved
// vibelang-runtime trusted(f, []) wrapper and names vibelang --fix (VIP-4).
// A local function named trusted and a listed-failure wrapper are not it.
import assert from "node:assert/strict"
import { project, baseOptions } from "../_tooling-witness.mjs"

const runtime = `import { trusted } from "vibelang-runtime"\n`
const resolved = {
  "arrow.vibe": runtime + `const safe = trusted((n: number) => n * 2, [])\nexport effect function f(): number!! { return safe(2) }\n`,
  "native.vibe": runtime + `const safe = trusted(Math.max, [])\nexport effect function f(): number!! { return safe(1, 2) }\n`,
  "exported.vibe": runtime + `export const safe = trusted(Math.max, [])\n`,
  "renamed.vibe": `import { trusted as legacy } from "vibelang-runtime"\nconst safe = legacy(Math.max, [])\nexport effect function f(): number!! { return safe(1, 2) }\n`,
}
const unrelated = {
  "local.vibe": `function trusted<F>(f: F, classes: readonly unknown[]): F { return f }\nconst safe = trusted(Math.max, [])\nexport effect function f(): number!! { return safe(1, 2) }\n`,
  "listed.vibe": runtime + `const safe = trusted(Math.max, [Error])\nexport effect function f(): number!Error { return safe(1, 2) }\n`,
}
project(({ put, invoke }) => {
  const files = { ...resolved, ...unrelated }
  put("tsconfig.json", { compilerOptions: { ...baseOptions(), noEmit: true }, files: Object.keys(files) })
  for (const [file, text] of Object.entries(files)) put(file, text)
  const text = invoke("-p", ".", "--pretty", "false").text
  const found = [...text.matchAll(/^(\S+)\((\d+),\d+\): error EK0407: (.*)$/gm)]
  assert.deepEqual(found.map(m => m[1] + ":" + m[2]), Object.keys(resolved).map(f => f + ":2"), "one EK0407 per resolved trusted(f, []):\n" + text)
  for (const m of found) assert.match(m[3], /vibelang --fix/, "EK0407 names vibelang --fix")
})
console.log("EK0407 reports resolved trusted(f, []) wrappers only")
