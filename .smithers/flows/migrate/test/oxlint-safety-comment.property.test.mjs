import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath, pathToFileURL } from "node:url"
import { test } from "node:test"
import { wireDeveloperTools } from "../lib/tooling.mjs"

const repo = fileURLToPath(new URL("../../../../", import.meta.url))
const eslintRequire = createRequire(join(repo, "packages/compiler/test/eslint/package.json"))
const nativeRequire = createRequire(join(repo, ".smithers/package.json"))
const runtimeRequire = createRequire(join(repo, "packages/runtime/package.json"))
const { Linter } = eslintRequire("eslint"), fc = runtimeRequire("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-safety-comment.json", import.meta.url)))
const ruleURL = new URL("./fixtures/opencode-native-policy/rules/require-safety-comment-for-type-assertion.ts", import.meta.url)
const rule = "anti-slop/require-safety-comment-for-type-assertion"

// The unchanged repository rule compares comments and assertions using Oxlint's
// start/end offsets, including when looking up the containing statement.
async function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), "opencode-safety-comment-"))
  const put = (name, text) => writeFileSync(join(root, name), text)
  try {
    mkdirSync(join(root, "node_modules/.bin"), { recursive: true })
    for (const name of ["eslint", "typescript-eslint"]) {
      symlinkSync(dirname(eslintRequire.resolve(name + "/package.json")), join(root, "node_modules", name))
    }
    symlinkSync(join(repo, "packages/compiler"), join(root, "node_modules/vibelang"))
    symlinkSync(dirname(nativeRequire.resolve("oxlint/package.json")), join(root, "node_modules/oxlint"))
    symlinkSync(join(root, "node_modules/oxlint/bin/oxlint"), join(root, "node_modules/.bin/oxlint"))
    put("package.json", JSON.stringify({ type: "module", scripts: { lint: "oxlint" } }))
    put("policy.mjs", 'import { requireSafetyCommentForTypeAssertionRule as safety } from ' + JSON.stringify(ruleURL.href) + '; export default { rules: { "require-safety-comment-for-type-assertion": safety } }\n')
    put(".oxlintrc.json", JSON.stringify({ categories: { correctness: "off" }, jsPlugins: [{ name: "anti-slop", specifier: "./policy.mjs" }], rules: { [rule]: "error" } }))
    wireDeveloperTools({ root, specsFor: () => ({ vibelang: "0.0.12" }) })
    const bridge = await import(pathToFileURL(join(root, ".vibelang/eslint.config.mjs")).href)
    const config = await bridge.configFor(undefined, true)
    const linter = new Linter({ cwd: root })
    const lint = (source, extension = "vibe") => linter.verify(source, config, { filename: join(root, "probe." + extension) })
    const native = source => {
      put("probe.ts", source)
      const result = spawnSync(process.execPath, [join(root, "node_modules/oxlint/bin/oxlint"), "--threads", "1", "--format", "json", "-c", ".oxlintrc.json", "probe.ts"], { cwd: root, encoding: "utf8", timeout: 30000 })
      assert.ok(result.status === 0 || result.status === 1, result.stdout + result.stderr)
      return JSON.parse(result.stdout).diagnostics
    }
    await run({ lint, native })
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("Opencode SAFETY comments retain the native assertion policy after lint setup", async () => {
  await fixture(async ({ lint, native }) => {
    assert.deepEqual(native(corpus.source), [])
    assert.deepEqual(lint(corpus.source), [])
    const unsafe = corpus.source.replace(/  \/\/ SAFETY:[^\n]*\n/, "")
    assert.equal(native(unsafe).length, 1)
    const diagnostics = lint(unsafe)
    assert.equal(diagnostics.length, 1)
    assert.equal(diagnostics[0].ruleId, rule)
    assert.equal(diagnostics[0].line, 4)
  })
})

test("property: assertion comments, owner statements and source offsets preserve the native policy", async () => {
  await fixture(async ({ lint }) => {
    await fc.assert(fc.asyncProperty(
      fc.constantFrom("", "// café 😀\n", "/* 😀 */\r\n"),
      fc.constantFrom("\n", "\r\n"),
      fc.constantFrom("// SAFETY: input has the declared shape.", "/* SAFETY: input has the declared shape. */"),
      fc.constantFrom("declaration", "return", "expression", "property", "export", "inline"),
      fc.constantFrom("vibe", "vibex"),
      fc.boolean(),
      async (prefix, nl, comment, owner, extension, safe) => {
        const cast = owner === "inline" ? "(/* SAFETY: input is a number. */ input as number)" : "input as number"
        const mark = safe ? comment + nl : ""
        const source = {
          declaration: "export function f(input: unknown) {\n" + mark + "const value = " + cast + "; return value; }",
          return: "export function f(input: unknown) {\n" + mark + "return " + cast + "; }",
          expression: "export function f(input: unknown) {\n" + mark + "(" + cast + "); }",
          property: "declare const input: unknown;\nexport class C {\n" + mark + "value = " + cast + "; }",
          export: "declare const input: unknown;\n" + mark + "export const value = " + cast + ";",
          inline: "export function f(input: unknown) { return " + (safe ? cast : "(input as number)") + "; }"
        }[owner]
        const findings = lint(prefix + source.replaceAll("\n", nl), extension)
        assert.equal(findings.length, safe ? 0 : 1, JSON.stringify({ owner, safe, findings }))
        if (!safe) assert.equal(findings[0].ruleId, rule)
      }
    ), { seed: 811083, numRuns: 100 })
  })
})
