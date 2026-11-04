// VIP-1: inference propagates the errors of Effects a body runs.
// A compile-error claim needs a written contract that excludes that error.
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { defaultCompiler, extract, linkModules } from "./check-snippets"

export function compileFailureWitness(source: string) {
  const directory = mkdtempSync(join(import.meta.dir, ".failure-contract-"))
  try {
    linkModules(directory)
    writeFileSync(join(directory, "package.json"), '{"type":"module"}')
    writeFileSync(join(directory, "main.vibe"), source)
    writeFileSync(join(directory, "tsconfig.json"), JSON.stringify({
      compilerOptions: { strict: true, target: "ESNext", module: "NodeNext", moduleResolution: "NodeNext", skipLibCheck: true, types: [], noEmit: true },
      files: ["main.vibe"]
    }))
    const result = spawnSync(defaultCompiler(), ["--pretty", "false", "-p", join(directory, "tsconfig.json")],
      { encoding: "utf8", timeout: 60000, env: { ...process.env, GOMAXPROCS: "1" } })
    if (result.error || result.status === null) throw result.error ?? new Error("Compiler did not exit")
    return { exit: result.status, diagnostics: result.stdout + result.stderr }
  } finally { rmSync(directory, { recursive: true, force: true }) }
}

export function checkFailureClaims(markdown: string) {
  const errors: string[] = []
  for (const paragraph of markdown.split(/\n\s*\n/)) {
    if (!/\bcaller\b/i.test(paragraph) || !/\bcompile error\b/i.test(paragraph) || !/\bfailure\b/i.test(paragraph)) continue
    // Require a checkable counterexample, not a universal promise that an
    // inferred caller can never propagate a failure.
    const witness = [...paragraph.matchAll(/`(effect function [^`]+)`/g)]
      .map(match => match[1]).find(source => /:\s*string!!\s*\{/.test(source))
    if (!witness) {
      errors.push("A caller compile-error claim needs a written no-failure contract witness")
      continue
    }
    const source = extract(markdown).find(block => block.language === "vibe" && /effect function greeting\(/.test(block.source))?.source
    if (!source) { errors.push("Missing greeting source for the caller witness"); continue }
    const rejected = compileFailureWitness(source + "\n" + witness)
    const inferred = compileFailureWitness(source + "\n" + witness.replace(/:\s*string!!(?=\s*\{)/, ""))
    if (rejected.exit === 0 || !/\bEmptyName\b/.test(rejected.diagnostics)) errors.push("The written no-failure witness was not rejected for EmptyName")
    if (inferred.exit !== 0) errors.push("The same caller without a written contract must infer its failure: " + inferred.diagnostics)
  }
  return errors
}

if (import.meta.main) {
  const page = new URL("../user/src/013-getting-started.md", import.meta.url)
  const errors = checkFailureClaims(readFileSync(page, "utf8"))
  for (const error of errors) console.error(error)
  console.log("failure contracts: " + errors.length + " failures")
  process.exitCode = errors.length ? 1 : 0
}
