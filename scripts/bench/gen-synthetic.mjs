#!/usr/bin/env node
// Writes two equivalent synthetic projects for compiler benchmarks: N VibeLang
// modules and the same N modules in Effect 4 TypeScript. Each module declares
// two errors, a schema, a service and its layer, a plain helper, and four
// functions that call into the previous module, catch with `match`, fork and
// join two fibers, provide the layer, and pipe the result.
//
//   node scripts/bench/gen-synthetic.mjs <out-dir> [modules=200] [shape=chain]
//
// Shapes: "chain" (each module's run provides its own layer and calls the
// previous module's self-contained run, so contracts stay small), "dense"
// (each module's step also loads from the four previous modules' services, so
// requirement and error unions grow with depth), and "single" (all modules
// concatenated into one file, for per-file passes).
//
// <out-dir>/vibelang and <out-dir>/effect-ts each get package.json,
// tsconfig.json, and src/. Resolve `effect` and `vibelang-runtime` from a
// node_modules directory in <out-dir> or above it.
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"

const out = path.resolve(process.argv[2] ?? "")
const count = Number(process.argv[3] ?? 200)
const shape = process.argv[4] ?? "chain"
if (!process.argv[2] || !Number.isInteger(count) || count < 1 || !["chain", "dense", "single"].includes(shape)) {
  console.error("usage: gen-synthetic.mjs <out-dir> [modules=200] [chain|dense|single]")
  process.exit(2)
}
const fanIn = shape === "dense" ? 4 : 0
const back = (i) => Array.from({ length: Math.min(fanIn, i) }, (_, k) => i - 1 - k)

const tick = "`"
const key = `${tick}k\${n}${tick}`

function moduleImports(i, extension) {
  if (shape === "single") return ""
  const imports = []
  if (i > 0) {
    const prev = i - 1
    const names = ["run" + prev, "plain" + prev]
    if (fanIn) names.push("deep" + prev)
    imports.push(`import { ${names.join(", ")} } from "./m${prev}${extension}"\n`)
  }
  for (const j of back(i)) imports.push(`import { load${j} } from "./m${j}${extension}"\n`)
  return imports.join("")
}

function vibelangModule(i) {
  const prev = i - 1
  const imports = moduleImports(i, ".vibe") + (shape !== "single" && i > 0 ? "\n" : "")
  const a = i > 0 ? `n > 0 ? run${prev}() + plain${prev}(n) : 0` : "0"
  const extra = back(i).map((j) => ` + load${j}(${key})`).join("") + (fanIn && i > 0 ? ` + deep${prev}(n)` : "")
  return `${imports}export error Missing${i} { id: string }
export error Busy${i}

export interface Item${i} { id: string; value: number }

export schema Rec${i} {
  id: string
  count: number
  tag?: "a" | "b"
}

export service Store${i} {
  get(id: string): Item${i}!Missing${i}
  size: number
}

export const Store${i}Live = Layer.effect(Store${i}) {
  const items = new Map<string, Item${i}>([["k1", { id: "k1", value: ${i} }]])
  return {
    get(id) {
      const item = items.get(id)
      if (item === undefined) throw new Missing${i}({ id })
      return item
    },
    size: 1
  }
}

export function plain${i}(x: number) {
  return x * 2 + ${i}
}

export function load${i}(id: string) {
  const item = Store${i}.get(id)
  return item.value + 1
}

export function step${i}(n: number) {
  const a = ${a}
  try {
    return load${i}(${key}) + a
  } catch (e) {
    return match (e) {
      when Missing${i}: a;
    }
  }
}

export function deep${i}(n: number) {
  return step${i}(n)${extra}
}

export function fanout${i}(n: number) {
  const left = fork step${i}(n)
  const right = fork step${i}(n + 1)
  return left.join() + right.join()
}

export function run${i}(): number!! {
  provide Store${i}Live {
    return fanout${i}(3) |> % * 2
  }
}
`
}

