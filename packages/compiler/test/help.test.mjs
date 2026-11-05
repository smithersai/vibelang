import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const launcher = fileURLToPath(new URL("../bin/vibelang", import.meta.url))
const native = process.env.VIBELANG_BINARY || fileURLToPath(new URL("../native/vibelang", import.meta.url))
const skip = !existsSync(native) && "run sh scripts/build-vibelang.sh"

function checkHelp(args) {
  const result = spawnSync(process.execPath, [launcher, ...args], {
    encoding: "utf8", env: { ...process.env, VIBELANG_BINARY: native, NO_COLOR: "1" }
  })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.equal(result.stderr, "")
  const sections = result.stdout.split(/\n\s*\n/)
  for (const [flag, description] of [
    ["fix", /Apply safe quick fixes before compiling, or to each project in --build order; incompatible with --watch\./],
    ["lsp", /Start the language server/],
    ["stdio", /Use standard input and output/],
    ["estree", /Parse.*stdin.*ESTree JSON/],
    ["write-dprint-plugin", /Write the dprint process plugin/],
    ["loader-root", /Type-check and emit only the \.vibe files under a directory, as a module loader's compile does/],
    ["vibelang", /Configure diagnostics and trusted packages in tsconfig.json/]
  ]) {
    const section = sections.find((text) => new RegExp(`^\\s*--${flag}\\b`).test(text))
    assert.ok(section, `missing --${flag} in ${args.join(" ")}`)
    assert.match(section.replace(/\s+/g, " "), description)
    if (flag === "vibelang") {
      assert.match(section, /config only/)
      assert.doesNotMatch(section, /default:\s*undefined/)
    }
  }
}

for (const args of [["--help"], ["--help", "--all"]]) {
  test(`vibelang ${args.join(" ")} describes VibeLang's flags and configuration`, { skip }, () => checkHelp(args))
}

test("help aliases and option order describe project repair boundaries", { skip }, async () => {
  await checkProperty(fc, {
    name: "help-repair-boundaries",
    rule: "docs/design/src/007-tooling.md: With `-b`, each project fixes its own files in build order.",
    command: "node --test packages/compiler/test/help.test.mjs",
    arbitrary: fc.record({
      help: fc.constantFrom("--help", "-h"),
      all: fc.boolean(),
      allFirst: fc.boolean()
    }),
    numRuns: 12,
    check: ({ help, all, allFirst }) => checkHelp(all ? (allFirst ? ["--all", help] : [help, "--all"]) : [help])
  })
})
