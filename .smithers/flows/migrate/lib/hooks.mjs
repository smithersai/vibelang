import { join } from "node:path"
import { appendJsonl, must } from "./util.mjs"
/** Repo adapters own generated bundles and build-graph paths; the flow owns receipts. */
export async function regenerate(config, p, stage) {
  const receipts = []
  for (const [i, command] of (config.afterConvert ?? []).entries()) {
    const log = join(p.run, "hooks", stage + "-" + i + ".log")
    const result = await must(command, { cwd: config.target, log, env: { VIBELANG_RUN: p.run, VIBELANG_STAGE: stage } })
    const receipt = { stage, command, code: result.code, ms: result.ms, log }
    appendJsonl(join(p.run, "hooks.jsonl"), receipt); receipts.push(receipt)
  }
  return receipts
}