function effectModule(i) {
  const prev = i - 1
  const imports = moduleImports(i, ".ts")
  const a = i > 0 ? `n > 0 ? (yield* run${prev}()) + plain${prev}(n) : 0` : "0"
  const extra = back(i).map((j) => ` + (yield* load${j}(${key}))`).join("") + (fanIn && i > 0 ? ` + (yield* deep${prev}(n))` : "")
  return `${shape === "single" && i > 0 ? "" : 'import { Context, Data, Effect, Fiber, Layer, Schema } from "effect"\n'}${imports}
export class Missing${i} extends Data.TaggedError("Missing${i}")<{ readonly id: string }> {}
export class Busy${i} extends Data.TaggedError("Busy${i}") {}

export interface Item${i} { readonly id: string; readonly value: number }

export const Rec${i} = Schema.Struct({
  id: Schema.String,
  count: Schema.Number,
  tag: Schema.optional(Schema.Literals(["a", "b"]))
})
export interface Rec${i} extends Schema.Schema.Type<typeof Rec${i}> {}

export class Store${i} extends Context.Service<Store${i}, {
  get(id: string): Effect.Effect<Item${i}, Missing${i}>
  readonly size: number
}>()("Store${i}") {}

export const Store${i}Live = Layer.effect(Store${i}, Effect.sync(() => {
  const items = new Map<string, Item${i}>([["k1", { id: "k1", value: ${i} }]])
  return Store${i}.of({
    get: (id) => Effect.suspend(() => {
      const item = items.get(id)
      return item === undefined ? Effect.fail(new Missing${i}({ id })) : Effect.succeed(item)
    }),
    size: 1
  })
}))

export function plain${i}(x: number) {
  return x * 2 + ${i}
}

export const load${i} = Effect.fnUntraced(function* (id: string) {
  const store = yield* Store${i}
  const item = yield* store.get(id)
  return item.value + 1
})

export const step${i} = Effect.fnUntraced(function* (n: number) {
  const a = ${a}
  return yield* load${i}(${key}).pipe(
    Effect.map((v) => v + a),
    Effect.catchTag("Missing${i}", () => Effect.succeed(a))
  )
})

export const deep${i} = Effect.fnUntraced(function* (n: number) {
  return (yield* step${i}(n))${extra}
})

export const fanout${i} = Effect.fnUntraced(function* (n: number) {
  const left = yield* Effect.forkChild(step${i}(n))
  const right = yield* Effect.forkChild(step${i}(n + 1))
  return (yield* Fiber.join(left)) + (yield* Fiber.join(right))
})

export const run${i} = (): Effect.Effect<number> =>
  fanout${i}(3).pipe(Effect.map((x) => x * 2), Effect.provide(Store${i}Live))
`
}

function project(dir, ext, module, main) {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(path.join(dir, "src"), { recursive: true })
  writeFileSync(path.join(dir, "package.json"), '{"type":"module","private":true}\n')
  writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true,
      rootDir: "src", outDir: "dist", rewriteRelativeImportExtensions: true, skipLibCheck: true, types: []
    },
    include: [`src/**/*${ext}`]
  }, null, 2) + "\n")
  if (shape === "single") {
    writeFileSync(path.join(dir, "src", `all${ext}`), Array.from({ length: count }, (_, i) => module(i)).join("\n"))
    return
  }
  for (let i = 0; i < count; i++) writeFileSync(path.join(dir, "src", `m${i}${ext}`), module(i))
  writeFileSync(path.join(dir, "src", `main${ext}`), main)
}

project(path.join(out, "vibelang"), ".vibe", vibelangModule,
  `import { run${count - 1} } from "./m${count - 1}.vibe"\n\nexport function main() {\n  log(run${count - 1}())\n}\n`)
project(path.join(out, "effect-ts"), ".ts", effectModule,
  `import { Effect } from "effect"\nimport { run${count - 1} } from "./m${count - 1}.ts"\n\nexport const main = Effect.flatMap(run${count - 1}(), (n) => Effect.log(n))\n`)
console.log(`wrote ${count} modules to ${out}/vibelang and ${out}/effect-ts`)
