#!/usr/bin/env node
import assert from "node:assert/strict"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { runSuite } from "../lib/harness.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
process.env.VIBELANG_BINARY ??= path.join(root, "packages/compiler/native/vibelang")

const { parseForESLint } = await import(path.join(root, "packages/compiler/eslint.mjs"))
const { formatSource } = await import(path.join(root, "packages/compiler/format.mjs"))

function makeVibe(modules, jsx = false) {
  const parts = []
  for (let i = 0; i < modules; i++) {
    parts.push(`export error Missing${i} { id: string }

export schema Rec${i} {
  id: string
  count: number
  tag?: "a" | "b"
}

export service Store${i} {
  get(id: string): number!Missing${i}
  size: number
}

export effect function load${i}(id: string): number!!Store${i} {
  const store = try Store${i}
  return (store.get(id) |> Effect.map(%, (v) => v + 1)) catch (e) => match (e) {
    when Missing${i}: 0;
  }
}`)
    if (jsx) {
      parts.push(`export function View${i}(props: { n: number }) { return <div><span>{props.n}</span></div> }`)
    }
  }
  return parts.join("\n\n") + "\n"
}

const smallVibe = makeVibe(1)
const mediumVibe = makeVibe(12)
const mediumVibex = makeVibe(10, true)

const eslintDir = path.join(root, "packages/compiler/test/eslint")

await runSuite({
  suite: "compiler-tools",
  category: "packages",
  description: "End-to-end JS compiler tool adapters: packages/compiler/eslint.mjs (parseForESLint) and format.mjs (formatSource).",
  cases: [
    {
      name: "eslint.parseForESLint (1-mod .vibe)",
      samples: 7,
      warmup: 2,
      minSampleMs: 50,
      fn: () => parseForESLint(smallVibe, { filePath: path.join(eslintDir, "small.vibe") }),
      verify: (r) => assert.equal(r.ast.type, "Program")
    },
    {
      name: "eslint.parseForESLint (12-mod .vibe)",
      samples: 7,
      warmup: 2,
      minSampleMs: 50,
      fn: () => parseForESLint(mediumVibe, { filePath: path.join(eslintDir, "medium.vibe") }),
      verify: (r) => assert.equal(r.ast.type, "Program")
    },
    {
      name: "eslint.parseForESLint (10-mod .vibex)",
      samples: 7,
      warmup: 2,
      minSampleMs: 50,
      fn: () => parseForESLint(mediumVibex, { filePath: path.join(eslintDir, "medium.vibex") }),
      verify: (r) => assert.equal(r.ast.type, "Program")
    },
    {
      name: "format.formatSource (1-mod .vibe)",
      samples: 5,
      warmup: 1,
      batch: 1,
      fn: () => formatSource(smallVibe, "small.vibe"),
      verify: (r) => assert.ok(r.includes("export error Missing0"))
    },
    {
      name: "format.formatSource (12-mod .vibe)",
      samples: 5,
      warmup: 1,
      batch: 1,
      fn: () => formatSource(mediumVibe, "medium.vibe"),
      verify: (r) => assert.ok(r.includes("export error Missing11"))
    }
  ]
})
