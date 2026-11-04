// VIP-1/2/26: constructing an Effect does not run it. A complete comparison
// described as printing output must print it without an injected runner.
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { defaultCompiler, extract, normalizeOutput } from "./check-snippets"

const repo = resolve(import.meta.dir, "../..")

export function comparisonClaims(markdown: string) {
  const blocks = extract(markdown)
  return [...markdown.matchAll(/Both programs print `([^`]+)`/g)].map(match => {
    const line = markdown.slice(0, match.index).split("\n").length
    const block = blocks.filter(b => b.line < line && b.language === "ts" && b.comparison).at(-1)
    if (!block || block.fragment) throw new Error("Output claim needs a complete ts effect comparison")
    return { source: block.source, output: match[1], line: block.line }
  })
}

export function checkSourceOutput(source: string, expected: string, compiler = defaultCompiler()) {
  // Under docs/tools so the compiler and Node resolve the pinned Effect install.
  const directory = mkdtempSync(join(import.meta.dir, ".comparison-output-"))
  try {
    writeFileSync(join(directory, "package.json"), '{"type":"module"}')
    writeFileSync(join(directory, "main.ts"), source + "\nexport {}\n")
    writeFileSync(join(directory, "tsconfig.json"), JSON.stringify({
      compilerOptions: { strict: true, target: "ESNext", module: "NodeNext", moduleResolution: "NodeNext", skipLibCheck: true, types: [], outDir: "out" },
      files: ["main.ts"]
    }))
    const compiled = spawnSync(compiler, ["--pretty", "false", "-p", join(directory, "tsconfig.json")],
      { encoding: "utf8", timeout: 60000, env: { ...process.env, GOMAXPROCS: "1" } })
    if (compiled.status !== 0) return "compile failed: " + (compiled.error?.message ?? compiled.stdout + compiled.stderr)
    const ran = spawnSync("node", [join(directory, "out/main.js")], { encoding: "utf8", timeout: 10000 })
    if (ran.status !== 0) return "execution failed: " + (ran.error?.message ?? ran.stderr)
    return normalizeOutput(ran.stdout) === normalizeOutput(expected) ? undefined :
      "stdout mismatch: expected " + JSON.stringify(expected) + ", got " + JSON.stringify(ran.stdout)
  } finally { rmSync(directory, { recursive: true, force: true }) }
}

export function checkComparisonOutput(markdown: string) {
  return comparisonClaims(markdown).flatMap(claim => {
    const error = checkSourceOutput(claim.source, claim.output)
    return error ? [{ line: claim.line, error }] : []
  })
}

if (import.meta.main) {
  const pages = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? pages(join(directory, entry.name)) : entry.name.endsWith(".md") ? [join(directory, entry.name)] : [])
  let failures = 0
  for (const page of pages(join(repo, "docs/user/src"))) {
    for (const failure of checkComparisonOutput(readFileSync(page, "utf8"))) {
      console.error(page + ":" + failure.line + ": " + failure.error)
      failures++
    }
  }
  console.log("comparison output: " + failures + " failures")
  process.exitCode = failures ? 1 : 0
}
