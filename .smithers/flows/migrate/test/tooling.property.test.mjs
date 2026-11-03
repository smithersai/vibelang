// docs/design/vips/0034-compiler-and-tooling.md#b800f23f36b5c9ca
// VIP-34: formatter wiring retains Oxfmt and routes Vibe through the formatter companion; Prettier and dprint plugin suites provide execution controls.
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { wireDeveloperTools } from "../lib/tooling.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const docs = new URL("../../../../docs/user/src/setup/developer-tools.md", import.meta.url)
const quote = "one pass for each `oxlint` invocation in it,\nincluding one in a subshell"
const specsFor = () => ({ vibelang: "0.0.11" })

// wire runs setup's tool wiring on a package with one script and returns the
// script as setup leaves it.
function wire(script) {
  const root = mkdtempSync(join(tmpdir(), "vibe-tooling-property-"))
  try {
    const put = (file, text) => { mkdirSync(join(root, file, ".."), { recursive: true }); writeFileSync(join(root, file), text) }
    for (const config of [".oxlintrc.json", ".oxlintrc.app.json", ".oxlintrc.effect.json"]) put(config, "{}")
    put("src/main.vibe", "")
    put("package.json", JSON.stringify({ scripts: { lint: script } }))
    wireDeveloperTools({ root, specsFor })
    const wired = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts.lint
    return { wired, again: wireDeveloperTools({ root, specsFor }).changed }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const configFile = { ".oxlintrc.json": "eslint.config.mjs", ".oxlintrc.app.json": "eslint.app.config.mjs", ".oxlintrc.effect.json": "eslint.effect.config.mjs" }
const oxlint = fc.record({
  config: fc.constantFrom(null, ".oxlintrc.json", ".oxlintrc.app.json", ".oxlintrc.effect.json"),
  spelling: fc.constantFrom("-c ", "--config ", "--config="),
  flags: fc.subarray(["--disable-nested-config", "--deny-warnings", "-D no-debugger"]),
  paths: fc.subarray(["src", "examples", "packages/website/src"])
}).map(({ config, spelling, flags, paths }) => ({
  text: ["oxlint", ...(config ? [spelling + config] : []), ...flags, ...paths].join(" "),
  nativeText: ["oxlint", "--no-error-on-unmatched-pattern", ...(config ? [spelling + config] : []), ...flags, ...paths].join(" "),
  pass: `eslint --config .vibelang/${configFile[config ?? ".oxlintrc.json"]} ${paths.length ? paths.join(" ") : '"**/*.vibe"'} --no-error-on-unmatched-pattern${flags.includes("--deny-warnings") ? " --max-warnings 0" : ""}`
}))
const other = fc.constantFrom("pnpm build", "echo done", "tsc -b").map(text => ({ text, nativeText: text, pass: null }))
const step = fc.tuple(fc.oneof(oxlint, other), fc.boolean()).map(([s, parens]) => parens ? { ...s, text: `(${s.text})`, nativeText: `(${s.nativeText})` } : s)
const script = fc.tuple(fc.array(step, { minLength: 1, maxLength: 3 }), oxlint, fc.nat(3), fc.constantFrom(" && ", "; "), fc.boolean())
  .map(([steps, lint, at, separator, parens]) => {
    const all = [...steps]; all.splice(at % (steps.length + 1), 0, lint)
    const text = all.map(s => s.text).join(separator)
    const nativeText = all.map(s => s.nativeText).join(separator)
    return { text: parens ? `(${text})` : text, nativeText: parens ? `(${nativeText})` : nativeText, passes: [...new Set(all.map(s => s.pass).filter(Boolean))] }
  })

test("foldkit-17: every oxlint invocation, in a subshell or not, gets the .vibe pass for its configuration and paths", () => {
  assert.ok(readFileSync(docs, "utf8").includes(quote), "update the quoted developer-tools contract")
  fc.assert(fc.property(script, ({ text, nativeText, passes }) => {
    const { wired, again } = wire(text)
    const suffix = " && " + passes.join(" && ")
    assert.ok(wired.endsWith(suffix), `${text}\n-> ${wired}`)
    assert.ok([text, `(${text})`, nativeText, `(${nativeText})`].includes(wired.slice(0, -suffix.length)), `the script itself is kept: ${wired}`)
    assert.deepEqual(again, [], "a second setup changes nothing")
    // A pass an earlier run wrote for another configuration is written anew,
    // and so are the layers an old setup added on each rerun.
    const stale = ' && eslint --config .vibelang/eslint.config.mjs "**/*.vibe" --no-error-on-unmatched-pattern'
    assert.equal(wire(wired.slice(0, -suffix.length) + stale).wired, wired)
    assert.equal(wire(`((${wired})${stale})${stale}`).wired, wired)
  }), { seed: 17017, numRuns: 120 })
})

test("foldkit-17: a format command in a subshell is followed by vibelang-format", () => {
  const format = fc.tuple(fc.constantFrom("oxfmt", "vp fmt"), fc.boolean(), fc.boolean(), fc.constantFrom("", "pnpm build && ", "cd docs; "))
  fc.assert(fc.property(format, ([tool, check, parens, before]) => {
    const command = tool + (check ? " --check ." : " .")
    const text = before + (parens ? `(${command})` : command)
    const { wired, again } = wire(text)
    const suffix = ` && vibelang-format ${check ? "--check" : "--write"}`
    assert.ok(wired.endsWith(suffix), `${text}\n-> ${wired}`)
    assert.ok([text, `(${text})`].includes(wired.slice(0, -suffix.length)))
    assert.deepEqual(again, [])
  }), { seed: 17018, numRuns: 60 })
})
