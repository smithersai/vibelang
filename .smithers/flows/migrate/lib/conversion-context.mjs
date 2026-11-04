// A completed conversion and a refusal are measurements of one baseline and
// producer. Historical receipts cannot certify another context.
import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { readToolchain } from "./toolchain.mjs"
import { readJsonIf } from "./util.mjs"

export function conversionIdentity(config, p) {
  const toolchain = config.toolchain.kind === "staged" ? readToolchain(config.toolchain.dir) : config.toolchain
  const compiler = config.toolchain.kind === "staged" ? toolchain.compiler
    : join(config.target, config.packages[0].dir, "node_modules/.bin/vibelang")
  const setup = readJsonIf(p.setup)
  const hash = createHash("sha256")
  hash.update(JSON.stringify({ base: config.base, setup: setup?.jj, toolchain: {
    kind: config.toolchain.kind, commit: toolchain.commit, version: toolchain.version
  } }))
  hash.update(readFileSync(compiler))
  hash.update(readFileSync(new URL("./onepass.mjs", import.meta.url)))
  hash.update(readFileSync(new URL("./conversion-context.mjs", import.meta.url)))
  const baseline = join(p.run, "onepass-baseline.json")
  if (existsSync(baseline)) hash.update(readFileSync(baseline))
  return hash.digest("hex")
}
