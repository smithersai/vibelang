// Node/compiler integration probes for Appendix B tooling policies. Each input
// is compiled in its own directory; a probe records the actual process outcome.
import assert from "node:assert/strict"
import { chapter } from "../../../docs/tools/spec-witness.mjs"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
const compiler = fileURLToPath(new URL("../../built/local/tsc", import.meta.url))
export function diagnosticMessagesOf(output) {
  return [...output.matchAll(/(?:error|warning|suggestion) (?:EK|TS)[0-9]+:[ \t]*([^\n]*(?:\n[ \t]+[^\n]*)*)/g)].map(match => match[1]).join("\n")
}

export function runProbes(directory, probes, announce = true) {
  for (const probe of probes) {
    const root = mkdtempSync(join(directory, "probe-"))
    try {
      writeFileSync(join(root, "main.vibe"), probe.source)
      writeFileSync(join(root, "package.json"), '{"type":"module"}')
      writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
        compilerOptions: { target: "es2022", module: "nodenext", strict: true, types: [], skipLibCheck: true, outDir: "out", ...probe.options },
        vibe: probe.vibe || {}, files: ["main.vibe"]
      }))
      const args = [...(probe.prefix || []), "--pretty", "false", "-p", join(root, "tsconfig.json"), ...(probe.args || [])]
      const result = spawnSync(compiler, args, { encoding: "utf8", timeout: 60_000 })
      const output = result.stdout + result.stderr
      assert.notEqual(result.status, null, probe.name + ": process failed: " + JSON.stringify({ signal: result.signal, error: result.error?.message }) + "\n" + output)
      if (probe.status === "zero") assert.equal(result.status, 0, probe.name + ": " + output)
      if (probe.status === "error") {
        assert.notEqual(result.status, 0, probe.name + ": " + output)
        assert.match(output, /error (?:EK|TS)[0-9]+:/, probe.name + ": compiler must report a diagnostic")
      }
      const diagnosticMessages = diagnosticMessagesOf(output)
      if (probe.diagnostic) {
        const diagnostic = probe.diagnostic
        const pattern = new RegExp(diagnostic.category + " " + diagnostic.code + ":")
        assert.match(output, pattern, probe.name)
      }
      if (probe.errorCodes) {
        const codes = [...output.matchAll(/error ((?:EK|TS)[0-9]+):/g)].map(match => match[1])
        assert.deepEqual([...new Set(codes)].sort(), [...new Set(probe.errorCodes)].sort(), probe.name + ": " + output)
      }
      for (const absent of probe.absent || []) assert.doesNotMatch(output, new RegExp(absent + ":"), probe.name)
      for (const text of probe.messages || []) assert.ok(diagnosticMessages.includes(text), probe.name + ": " + output)
      if (probe.fixed) {
        const after = readFileSync(join(root, "main.vibe"), "utf8")
        assert.match(after, new RegExp(probe.fixed.includes), probe.name + ": " + after)
        if (probe.fixed.excludes) assert.doesNotMatch(after, new RegExp(probe.fixed.excludes), probe.name)
      }
      if (probe.emitted !== undefined) assert.equal(existsSync(join(root, "out/main.js")), probe.emitted, probe.name + ": emit policy")
    } finally { rmSync(root, { recursive: true, force: true }) }
  }
  if (announce) console.log("probes agree")
}

export const interimSeverityQuote = "An interim `EK92xx` code sits in the separately labelled compatibility inventory and is not one of the language's own rules (detail 189), so an entry for it is the same config error as any other code that may not be configured, `EK3006`, even though the compiler prints it as a warning; the oracle and the compiler already agree."

// Chapter 900, interim configuration: mutate each of the eight keys and every
// permitted severity spelling. The oracle is rejection with EK3006 throughout.
export function runInterimSeverityMutations(directory) {
  const quotedChapter = chapter("900-appendices").replace(/\s+/g, " ")
  assert.ok(quotedChapter.includes(interimSeverityQuote.replace(/\s+/g, " ")), "Chapter 900 interim configuration oracle still quoted")
  const require = createRequire(new URL("../../../packages/runtime/package.json", import.meta.url))
  const fc = require("fast-check")
  const probe = (code, severity) => runProbes(directory, [{
    name: "interim:" + code + ":" + severity,
    source: "export const value = 1",
    vibe: { severities: { [code]: severity } },
    status: "error", diagnostic: { code: "EK3006", category: "error" }, errorCodes: ["EK3006"]
  }], false)
  for (let n = 1; n <= 8; n++) probe("EK920" + n, "off")
  fc.assert(fc.property(fc.integer({ min: 1, max: 8 }), fc.constantFrom("off", "error", "warning", "suggestion"),
    (n, severity) => probe("EK920" + n, severity)), { seed: 900342, numRuns: 16 })
  console.log("probes agree")
}
