// --fix repairs an owned .vibe/.vibex source that an import reaches even
// when exclude omits it from root discovery, as TypeScript's own program
// includes it; an excluded source nothing imports, and a dependency, stay.
import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { project, baseOptions } from "../_tooling-witness.mjs"

const legacy = name => `import type { Effect } from "effect"\nexport type ${name} = Effect.Effect<number>\n`
for (const configName of ["tsconfig.json", "vibe.config.json"]) for (const ext of [".vibe", ".vibex"]) project(({ dir, put, read, invoke, stock }) => {
  mkdirSync(join(dir, ".git")) // repository boundary marker; no VCS command runs
  const files = {
    ["src/internal/helper" + ext]: legacy("Helper"),
    "src/internal/unused.vibe": legacy("Unused"),
    "node_modules/dep/index.vibe": legacy("Dep"),
  }
  for (const [file, text] of Object.entries(files)) put(file, text)
  put("node_modules/dep/package.json", '{"name":"dep","type":"module","types":"index.vibe"}')
  put("src/main" + ext, `import type { Helper } from "./internal/helper${ext}"\nimport type { Dep } from "dep"\nexport type Both = Helper | Dep\n`)
  const options = { ...baseOptions(), noEmit: true, jsx: "preserve", allowImportingTsExtensions: true }
  put(configName, { compilerOptions: options, include: ["src"], exclude: ["src/internal"] })
  // Native oracle: TypeScript's program holds an excluded file an import reaches.
  put("twin/src/main.ts", 'import type { Helper } from "./internal/helper.ts"\nexport type Both = Helper\n')
  put("twin/src/internal/helper.ts", "export type Helper = number\n")
  put("twin/src/internal/unused.ts", "export type Unused = number\n")
  put("twin/tsconfig.json", { compilerOptions: options, include: ["src"], exclude: ["src/internal"] })
  const listed = stock("-p", "twin", "--listFilesOnly").stdout
  assert.match(listed, /twin\/src\/internal\/helper\.ts/)
  assert.doesNotMatch(listed, /unused\.ts/)

  const label = configName + "/" + ext
  const r = invoke("--fix", "-p", configName, "--pretty", "false")
  assert.equal(r.status, 0, label + "\n" + r.text)
  assert.match(read("src/internal/helper" + ext), /Helper = number!!/, label + ": the imported excluded owned source is fixed")
  assert.equal(read("src/internal/unused.vibe"), files["src/internal/unused.vibe"], label + ": an excluded source no import reaches")
  assert.equal(read("node_modules/dep/index.vibe"), files["node_modules/dep/index.vibe"], label + ": a dependency")
})
console.log("an owned source an import reaches is fixed even when exclude omits it")
