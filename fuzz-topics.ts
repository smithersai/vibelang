import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

// The fuzz topics: the first word of each internal/vibelangfuzz/<topic>_*_test.go
// file name, mapped to the Fuzz functions those files declare. PACKAGE.ts
// declares //:go-vibelangfuzz-topic-<topic> from it, and the merge gate's
// selector (ls/gate-cases.sh) derives a topic from a changed file name the same
// way. The scan lives here so PACKAGE.ts stays free of filesystem reads.
const dir = join(dirname(fileURLToPath(import.meta.url)), "typescript/tsc/internal/vibelangfuzz")

export const fuzzTopics = new Map<string, Array<string>>()
for (const file of readdirSync(dir).filter((f) => /^[a-z0-9]+_[a-z0-9_]*_test\.go$/.test(f)).sort()) {
  const topic = file.slice(0, file.indexOf("_"))
  for (const m of readFileSync(join(dir, file), "utf8").matchAll(/^func (Fuzz[A-Za-z0-9_]+)\([A-Za-z0-9_]+ \*testing\.F\)/gm)) {
    fuzzTopics.set(topic, [...(fuzzTopics.get(topic) ?? []), m[1]])
  }
}
