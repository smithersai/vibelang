// run-seconds: 300
// rule-evidence: docs/design/src/007-tooling.md#config-files | Written `./x.vibe` and `./x.vibex` imports follow the `.ts`/`.tsx` twin's source-extension checks, including `TS5097` for a value import without `allowImportingTsExtensions` or `rewriteRelativeImportExtensions`.
//
// Each probe compiles a VibeLang importer with this checkout's compiler and
// its TypeScript twin, the same project with .ts/.tsx in place of
// .vibe/.vibex, with stock tsc. Both must report the codes written here.
import assert from "node:assert/strict"
import { project, check, nativeCheck, codes } from "../../tests/coverage-tooling.mjs"

const twin = (name) => name.replace(/\.vibe$/, ".ts").replace(/\.vibex$/, ".tsx")
const twinSource = (text) => text.replaceAll(".vibe\"", ".ts\"").replaceAll(".vibex\"", ".tsx\"")
const failures = []

function probe(name, files, compilerOptions, want) {
  const nativeFiles = Object.fromEntries(Object.entries(files).map(([file, text]) => [twin(file), twinSource(text)]))
  const options = { compilerOptions: { jsx: "preserve", ...compilerOptions } }
  const vibe = check(project(import.meta.url, "vibe-" + name, files, options)).output
  const native = nativeCheck(project(import.meta.url, "native-" + name, nativeFiles, options)).output
  assert.deepEqual(codes(native), want, name + ": stock tsc\n" + native)
  if (JSON.stringify(codes(vibe)) !== JSON.stringify(want)) failures.push(name + ": VibeLang reports " + JSON.stringify(codes(vibe)) + "\n" + vibe)
  console.log(name.padEnd(24), JSON.stringify(want))
}

const user = { "user.vibe": "export const user = \"u\"\n" }
const app = { "App.vibex": "export const App = 1\n" }
const importUser = { "main.vibe": "import { user } from \"./user.vibe\"\nexport const u = user\n", ...user }
const importApp = { "main.vibe": "import { App } from \"./App.vibex\"\nexport const a = App\n", ...app }

probe("vibe-value-import", importUser, {}, ["TS5097"])
probe("vibex-value-import", importApp, {}, ["TS5097"])
probe("vibe-value-reexport", { "main.vibe": "export { user } from \"./user.vibe\"\n", ...user }, {}, ["TS5097"])
probe("vibe-type-import", { "main.vibe": "import type { Shape } from \"./shape.vibe\"\nexport const s: Shape = { n: 1 }\n", "shape.vibe": "export interface Shape { readonly n: number }\n" }, {}, [])
probe("vibe-allow-ts-extensions", importUser, { allowImportingTsExtensions: true }, [])
probe("vibe-rewrite-extensions", importUser, { rewriteRelativeImportExtensions: true }, [])
probe("vibex-rewrite-extensions", importApp, { rewriteRelativeImportExtensions: true }, [])
assert.deepEqual(failures, [], failures.join("\n"))
