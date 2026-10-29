// node --test scripts/brand-gate.test.mjs
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, "..")
const gate = (...args) => spawnSync(process.execPath, [join(here, "brand-gate.mjs"), ...args], { cwd: repo, encoding: "utf8" })
const codemod = (...args) => spawnSync(process.execPath, [join(here, "rename-to-vibelang.mjs"), ...args], { cwd: repo, encoding: "utf8" })

function fixture(t, files) {
  const root = mkdtempSync(join(tmpdir(), "vibelang-brand-gate-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  return root
}

test("the repository spells no retired name outside the exemptions", () => {
  const result = gate()
  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.match(result.stdout, /brand-gate: ok/)
})

test("the gate finds a retired spelling and a retired extension, and honours the exemptions", (t) => {
  const root = fixture(t, {
    "src/a.vibe": 'import { run } from "effeck-runtime"\n',
    "src/b.effeck": "export const x = 1\n",
    "src/c.vibe": "// the old name, Effeck, on purpose: brand-gate: allow\n",
    "docs/d.md": "Docs at https://vibelang.sh; bugs at https://smithers.sh/effeck/effeck/issues.\n",
    "docs/redirect/index.js": "const home = \"https://effeck.dev\"\n",
    "docs/tools/site.ts": "https://effeck.dev/a.html\n",
    "docs/g.md": "Old docs at https://effeck.dev/a.html\n",
    "artifacts/e.md": "Effeck, as it was.\n",
    "docs/f.md": "Set compilerOptions.EFFECK in tsconfig.json.\n",
  })
  const result = gate("--root", root)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /src\/a\.vibe:1: effeck/)
  assert.match(result.stderr, /src\/b\.effeck: the path spells effeck/)
  assert.match(result.stderr, /docs\/f\.md:1: EFFECK/)
  assert.match(result.stderr, /docs\/tools\/site\.ts:1: effeck/)
  assert.match(result.stderr, /docs\/g\.md:1: effeck/, "effeck.dev outside its site's files is a finding")
  assert.doesNotMatch(result.stderr, /src\/c\.vibe|docs\/d\.md|artifacts\/e\.md|docs\/redirect\/index\.js/)
  assert.match(result.stderr, /Remedy: node scripts\/rename-to-vibelang\.mjs/)
})

test("the codemod tells an extension from a property, and keeps names we do not control", async () => {
  const { rewriteLine } = await import("./rename-to-vibelang.mjs")
  const cases = [
    ['import { a } from "./main.effeck"', "x.ts", 'import { a } from "./main.vibe"'],
    ["options.compilerOptions.effeck ?? config.effeck?.tracing ?? peers?.effeck", "x.ts", "options.compilerOptions.vibelang ?? config.vibelang?.tracing ?? peers?.vibelang"],
    ["/\\.(effeck|ts)$/ and /\\.effeck$/", "x.ts", "/\\.(vibe|ts)$/ and /\\.vibe$/"],
    ['Glob: "**/*.{ts,json,effeck}"', "x.go", 'Glob: "**/*.{ts,json,vibe}"'],
    ["node_modules/.effeck/ .effeck-pane source.effeck#docblock", "x.ts", "node_modules/.vibelang/ .vibelang-pane source.vibe#docblock"],
    ["an Effeck function in an `.effeck` file", "x.md", "a VibeLang function in a `.vibe` file"],
    ["`effeck --lsp --stdio`, node_modules/.bin/effeck, effeck.exe, EFFECK_BINARY", "x.md", "`vibelang --lsp --stdio`, node_modules/.bin/vibelang, vibelang.exe, VIBELANG_BINARY"],
    ['{ "id": "effeck", "language": "effeck" } onLanguage:effeck', "package.json", '{ "id": "vibe", "language": "vibe" } onLanguage:vibe'],
    ["```effeck", "x.md", "```vibe"],
    ["@effeck/unplugin and @effeck trusted", "x.ts", "vibelang-unplugin and @vibelang trusted"],
    ["https://effeck.dev/effeck-features/115-cheat-sheet.html", "x.md", "https://vibelang.sh/vibelang-features/115-cheat-sheet"],
    ["see https://effeck.dev and https://effeck.dev/index.html", "x.md", "see https://vibelang.sh and https://vibelang.sh/"],
    ["https://effeck.dev/setup/formatting.html", "docs/redirect/index.js", "https://effeck.dev/setup/formatting.html"],
    ["https://smithers.sh/effeck/effeck/blob/main/typescript/EFFECK.md", "x.md", "https://smithers.sh/effeck/effeck/blob/main/typescript/VIBELANG.md"],
    ['"/nonexistent/effeck/effeck" and scripts/build-effeck.sh', "x.ts", '"/nonexistent/vibelang/vibelang" and scripts/build-vibelang.sh'],
  ]
  for (const [line, rel, expected] of cases) assert.equal(rewriteLine(line, rel).line, expected, line)
})

test("the codemod renames a tree that then passes the gate, and a second run changes nothing", (t) => {
  const root = fixture(t, {
    "src/main.effeck": 'import { greet } from "./greet.effeck"\nexport function main() { Console.log("Hello, Effeck!") }\n',
    "src/greet.effeck": "export function greet(name: string) { return `Hi ${name}` }\n",
    "tsconfig.json": '{ "compilerOptions": { "effeck": { "tracing": true } }, "include": ["src/**/*.effeck"] }\n',
    "package.json": '{ "name": "app", "scripts": { "build": "effeck" }, "devDependencies": { "effeck": "0.0.1", "effeck-runtime": "0.0.1" } }\n',
    "README.md": "An Effeck app. Run `effeck --watch`. Docs: https://effeck.dev.\n\n```effeck\nconst x = 1\n```\n",
  })
  const first = codemod("--root", root)
  assert.equal(first.status, 0, first.stderr)
  assert.match(first.stdout, /4 files rewritten \(\d+ occurrences\), 2 files renamed/)
  assert.equal(readFileSync(join(root, "src/main.vibe"), "utf8"), 'import { greet } from "./greet.vibe"\nexport function main() { Console.log("Hello, VibeLang!") }\n')
  assert.equal(readFileSync(join(root, "tsconfig.json"), "utf8"), '{ "compilerOptions": { "vibelang": { "tracing": true } }, "include": ["src/**/*.vibe"] }\n')
  assert.equal(readFileSync(join(root, "package.json"), "utf8"), '{ "name": "app", "scripts": { "build": "vibelang" }, "devDependencies": { "vibelang": "0.0.1", "vibelang-runtime": "0.0.1" } }\n')
  assert.equal(readFileSync(join(root, "README.md"), "utf8"), "A VibeLang app. Run `vibelang --watch`. Docs: https://vibelang.sh.\n\n```vibe\nconst x = 1\n```\n")
  assert.equal(gate("--root", root).status, 0)
  const second = codemod("--root", root)
  assert.equal(second.status, 0, second.stderr)
  assert.match(second.stdout, /0 files rewritten \(0 occurrences\), 0 files renamed/)
})

test("the rename records the decision without author or review provenance", t => {
  const root = fixture(t, {
    "docs/design/history/DECISIONS.md": "**D125. The language is Effeck** (supersedes D58). Earlier name.\n",
  })
  const result = codemod("--root", root)
  assert.equal(result.status, 0, result.stderr)
  const decision = readFileSync(join(root, "docs/design/history/DECISIONS.md"), "utf8")
  assert.match(decision, /The language is VibeLang/)
  assert.doesNotMatch(decision, /Will|GPT-|review|owner/)
})
