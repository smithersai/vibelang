import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { pathToFileURL } from "node:url"
import { createShimmedProject, runNode, runTsc, skipReason } from "./_helpers.mjs"

test("mixed .ts, // @vibe .ts, and .vibe files typecheck, emit, and execute together", { skip: skipReason }, (t) => {
  const root = createShimmedProject(t, {
    "src/plain.ts": "/** @throws {never} */\nexport function formatTag(label: string): string { return `[${label}]` }\n",
    "src/domain.vibe": `import { formatTag } from "./plain.js"
export error InvalidId { id: string }
export effect function loadItem(id: string) {
  if (id.length === 0) throw new InvalidId({ id })
  return formatTag(id)
}
`,
    "src/service.ts": `// @vibe
import { loadItem } from "./domain.vibe"
export effect function loadSafe(id: string) {
  return loadItem(id) catch () => "[fallback]"
}
`,
    "src/entry.ts": `import { Effect } from "effect"
import { loadSafe } from "./service.js"
export const main = () => Effect.runPromise(Effect.all([loadSafe("42"), loadSafe("")]))
`,
  }, {
    compilerOptions: { allowImportingTsExtensions: true, rewriteRelativeImportExtensions: true },
  })

  const build = runTsc(root)
  assert.equal(build.status, 0, build.stdout + build.stderr)
  for (const rel of ["out/plain.js", "out/domain.js", "out/service.js", "out/entry.js", "out/service.d.ts"]) {
    assert.equal(existsSync(join(root, rel)), true, `missing emitted file ${rel}`)
  }

  const exec = runNode(root, [
    "--input-type=module",
    "-e",
    `import { main } from ${JSON.stringify(pathToFileURL(join(root, "out/entry.js")).href)}
     console.log(JSON.stringify(await main()))`,
  ])
  assert.equal(exec.status, 0, exec.stderr)
  assert.deepEqual(JSON.parse(exec.stdout), ["[42]", "[fallback]"])
})

test("type errors across .vibe and plain .ts boundaries report TS2322 with exit status 2", { skip: skipReason }, (t) => {
  const root = createShimmedProject(t, {
    "src/domain.vibe": "export effect function count(): number { return 7 }\n",
    "src/consumer.ts": `import { Effect } from "effect"
import { count } from "./domain.vibe"
export const bad: Effect.Effect<string> = count()
`,
  }, {
    compilerOptions: { allowImportingTsExtensions: true, noEmit: true },
  })

  const check = runTsc(root, ["--noEmit", "--pretty", "false"])
  assert.equal(check.status, 2)
  assert.match(check.stdout, /consumer\.ts\(3,14\): error TS2322/)
})

test("unhandled Vibe errors in // @vibe .ts preserve error channels in emitted declarations", { skip: skipReason }, (t) => {
  const root = createShimmedProject(t, {
    "src/risky.ts": `// @vibe
export error Boom { code: number }
export effect function failIfZero(n: number) {
  if (n === 0) throw new Boom({ code: 500 })
  return n
}
`,
    "src/caller.ts": `import { Effect } from "effect"
import { failIfZero } from "./risky.js"
// Must reject assigning an Effect<number, Boom> to Effect<number, never>.
export const wrong: Effect.Effect<number, never> = failIfZero(0)
`,
  })

  const check = runTsc(root, ["--noEmit", "--pretty", "false"])
  assert.equal(check.status, 2)
  assert.match(check.stdout, /caller\.ts\(4,14\): error TS2322/)
  assert.match(check.stdout, /Boom/)
})

test("JSX in // @vibe .tsx compiles alongside Vibe match and effect syntax", { skip: skipReason }, (t) => {
  const root = createShimmedProject(t, {
    "src/jsx.d.ts": `declare namespace JSX {
  type Element = { tag: string; children?: unknown }
  interface IntrinsicElements { div: { children?: unknown } }
}
declare function h(tag: string, props: unknown, ...children: unknown[]): JSX.Element
`,
    "src/view.tsx": `// @vibe
export data State {
  Idle
  Ready { label: string }
}

export function render(state: State) {
  const text = match (state) {
    when { _tag: "Idle" }: "waiting";
    when { _tag: "Ready", let label }: label;
  }
  return <div>{text}</div>
}
`,
  }, {
    compilerOptions: { jsx: "react", jsxFactory: "h" },
  })

  const build = runTsc(root)
  assert.equal(build.status, 0, build.stdout + build.stderr)
  assert.equal(existsSync(join(root, "out/view.js")), true)
})
