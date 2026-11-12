// The compatibility suite owns both complete globs. A file is one independently
// schedulable check; adding a file automatically adds its target.
import { globSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

export const flowRoot = fileURLToPath(new URL("../../.smithers/flows/", import.meta.url))
export const migrateTestGlobs = ["migrate/test/*.test.mjs", "convert/*.test.mjs"]
export const migrateTestFiles = () => globSync(migrateTestGlobs, { cwd: flowRoot }).sort()
export const migrateDedicated = {
  "migrate/test/source-child-vibe-module.property.test.mjs": "migrate-source-child-native",
  "migrate/test/toolchain-baseline.property.test.mjs": "migrate-toolchain-baseline",
  "migrate/test/quoted-rules-exist.test.mjs": "migrate-quoted-rules",
}
// Exact positive patterns avoid matching Node's enclosing file test.
export const migrateNamePartitions = {
  "migrate/test/mts-declarations.property.test.mjs": "mts pairing preserves API identity across paths and harmless printing changes",
  "migrate/test/deep-declarations.property.test.mjs": "property: consumer-reachable deep declarations retain exported types and JSDoc, with and without a root entry",
  "migrate/test/implicit-root-context.property.test.mjs": "property: implicit-root output contexts survive nested sources and independent prefixes",
  "migrate/test/sidecar-vibe-import.property.test.mjs": "foldkit-161: every neighbour spelling and import form compares the API",
  "migrate/test/record-verification.property.test.mjs": "foldkit-13-record: generated signature names retain API gating and final token receipts",
  "migrate/test/ambient-roots.property.test.mjs": "handwritten-root resolution follows TypeScript file-before-directory priority and preserves APIs",
  "migrate/test/published-specifiers.property.test.mjs": "published-specifier-equivalence: renamed spellings pass and are listed; semantic or invalid-declaration mutations fail",
}
export const migrateParallelFiles = [...Object.keys(migrateNamePartitions).filter(file => file !== "migrate/test/implicit-root-context.property.test.mjs"), "migrate/test/earlier-declarations.property.test.mjs", "migrate/test/public-declarations.property.test.mjs"]
export const migrateComputedNames = {
  "migrate/test/implicit-root-context.property.test.mjs": "(?:native|stock|explicit) output context preserves .* API results"
}
export const migrateGroupedFiles = {
  "migrate/test/node-ambient-context.property.test.mjs": 4,
  "migrate/test/oracle-gate.test.mjs": 3,
  "migrate/test/earlier-declarations.property.test.mjs": 6,
  "migrate/test/public-declarations.property.test.mjs": 4,
  "migrate/test/private-declarations.property.test.mjs": 6,
  "migrate/test/ambient-roots.property.test.mjs": 4,
  "migrate/test/oracle.test.mjs": 8,
}
const samplePropertyNames = {
  "migrate/test/oracle-gate.test.mjs": "generated stock-oracle gates distinguish shipped declarations from source-only packages",
  "migrate/test/private-declarations.property.test.mjs": "only the boolean private true exempts declaration identity across declaration changes",
  "migrate/test/oracle.test.mjs": "property: equivalent spelling proves the API, while type, documentation or file changes invalidate its comparison closure",
  "migrate/test/node-ambient-context.property.test.mjs": "property: configured ambient contexts preserve identity and expose real type changes",
  "migrate/test/earlier-declarations.property.test.mjs": "foldkit-11: setup reports exactly the earlier declarations whose members a new toolchain changes",
  "migrate/test/public-declarations.property.test.mjs": "public declaration graph: imports, exports, import types, require and references expose transitive additions",
  "migrate/test/ambient-roots.property.test.mjs": "handwritten-root resolution follows TypeScript file-before-directory priority and preserves APIs",
}
export function splitSlowMigration(shard, readSource) {
  if (!Object.hasOwn(migrateGroupedFiles, shard.file)) return [shard]
  const text = readSource(shard.file)
  const names = [...text.matchAll(/^test\(("(?:[^"\\]|\\.)*")/gm)].map(match => JSON.parse(match[1]))
  if (shard.file.endsWith("node-ambient-context.property.test.mjs")) {
    const layout = /const layouts = (\[[^\n]+\])/.exec(text)
    if (!layout) throw new Error("missing ambient layout inventory")
    names.push(...JSON.parse(layout[1]).map(layout => "configured Node types retain self-comparison and snapshot identity: " + layout))
  }
  const selected = names.filter(name => !shard.namePattern || new RegExp(shard.namePattern).test(name))
  if (!selected.length) throw new Error("empty migration name partition: " + shard.label)
  const parts = selected.flatMap((name, index) => {
    const count = name === samplePropertyNames[shard.file] ? migrateGroupedFiles[shard.file] : 1
    const base = { ...shard, compatibilityLabel: shard.label,
      namePattern: "^" + escapeRegExp(name) + "$", label: shard.label + "-group-" + String(index + 1).padStart(2, "0") }
    return count > 1 ? Array.from({ length: count }, (_, i) => ({
      ...base, label: base.label + "-samples-" + (i + 1), propertySlice: (i + 1) + "/" + count
    })) : [base]
  })
  const samples = parts.filter(part => part.propertySlice)
  const controls = parts.filter(part => !part.propertySlice)
  const grouped = []
  for (let at = 0; at < controls.length; at += 3) {
    const batch = controls.slice(at, at + 3)
    grouped.push({ ...batch[0], namePattern: batch.map(part => part.namePattern).join("|") })
  }
  return [...samples, ...grouped]
}
const escapeRegExp = value => RegExp.escape(value)
export function migrateShards(files = migrateTestFiles(), readSource = file => readFileSync(flowRoot + file, "utf8")) {
  const shards = files.filter(file => !Object.hasOwn(migrateDedicated, file)).flatMap(file => {
    const label = "migrate-test-" + file.replace(/^migrate\/test\//, "").replace(/^convert\//, "convert-").replace(/\.test\.mjs$/, "").replaceAll(".", "-")
    const name = migrateNamePartitions[file]
    if (!name) return [{ label, file, parallel: migrateParallelFiles.includes(file) }]
    const names = [...readSource(file).matchAll(/^test\(("(?:[^"\\]|\\.)*")/gm)].map(match => JSON.parse(match[1]))
    if (!names.includes(name)) throw new Error("missing generated property name: " + file)
    const controls = names.filter(other => other !== name)
    if (!controls.length) throw new Error("missing control tests: " + file)
    return [
      { label: label + "-generated", file, namePattern: "^" + escapeRegExp(name) + "$", parallel: migrateParallelFiles.includes(file) },
      { label: label + "-controls", file, namePattern: "^(?:" + [...controls.map(escapeRegExp), ...(migrateComputedNames[file] ? [migrateComputedNames[file]] : [])].join("|") + ")$", parallel: migrateParallelFiles.includes(file) },
    ]
  })
  const expanded = shards.flatMap(shard => splitSlowMigration(shard, readSource))
  const labels = expanded.map(shard => shard.label)
  if (new Set(labels).size !== labels.length) throw new Error("duplicate migration shard labels")
  if (new Set(files).size !== files.length) throw new Error("duplicate migration test files")
  return expanded
}
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'"
export const migrateShardShell = shard => "cd .smithers/flows && " +
  (shard.propertySlice ? "VIBELANG_PROPERTY_SLICE=" + shard.propertySlice + " FC_SEED=27121 " : "") + "node --test " +
  "--test-reporter=../../scripts/testing/migrate-progress.mjs --test-reporter-destination=stderr " +
  (shard.namePattern ? "--test-name-pattern=" + quote(shard.namePattern) + " " : "") + quote(shard.file)
