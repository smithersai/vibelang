// Run the law suite before publishing any derived specification claims.
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
// The suite's watchdog ends a run that one test stalls; this deadline backs it up.
// site-contrast.test.ts runs the site build, and with it this suite, so its timeout exceeds this.
export const kernelSuiteDeadline = 15 * 60 * 1000

// What the suite reads: its own tree, the runtime sources it imports, the
// Effect each of them resolves, and Bun.
function* files(root: string, dir: string): Generator<string> {
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) yield* files(root, rel)
    else if (entry.isFile()) yield rel
  }
}

const installed = (repo: string, dir: string) => {
  try {
    return JSON.parse(readFileSync(join(repo, dir, "node_modules/effect/package.json"), "utf8")).version as string
  } catch {
    return "none"
  }
}

/** suiteKey digests every input of the kernel law suite. */
export function suiteKey(repo: string): string {
  const hash = createHash("sha256")
  hash.update(`bun ${Bun.version}\neffect ${installed(repo, "experiments")} ${installed(repo, "packages/runtime")}\n`)
  for (const dir of ["experiments", "packages/runtime/src"]) {
    for (const file of files(repo, dir)) hash.update(`${file}\n`).update(readFileSync(join(repo, file))).update("\n")
  }
  return hash.digest("hex")
}

/**
 * kernelFacts runs the kernel law suite in experiments/ and returns the
 * counts the specification's placeholders print. A passing run leaves a
 * receipt in .cache/kernel-facts/ keyed by every input of the suite
 * (suiteKey), and a later call with the same inputs reuses it: regenerating
 * the docs and building the site each ask, and the suite ran three times per
 * merge-gate run for one answer. Any change to the suite, the runtime
 * sources, the Effect installs or Bun runs it again.
 */
export function kernelFacts(repo = resolve(import.meta.dir, "../..")): Record<string, string> {
  const experiments = join(repo, "experiments")
  const key = suiteKey(repo)
  const receipt = join(repo, ".cache/kernel-facts", `${key}.json`)
  let counts: { testCount: string; testFiles: string }
  if (existsSync(receipt)) {
    counts = JSON.parse(readFileSync(receipt, "utf8"))
    console.log(`Kernel: ${counts.testCount} tests across ${counts.testFiles} files passed (receipt ${key.slice(0, 12)}).`)
  } else {
    const deadline = kernelSuiteDeadline
    const started = Date.now()
    // The same --timeout as experiments/package.json's test script (scripts/kernel-budget.test.mjs keeps them equal):
    // Bun ignores bunfig's timeout key and resets a preload's default for every file after the first.
    const suite = Bun.spawnSync(["bun", "test", "--timeout=30000"], { cwd: experiments, stdout: "pipe", stderr: "pipe", timeout: deadline })
    const suiteOutput = suite.stdout.toString() + suite.stderr.toString()
    const ran = /Ran (\d+) tests? across (\d+) files?/.exec(suiteOutput)
    const failed = /(\d+) fail/.exec(suiteOutput)
    if (suite.exitCode !== 0 || ran === null || failed === null || failed[1] !== "0") {
      console.error(suiteOutput.split("\n").slice(-30).join("\n"))
      if (Date.now() - started >= deadline) throw new Error(`the kernel law suite in experiments/ ran past ${deadline / 60000} minutes; refusing to build the docs site`)
      throw new Error("the kernel law suite in experiments/ failed; refusing to build the docs site")
    }
    counts = { testCount: ran[1]!, testFiles: ran[2]! }
    mkdirSync(join(repo, ".cache/kernel-facts"), { recursive: true })
    writeFileSync(receipt, JSON.stringify(counts) + "\n")
    console.log("Kernel: " + counts.testCount + " tests across " + counts.testFiles + " files passed.")
  }
  const lineCount = (path: string) => readFileSync(join(repo, path), "utf8").split("\n").length - 1
  return {
    ...counts,
    kernelLines: String(lineCount("packages/runtime/src/kernel/kernel.ts") + lineCount("packages/runtime/src/kernel/internals.ts"))
  }
}
