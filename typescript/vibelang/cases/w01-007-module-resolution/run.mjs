// run-seconds: 300
// rule-evidence: docs/design/src/007-tooling.md#config-files | Module resolution is as in TypeScript, with `.vibe` and `.vibex` beside `.ts` and `.tsx`: NodeNext `./user.js` can resolve to `user.vibe`.
// rule-evidence: docs/design/src/007-tooling.md#config-files | A written `./x.ts` keeps native substitutions, including `x.tsx` and `x.d.ts`, but never falls back to VibeLang source; no native candidate means `TS2307`.
// rule-evidence: docs/design/src/007-tooling.md#config-files | For `TS2307` on a stale relative `.ts` name with a migrated sibling, `vibelang --fix` repairs owned VibeLang sources to `.vibe`/`.vibex` with `rewriteRelativeImportExtensions`, otherwise the runtime `.js` (`.jsx` for JSX-preserving output).
//
// Each probe compiles a VibeLang importer with this checkout's compiler and
// its TypeScript twin, the same project with .ts/.tsx in place of
// .vibe/.vibex, with stock tsc. The two must report the same error codes,
// and both must report the codes written here.
import assert from "node:assert/strict"
import { project, check, nativeCheck, codes } from "../../tests/coverage-tooling.mjs"

const twin = (name) => name.replace(/\.vibe$/, ".ts").replace(/\.vibex$/, ".tsx")
const twinSource = (text) => text.replaceAll(".vibe\"", ".ts\"").replaceAll(".vibex\"", ".tsx\"")

function probe(name, files, compilerOptions, want, nativeFiles = Object.fromEntries(Object.entries(files).map(([file, text]) => [twin(file), twinSource(text)]))) {
  const options = { compilerOptions: { jsx: "preserve", ...compilerOptions } }
  const vibe = check(project(import.meta.url, "vibe-" + name, files, options)).output
  const native = nativeCheck(project(import.meta.url, "native-" + name, nativeFiles, options)).output
  assert.deepEqual(codes(vibe), want, name + ": VibeLang\n" + vibe)
  assert.deepEqual(codes(native), want, name + ": stock tsc\n" + native)
  console.log(name.padEnd(24), JSON.stringify(want))
}

const user = { "user.vibe": "export const user = \"u\"\n" }
const app = { "App.vibex": "export const App = 1\n" }
const tsExt = { allowImportingTsExtensions: true }
const importUser = (specifier) => ({ "main.vibe": `import { user } from "${specifier}"\nexport const u = user\n` })
const importApp = (specifier) => ({ "main.vibe": `import { App } from "${specifier}"\nexport const a = App\n` })

// NodeNext ./user.js resolves to user.vibe, as the twin's resolves to user.ts.
probe("nodenext-js-to-vibe", { ...importUser("./user.js"), ...user }, {}, [])
probe("nodenext-jsx-to-vibex", { ...importApp("./App.jsx"), ...app }, {}, [])
// A written ./x.ts keeps TypeScript's .tsx and .d.ts substitutions.
probe("ts-to-tsx", { "main.vibe": "import { widget } from \"./widget.ts\"\nexport const w = widget\n", "widget.tsx": "export const widget = 1\n" }, tsExt, [])
probe("ts-to-dts", { "main.vibe": "import { shape } from \"./shape.ts\"\nexport const s = shape\n", "shape.d.ts": "export declare const shape: number\n", "shape.js": "export const shape = 1\n" }, tsExt, [])
// It never falls back to user.vibe or App.vibex: with no native candidate it
// is TS2307, as for the twin whose only other module is unrelated.ts. This is
// the stale relative .ts name of a module migrated to .vibe or .vibex.
const unrelated = { "unrelated.ts": "export const unrelated = 0\n" }
probe("stale-ts-name", { ...importUser("./user.ts"), ...user }, tsExt, ["TS2307"], { "main.ts": importUser("./user.ts")["main.vibe"], ...unrelated })
probe("stale-tsx-name", { ...importApp("./App.tsx"), ...app }, tsExt, ["TS2307"], { "main.ts": importApp("./App.tsx")["main.vibe"], ...unrelated })
// The same holds without allowImportingTsExtensions: resolution fails first.
probe("stale-ts-name-plain", { ...importUser("./user.ts"), ...user }, {}, ["TS2307"], { "main.ts": importUser("./user.ts")["main.vibe"], ...unrelated })

// vibelang --fix repairs those stale names in the project's own VibeLang
// sources, to the source name under rewriteRelativeImportExtensions and to
// the runtime output name otherwise. A native .ts importer is not owned
// VibeLang source and keeps its written name.
const stale = {
  "main.vibe": "import { user } from \"./user.ts\"\nimport { App } from \"./App.tsx\"\nexport const both = [user, App]\n",
  "native.ts": "import { user } from \"./user.ts\"\nexport const again = user\n",
  ...user, ...app,
}
for (const [name, compilerOptions, want] of [
  ["fix-rewrite", { rewriteRelativeImportExtensions: true, jsx: "preserve" }, ["./user.vibe", "./App.vibex"]],
  ["fix-preserve", { jsx: "preserve" }, ["./user.js", "./App.jsx"]],
  ["fix-react-jsx", { jsx: "react-jsx" }, ["./user.js", "./App.js"]],
]) {
  const p = project(import.meta.url, name, stale, { compilerOptions })
  assert.deepEqual(codes(check(p).output), ["TS2307"], name + " before --fix")
  check(p, ["--fix"])
  const specifiers = [...p.read("main.vibe").matchAll(/from "([^"]+)"/g)].map(m => m[1])
  assert.deepEqual(specifiers, want, name + "\n" + p.read("main.vibe"))
  assert.equal(p.read("native.ts"), stale["native.ts"], name + ": the native importer changed")
  console.log(name.padEnd(24), JSON.stringify(specifiers))
}
