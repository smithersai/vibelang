import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

// The fuzz topics: the first word of each internal/vibelangfuzz/<topic>_*_test.go
// file name, mapped to the Fuzz and Test functions those files declare. A topic
// needs one Fuzz function; its Test functions run with its oracles because they
// break main the same way: 9 of the 24 vibelangfuzz functions that turned main
// RED post-merge from 10-31 to 11-02 were Test functions of a topic, among them
// TestDeclarationIdentityCanonicalization and TestDataCounterpartFoldkit on
// 2519454b6513. PACKAGE.ts
// declares //:go-vibelangfuzz-topic-<topic> from it, and the merge gate's
// selector (ls/gate-cases.sh) derives a topic from a changed file name the same
// way. The scan lives here so PACKAGE.ts stays free of filesystem reads.
const dir = join(dirname(fileURLToPath(import.meta.url)), "typescript/tsc/internal/vibelangfuzz")

export const fuzzTopics = new Map<string, Array<string>>()
for (const file of readdirSync(dir).filter((f) => /^[a-z0-9]+_[a-z0-9_]*_test\.go$/.test(f)).sort()) {
  const topic = file.slice(0, file.indexOf("_"))
  const source = readFileSync(join(dir, file), "utf8")
  for (const m of source.matchAll(/^func (Fuzz[A-Za-z0-9_]+\([A-Za-z0-9_]+ \*testing\.F|Test[A-Za-z0-9_]+\([A-Za-z0-9_]+ \*testing\.T)\)/gm)) {
    fuzzTopics.set(topic, [...(fuzzTopics.get(topic) ?? []), m[1].slice(0, m[1].indexOf("("))])
  }
}
for (const [topic, names] of fuzzTopics) {
  if (!names.some((name) => name.startsWith("Fuzz"))) fuzzTopics.delete(topic)
}
