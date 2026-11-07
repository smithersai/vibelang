// Lookup order for written .vibe and .vibex specifiers, shown by removing the
// winning candidate one at a time. The native .ts/.tsx twin rows run alongside.
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

const binary = process.env.VIBELANG_BINARY
assert.ok(binary, "the harness supplies its built compiler")
const roots = []
const candidate = { "vibe": "App.vibe", "vibex": "App.vibex", "ts": "App.ts", "tsx": "App.tsx", "d.ts": "App.d.ts" }

function resolve(specifier, present, importer = "main.vibe") {
  const root = mkdtempSync(join(tmpdir(), "w02-vibex-order-"))
  roots.push(root)
  writeFileSync(join(root, "package.json"), '{"type":"module"}\n')
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "es2022", module: "nodenext", moduleResolution: "nodenext", strict: true, types: [], lib: ["esnext"],
      skipLibCheck: true, jsx: "preserve", declaration: true, rewriteRelativeImportExtensions: true, outDir: "out"
    },
    files: [importer]
  }))
  for (const kind of present) {
    writeFileSync(join(root, candidate[kind]), kind === "d.ts"
      ? 'export declare const which: "d.ts"\n'
      : `export const which = "${kind}" as const\n`)
  }
  writeFileSync(join(root, importer), `import { which } from "./App.${specifier}"\nexport const w = which\n`)
  const run = spawnSync(binary, ["-p", "tsconfig.json", "--pretty", "false"], { cwd: root, encoding: "utf8", timeout: 120000 })
  const codes = [...run.stdout.matchAll(/\): error ((?:EK|TS)\d+)/g)].map(m => m[1])
  if (codes.length) return codes.join(" ")
  assert.equal(run.status, 0, run.stdout)
  const dts = join(root, importer.replace(/\.\w+$/, ".d.ts").replace(/^/, "out/"))
  assert.ok(existsSync(dts), run.stdout)
  return readFileSync(dts, "utf8").match(/w: "([^"]+)"/)[1]
}

const rows = [
  // [specifier, importer, candidates present, expected winner]
  ["vibe", "main.vibe", ["vibe", "vibex", "d.ts", "ts", "tsx"], "vibe"],
  ["vibe", "main.vibe", ["vibex", "d.ts", "ts", "tsx"], "vibex"],
  ["vibe", "main.vibe", ["d.ts", "ts", "tsx"], "d.ts"],
  ["vibe", "main.vibe", ["ts", "tsx"], "TS2307"],
  ["vibex", "main.vibe", ["vibex", "vibe", "d.ts", "ts", "tsx"], "vibex"],
  ["vibex", "main.vibe", ["vibe", "d.ts", "ts", "tsx"], "vibe"],
  ["vibex", "main.vibe", ["d.ts", "ts", "tsx"], "d.ts"],
  ["vibex", "main.vibe", ["ts", "tsx"], "TS2307"],
  // The native twins, as TypeScript resolves them: ./App.ts and ./App.tsx.
  ["ts", "main.ts", ["ts", "tsx", "d.ts"], "ts"],
  ["ts", "main.ts", ["tsx", "d.ts"], "tsx"],
  ["ts", "main.ts", ["d.ts"], "d.ts"],
  ["tsx", "main.ts", ["tsx", "ts", "d.ts"], "tsx"],
  ["tsx", "main.ts", ["ts", "d.ts"], "ts"],
  ["tsx", "main.ts", ["d.ts"], "d.ts"]
]
try {
  for (const [specifier, importer, present, want] of rows) {
    const got = resolve(specifier, present, importer)
    const label = `./App.${specifier} from ${importer} with [${present.map(k => candidate[k]).join(", ")}]`
    assert.equal(got, want, label)
    console.log(`${label} -> ${/^TS/.test(got) ? got : candidate[got]}`)
  }
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
}
