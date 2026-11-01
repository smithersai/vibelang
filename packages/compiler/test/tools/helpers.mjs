// A scratch project for the tool adapter tests: this checkout's vibelang
// package, effect, and the pinned tools installed beside the test.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = fileURLToPath(new URL(".", import.meta.url))
export const compilerPackage = fileURLToPath(new URL("../../", import.meta.url))
export const tools = join(here, "node_modules")
const effect = join(process.env.EFFECT_NODE_MODULES ?? fileURLToPath(new URL("../../../../experiments/node_modules", import.meta.url)), "effect")

export const tsconfig = JSON.stringify({
  compilerOptions: {
    target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, jsx: "react-jsx",
    skipLibCheck: true, allowImportingTsExtensions: true, noEmit: true, types: []
  },
  include: ["src"]
})

/** Writes `files` under a new directory whose node_modules links vibelang, effect and `linked` tools. */
export function project(t, files, linked = []) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-tools-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const modules = join(root, "node_modules")
  mkdirSync(join(modules, "@types"), { recursive: true })
  symlinkSync(compilerPackage, join(modules, "vibelang"))
  symlinkSync(realpathSync(effect), join(modules, "effect"))
  for (const name of linked) symlinkSync(join(tools, name), join(modules, name))
  for (const [path, text] of Object.entries({ "package.json": '{"name":"app","private":true}', "tsconfig.json": tsconfig, ...files })) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  process.env.VIBELANG_CACHE_DIR = join(root, ".vibelang-cache")
  return root
}

// Hooks with and without a React Compiler violation. The types before each
// body shift the emitted JavaScript's lines away from the source's.
export const hooks = {
  "src/useLabel.vibe": `import { useState } from "react"

interface Label {
  readonly value: number
  readonly text: string
}

export function useLabel(n: number): Label {
  const [x] = useState(n)
  return { value: x * 2, text: "n=" + String(x) }
}
`,
  "src/useLatest.vibe": `import { useRef } from "react"

type Box = {
  readonly current: number
}

export function useLatest(value: number): number {
  const ref = useRef(value)
  return ref.current
}
`
}
/** The line of useLatest.vibe that reads the ref during render. */
export const refReadLine = 9
