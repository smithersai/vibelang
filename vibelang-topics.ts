import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

// The internal/vibelang test topics: the first word of each
// internal/vibelang/<topic>_test.go or <topic>_*_test.go file name, mapped to
// the Test functions those files declare. PACKAGE.ts declares
// //:go-vibelang-topic-<topic> from it, and the merge gate's selector
// (ls/gate-cases.sh) runs a topic when a change edits a source or test file of
// internal/vibelang that the topic names. c87f85092cc6 changed fix.go and
// tsforms_services.go, and main 0d0c6b46ee6e went RED post-merge on
// TestFixReachesFixedPoint (fix_fixedpoint_test.go) and
// TestTypeScriptFormCasesFix (tsforms_test.go): the gate ran no Go test of
// internal/vibelang. The scan lives here so PACKAGE.ts stays free of
// filesystem reads.
const dir = join(dirname(fileURLToPath(import.meta.url)), "typescript/tsc/internal/vibelang")

export const vibelangTopics = new Map<string, Array<string>>()
for (const file of readdirSync(dir).filter((f) => /^[a-z0-9]+(_[a-z0-9_]*)?_test\.go$/.test(f)).sort()) {
  const topic = file.slice(0, file.indexOf("_"))
  for (const m of readFileSync(join(dir, file), "utf8").matchAll(/^func (Test[A-Za-z0-9_]+)\([A-Za-z0-9_]+ \*testing\.T\)/gm)) {
    vibelangTopics.set(topic, [...(vibelangTopics.get(topic) ?? []), m[1]])
  }
}
