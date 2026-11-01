// stepKey names the work an eval case graded: the case, and a digest of the flow
// code that did the work. @smthrs/evals reads a score that moved at an unchanged
// step key as nondeterminism, and one that dropped at a changed key as a
// regression. Keyed by the case name alone, a flow change that broke a case was
// reported as flakiness: ts-bump's mutation run on 2026-11-01 dropped four
// scores and said "Regressions: 0, Nondeterminism: 4".
//
// The digest covers each directory's flow.ts, run.ts and lib/, the code a run
// executes; not eval.ts, baseline.json, test/ or README.md, which grade or
// describe the work. Pass every flow directory whose code the flow imports.
import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

const CODE = ["flow.ts", "run.ts", "lib"]

function walk(file, out) {
  if (statSync(file).isDirectory()) for (const name of readdirSync(file).sort()) walk(path.join(file, name), out)
  else out.push(file)
  return out
}

// flowDigest is the first 12 hex digits of the SHA-256 of the code's paths and bytes.
export function flowDigest(...dirs) {
  const hash = createHash("sha256")
  for (const dir of dirs) {
    const files = CODE.map((name) => path.join(dir, name)).filter(existsSync).flatMap((file) => walk(file, []))
    for (const file of files) {
      hash.update(path.join(path.basename(dir), path.relative(dir, file)) + "\0")
      hash.update(readFileSync(file))
      hash.update("\0")
    }
  }
  return hash.digest("hex").slice(0, 12)
}

export const stepKey = (name, ...dirs) => `${name}@${flowDigest(...dirs)}`
