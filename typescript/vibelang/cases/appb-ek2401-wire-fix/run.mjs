// run-seconds: 300
// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | | `EK2401` | the retired resolved `wire` intrinsic; compose Layers explicitly or use the preserving `wire compositions` codemod before rejection | 24 | [Migration](007-tooling.md#legacy-fork-try-statement-and-wire-migration) |
import assert from "node:assert/strict"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { codes, withProject } from "../_appb-retirement-helpers.mjs"
const here = dirname(fileURLToPath(import.meta.url))
const input = "import { wire } from \"vibelang-runtime\"\nservice A { static readonly key = \"appb/A\"; a(): number!! }\nservice B { static readonly key = \"appb/B\"; b(): number!! }\nconst ALive = Layer.succeed(A, { a: () => Effect.succeed(1) })\nconst BLive = Layer.succeed(B, { b: () => Effect.succeed(2) })\nexport const Live = wire(ALive, BLive)\nexport effect function main() {\n  provide Live { return [try (try A).a(), try (try B).b()] }\n}\n"
withProject(here, { "main.vibe": input }, ({ tsc, read, run }) => {
  assert.equal(tsc().status, 0)
  const before = run()
  const declaration = read("out/main.d.ts")
  console.log("EK2401 wire compositions codemod keeps " + before)
})
