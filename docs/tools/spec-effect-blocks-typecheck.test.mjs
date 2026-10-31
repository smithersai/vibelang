import assert from "node:assert/strict"
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import ts from "typescript"

const tools = dirname(fileURLToPath(import.meta.url))
const design = join(tools, "../design")

// Every Effect TypeScript counterpart in the specification and the VIPs is a program the reader can run, so it must
// type-check under --strict with the pinned TypeScript and effect. A block marked "// fragment" is exempt.
test("every ts effect block in the specification type-checks under --strict", () => {
  const blocks = []
  for (const dir of ["src", "vips"]) {
    for (const name of readdirSync(join(design, dir)).filter(n => n.endsWith(".md")).sort()) {
      const text = readFileSync(join(design, dir, name), "utf8")
      for (const m of text.matchAll(/```ts effect\n([\s\S]*?)```/g)) {
        if (m[1].trimStart().startsWith("// fragment")) continue
        blocks.push({ where: `${dir}/${name}:${text.slice(0, m.index).split("\n").length + 1}`, source: m[1] })
      }
    }
  }
  assert.ok(blocks.length > 100, `found only ${blocks.length} blocks`)
  const directory = mkdtempSync(join(tools, ".spec-typecheck-"))
  try {
    const files = blocks.map((block, i) => {
      const file = join(directory, `block${i}.mts`)
      writeFileSync(file, /^\s*(import|export)\b/m.test(block.source) ? block.source : block.source + "\nexport {}\n")
      return file
    })
    const program = ts.createProgram(files, {
      strict: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext, skipLibCheck: true, noEmit: true,
    })
    const failures = ts.getPreEmitDiagnostics(program).filter(d => d.file).map(d => {
      const block = blocks[files.indexOf(d.file.fileName)]
      const { line } = d.file.getLineAndCharacterOfPosition(d.start ?? 0)
      return `${block?.where ?? d.file.fileName} (+${line}): TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`
    })
    assert.deepEqual(failures, [])
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
