import { Smithers as S } from "@smthrs/targets"
import inventory from "./test-inventory.json" with { type: "json" }
import testGroups from "./test-groups.json" with { type: "json" }
import testBatches from "./test-batches.json" with { type: "json" }
import { nodeTestSelection } from "../scripts/testing/node-selection.mjs"
import { migrationSources } from "../migration-inputs.ts"
import { Package as Typescript } from "../typescript/PACKAGE.ts"
import { Package as Tsc } from "../typescript/tsc/PACKAGE.ts"

// The npm packages. vibelang-runtime's targets are declared here rather than
// in packages/runtime/PACKAGE.ts: smthrs refuses a declaration whose directory
// resolves `effect` to a copy other than the CLI's, and the runtime installs
// its own (docs/maintainers/build.md, "Known gaps").
//
// vibelang-runtime: node_modules is installed from bun.lock before smthrs runs
// (`bun install --frozen-lockfile`), so the lockfile is the install's identity
// and an input of every target that reads node_modules.
const install = [S.file("runtime/package.json"), S.file("runtime/bun.lock")]
const experimentInstall = [S.file("//experiments/package.json"), S.file("//experiments/bun.lock")]

const testLabel = (group: string, file: string) =>
  `${group}-test-${file.slice(file.lastIndexOf("/") + 1).replace(/\.test\.[^.]+$/, "").replace(/\./g, "-")}`

const testEntries = (group: string, files: readonly string[], build: (files: readonly string[], names?: readonly string[]) => ReturnType<typeof S.Shell.Test>) => {
  const selections = files.flatMap((file, index) => {
    const groups = testGroups[file as keyof typeof testGroups] as readonly (readonly string[])[] | undefined
    return (groups ?? [undefined]).map((names, part) => ({
      key: file + (groups ? `#${part + 1}` : ""),
      label: testLabel(group, file) + (groups ? `-${part + 1}` : ""), file, names, index
    }))
  })
  const byKey = new Map(selections.map(selection => [selection.key, selection]))
  const batches = testBatches[group as keyof typeof testBatches] as readonly (readonly string[])[]
  const grouped = new Set(batches.flat())
  return selections.flatMap(selection => {
    const batch = batches.find(batch => batch[0] === selection.key)
    if (grouped.has(selection.key) && !batch) return []
    const selected = (batch ?? [selection.key]).map(key => {
      const value = byKey.get(key)
      if (!value) throw new Error(`Unknown test selection: ${key}`)
      return value
    })
    if (selected.some(value => Boolean(value.names) !== Boolean(selected[0].names))) {
      throw new Error("A batch must use either complete files or named selections")
    }
    const selectedFiles = [...new Set(selected.map(value => value.file))]
    const names = selected[0].names ? selected.flatMap(value => [...value.names!]) : undefined
    return [[selection.label + (batch ? "-group" : ""), build(selectedFiles, names), selection.index] as const]
  })
}

// Production files and fixture helpers are shared inputs. Each leaf declares
// its selected assertion files. The inventory check rejects omissions and collisions.
const compilerSupport = S.Filegroup({
  srcs: [S.glob("compiler/**", { exclude: ["**/*.test.mjs"] })]
})

const runtimeDist = S.Shell.Build({
  summary: "Compile the runtime with its pinned TypeScript and verify Node's guarded entry preserves the ABI.",
  shell: "cd packages/runtime && rm -rf dist && bun run build && cd ../.. && node --test packages/runtime/tests/entry-exports.node.test.mjs",
  data: [...install, S.file("runtime/tsconfig.json"), S.glob("runtime/src/**"), S.file("runtime/tests/entry-exports.node.test.mjs")],
  tools: [S.Host.bin("bun"), S.Host.bin("node")],
  outDirs: ["runtime/dist"],
  sandbox: "none",
  timeout: "10m"
})

// Short assertions share bounded groups; helpers and corpus stay inputs.
const runtimeTest = (files: readonly string[]) => S.Shell.Test({
  summary: `Runtime: ${files.join(", ")}.`,
  shell: "cd packages/runtime && bun test --timeout 30000 --only-failures " + files.map(file => file.slice("runtime/".length)).join(" "),
  data: [runtimeDist, ...install, S.file("runtime/tsconfig.json"), S.glob("runtime/src/**"),
    ...files.map(file => S.file(file)), S.glob("runtime/tests/**", { exclude: ["**/*.test.*"] }),
    ...(files.includes("runtime/tests/readme-exports.test.ts") ? [S.file("runtime/README.md")] : []),
    ...(files.includes("runtime/tests/package-budget.test.ts") && !files.includes("runtime/tests/package.test.ts") ? [S.file("runtime/tests/package.test.ts")] : []),
    S.file("//scripts/testing/property.mjs"), S.file("//docs/design/src/005-services.md"), S.file("//docs/design/src/001-functions.md"),
    S.file("//experiments/tests/conformance/model-laws.ts"), S.file("//experiments/package.json"), S.file("//experiments/bun.lock")],
  tools: [S.Host.bin("bun"), S.Host.bin("node")],
  sandbox: "none",
  timeout: "8m"
})
const runtimeTestEntries = testEntries("runtime", inventory.runtime, runtimeTest)
const runtimeTests = S.Suite({ tests: runtimeTestEntries.map(([, target]) => target) })

const runtimeKernelContracts = S.Shell.Test({
  summary: "Runtime wrappers preserve full Exits, interruption masks and finalizer traces against Effect.",
  shell: "cd packages/runtime && bun test --timeout 60000 tests/kernel.property.test.ts",
  data: [runtimeDist, ...install, S.file("runtime/tests/kernel.property.test.ts"), S.file("runtime/tests/property-programs.ts"), S.glob("runtime/tests/property-regressions/**"), S.file("//scripts/testing/property.mjs"), S.file("//docs/design/history/src/217-part2-ch17-failures.md"), S.file("//docs/design/history/src/320-part3-ch20-machine.md")],
  tools: [S.Host.bin("bun"), S.Host.bin("node")],
  sandbox: "none",
  timeout: "2m"
})

const runtimeReadmeExports = S.Shell.Test({
  summary: "Every runtime package export is documented by its exact specifier.",
  shell: "cd packages/runtime && bun test --timeout 30000 tests/readme-exports.test.ts",
  data: [...install, S.file("runtime/README.md"), S.file("runtime/tests/readme-exports.test.ts"), S.glob("runtime/tests/readme-export-regressions/**")],
  tools: [S.Host.bin("bun")],
  sandbox: "none",
  timeout: "1m"
})

// A small pre-merge check for package entrypoints, export identity and the Effect pin.
const runtimePackageTest = S.Shell.Test({
  summary: "Check the runtime package entries, ABI export identity and Effect version guard.",
  shell: "cd packages/runtime && bun test --timeout 30000 tests/package.test.ts tests/package-error-matcher.property.test.ts && cd ../.. && " +
    "node --test --test-name-pattern='runtime export table covers every built JavaScript root export' docs/tools/bugbash4-docs.test.mjs",
  data: [runtimeDist, runtimeReadmeExports, ...install, S.glob("runtime/tests/**"), S.file("runtime/README.md"), S.file("//docs/tools/bugbash4-docs.test.mjs")],
  tools: [S.Host.bin("bun"), S.Host.bin("node")],
  sandbox: "none",
  timeout: "5m"
})

// The files the published package holds: what a case's node_modules copies.
const runtimePublished = S.Filegroup({ srcs: [S.file("runtime/package.json"), S.file("runtime/README.md"), S.file("runtime/LICENSE")] })

// The compiler npm package's native binary and dprint plugin, as
// scripts/build-vibelang.sh makes them: the compiler binary, copied.
const compilerNative = S.Shell.Build({
  summary: "Place the compiler binary and dprint plugin in packages/compiler.",
  shell: "sh scripts/native-output.sh copy packages/compiler/native/vibelang typescript/built/local/tsc && " +
    "packages/compiler/native/vibelang --write-dprint-plugin packages/compiler >/dev/null",
  data: [Typescript.compiler, S.file("//scripts/native-output.sh")],
  outDirs: ["compiler/native"],
  outFiles: ["compiler/dprint-plugin.json"],
  sandbox: "none",
  timeout: "5m"
})

// Compatibility suites keep a round-robin partition of test-inventory.json's order. New files are appended
// there, so no existing file changes partition. Leaves take up to about 150 s on a typical 4-vCPU box and
// box speed varies up to about 2.5x, hence the eight-minute deadlines.
const COMPILER_TEST_SHARDS = 4
const compilerTest = (files: readonly string[], names?: readonly string[]) => S.Shell.Test({
  summary: `Compiler package: ${files.join(", ")}.`,
  shell: "cd packages/compiler && VIBELANG_BINARY=\"$PWD/native/vibelang\" " +
    "node --test --test-concurrency=4 --test-reporter=../../scripts/testing/node-failures.mjs " + nodeTestSelection(names) + files.map(file => file.slice("compiler/".length)).join(" "),
  // Dependencies are provisioned before parallel targets start.
  data: [compilerNative, runtimeDist, compilerSupport, ...files.map(file => S.file(file)), ...experimentInstall, S.file("//scripts/testing/node-selection.mjs"),
    ...(files.includes("compiler/test/launcher-cancellation.test.mjs") ? [S.file("compiler/test/launcher.test.mjs")] : []),
    ...(files.includes("compiler/test/watch-intermediate.test.mjs") ? [S.file("compiler/test/watch-warning.test.mjs")] : []),
    ...(files.includes("compiler/test/migrate-inputs.test.mjs") ? [S.file("PACKAGE.ts"), S.file("test-inventory.json"), S.file("test-groups.json"), S.file("test-batches.json"), S.file("//scripts/testing/package-declarations.mjs")] : []), S.file("ts-mapper/prelude.d.ts"), S.file("//scripts/generate-projection-prelude.mjs"), migrationSources,
    S.file("//docs/tools/package.json"), S.file("//docs/tools/bun.lock"), S.file("//docs/tools/lint-code-assignments.json"),
    S.file("//scripts/testing/node-failures.mjs"), S.file("//scripts/testing/property.mjs"), S.file("//docs/design/src/001-functions.md"), S.file("//docs/design/src/004-match.md"), S.file("//docs/design/src/005-services.md"), S.file("//docs/design/src/007-tooling.md"),
    S.file("vite/src/relative-imports.js"), S.file("vite/src/paths-imports.js"), S.file("unplugin/src/relative-imports.js"),
    S.file("vite/src/vibe-directive.js"), S.file("unplugin/src/vibe-directive.js"),
    S.file("//typescript/vibelang/lsp-format-shape.mjs"), S.file("//typescript/vibelang/lsp-connection.mjs"),
    S.file("//typescript/vibelang/lsp-framing.mjs"),
    S.file("//docs/design/vips/0044-durable-values.md"),
    S.glob("//typescript/vibelang/cases/schema-durable-serialization/**"),
    S.file("//typescript/vibelang/cases/tsforms-schemas/main.vibe"),
    S.file("//typescript/vibelang/cases/tsforms-schemas-fixed/main.vibe"), ...install],
  tools: [S.Host.bin("node"), S.Host.bin("bun"), S.Host.bin("jj")],
  sandbox: "none",
  timeout: "8m"
})
const compilerTestEntries = testEntries("compiler", inventory.compiler, compilerTest)
const compilerSuite = (shard: number) => S.Suite({
  tests: [...compilerTestEntries.filter(([, , index]) => index % COMPILER_TEST_SHARDS === shard - 1).map(([, target]) => target),
    ...(shard === 1 ? [Tsc["go-vibelangfmt"]] : [])]
})

// The migrate and convert flows' tests stage this compiler and runtime as a
// toolchain. They ran inside //packages:compiler-test from 2026-11-02 00:58Z,
// which took that target from a 134 s to a 389 s median on cf pre-gate boxes,
// with six 15-minute timeouts; as their own target they run on another box.
// Isolated API workers made an exact Node 26 run take 37m, before restoring
// roughly 10m of previously failing property work. Bound the aggregate at 90m;
// leave all file selections, property samples and per-worker limits intact.
// //:migration-sources keys both flows; scripts/test-runners.test.mjs fails
// when a test file runs in no target.
const migrateLostWrapper = S.Shell.Test({
  summary: "Check wrapper loss against normal and scratch migration emission.",
  shell: "node --test .smithers/flows/migrate/test/lost-wrapper.test.mjs",
  data: [migrationSources, ...install],
  tools: [S.Host.bin("node"), S.Host.bin("jj")],
  sandbox: "none",
  timeout: "3m"
})

const migrateRecordProvenance = S.Shell.Test({
  summary: "Check producer provenance and final-byte rejection before recording migrations.",
  shell: "node --test --test-name-pattern='record rechecks final generated bytes' " +
    ".smithers/flows/migrate/test/onepass.test.mjs && " +
    "node --test .smithers/flows/migrate/test/source-digest.test.mjs",
  data: [migrationSources, ...install],
  tools: [S.Host.bin("node"), S.Host.bin("jj")],
  sandbox: "none",
  timeout: "3m"
})

const migrateWarningProvenance = S.Shell.Test({
  summary: "Check warning provenance and promoted errors through migration compile.",
  shell: "VIBELANG_COMPILER=$PWD/packages/compiler/native/vibelang node --test " +
    "--test-name-pattern='compile reads the codemod journal' .smithers/flows/migrate/test/global-error.property.test.mjs",
  data: [compilerNative, migrationSources, ...install],
  tools: [S.Host.bin("node"), S.Host.bin("jj")],
  sandbox: "none",
  timeout: "3m"
})

// Check the compiler's declaration model before a full migration suite is needed.
const migratePlainProbe = S.Shell.Test({
  summary: "Check plain-function model detection against generated contracts and the native compiler.",
  shell: "VIBELANG_BINARY=$PWD/packages/compiler/native/vibelang " +
    "EFFECT_NODE_MODULES=$PWD/experiments/node_modules node --test " +
    "--test-name-pattern='function-model|toolchain probe' " +
    ".smithers/flows/migrate/test/plain.test.mjs .smithers/flows/migrate/test/plain.property.test.mjs",
  data: [compilerNative, runtimeDist, migrationSources, ...install,
    S.file("//scripts/testing/spec-path.mjs"), S.file("//docs/design/src/001-functions.md"),
    S.file("//docs/design/vips/0027-declaration-output.md")],
  tools: [S.Host.bin("node")],
  sandbox: "none",
  timeout: "5m"
})

const migrateNativeLoadpaths = S.Shell.Test({
  summary: "Check migrated native load paths with the explicitly installed esbuild.",
  shell: "cd packages/compiler && bun install --frozen-lockfile && cd ../.. && " +
    "node --test .smithers/flows/migrate/test/native-loadpaths.property.test.mjs",
  data: [migrationSources, ...install, S.file("compiler/package.json"), S.file("compiler/bun.lock")],
  tools: [S.Host.bin("node"), S.Host.bin("bun"), S.Host.bin("jj")],
  sandbox: "none",
  timeout: "3m"
})

const migrateLoaderValidation = S.Shell.Test({
  summary: "Check loader validation receipts and their published contract.",
  shell: "node --test .smithers/flows/migrate/test/loader-validation.property.test.mjs",
  data: [migrationSources, ...install, S.file("//docs/user/src/setup/migrating-retired-forms.md")],
  tools: [S.Host.bin("node")],
  sandbox: "none",
  timeout: "2m"
})

const migrateTest = S.Shell.Test({
  summary: "The migrate and convert flows' tests.",
  shell: "cd docs/tools && bun install --frozen-lockfile && cd ../.. && " +
    "cd packages/compiler && bun install --frozen-lockfile && " +
    "cd test/eslint && bun install --frozen-lockfile && " +
    "cd ../../../../.smithers/flows && files=$(node ../../scripts/testing/migrate-slice.mjs migrate/test/*.test.mjs convert/*.test.mjs) && node --test " +
    "--test-reporter=../../scripts/testing/migrate-progress.mjs --test-reporter-destination=stderr $files",
  data: [compilerNative, runtimeDist, S.glob("compiler/**"), migrationSources,
    S.file("//docs/tools/package.json"), S.file("//docs/tools/bun.lock"),
    S.file("//scripts/testing/property.mjs"), S.file("//scripts/testing/spec-path.mjs"), S.file("//scripts/testing/migrate-progress.mjs"), S.file("//scripts/testing/migrate-slice.mjs"), S.file("//docs/design/src/001-functions.md"), S.file("//docs/design/src/007-tooling.md"),
    S.file("//docs/user/src/setup/migrating-retired-forms.md"),
    S.glob("vite/src/**"), S.glob("unplugin/src/**"), ...install],
  tools: [S.Host.bin("node"), S.Host.bin("bun"), S.Host.bin("jj")],
  sandbox: "none",
  timeout: "90m"
})

const migrateHelperIdentity = S.Shell.Test({
  summary: "Preserve authored helper declarations while accepting generated never contracts.",
  shell: "node --test --test-name-pattern='helper declaration identity' " +
    ".smithers/flows/migrate/test/source-child-vibe-module.property.test.mjs",
  data: [migrationSources, ...install],
  tools: [S.Host.bin("node")],
  sandbox: "none",
  timeout: "3m"
})

// The bundler plugins compile through vibelang/project and pass its source
// maps on, so a change to the compiler package reruns them. Each run.sh links
// this checkout's compiler into its fixtures and builds a private copy of the
// runtime's sources with the native compiler, under test/.fixtures: it never
// writes packages/runtime, which the runtime and compiler targets read.
// A compiler rule change can reject the code the migrate flow generates, and
// before this target only the full migrate-test (four shards, over twenty
// minutes) compiled it. This file compiles the generated source-child helper
// with the native compiler in about a minute, so any compiler change reruns it.
const migrateSourceChildNative = S.Shell.Test({
  summary: "Compile migrated source-child helpers with the native compiler.",
  shell: "cd packages/compiler && bun install --frozen-lockfile && cd ../.. && " +
    "node --test .smithers/flows/migrate/test/source-child-vibe-module.property.test.mjs",
  data: [compilerNative, runtimeDist, migrationSources, ...install, S.file("compiler/package.json"), S.file("compiler/bun.lock"),
    S.file("//docs/design/vips/0040-module-declarations.md")],
  tools: [S.Host.bin("node"), S.Host.bin("bun"), S.Host.bin("jj")],
  sandbox: "none",
  timeout: "4m"
})

// The Vite plugin vendors the compiler's alias resolver; only the full
// vite-test compared the two copies.
const vitePathsImportsCopy = S.Shell.Test({
  summary: "The Vite plugin's vendored alias resolver matches the compiler's.",
  shell: "node --test --test-name-pattern 'copy of paths-imports' packages/vite/test/paths.test.mjs",
  data: [S.glob("vite/src/**"), S.file("vite/test/paths.test.mjs"), S.file("vite/package.json"), S.file("compiler/paths-imports.mjs"), ...install],
  tools: [S.Host.bin("node")],
  sandbox: "none",
  timeout: "1m"
})

const migrateToolchainBaseline = S.Shell.Test({
  summary: "Reject toolchain regressions after valid target dependency probes.",
  shell: "node --test .smithers/flows/migrate/test/toolchain-baseline.property.test.mjs",
  data: [migrationSources, ...install],
  tools: [S.Host.bin("node"), S.Host.bin("jj")],
  sandbox: "none",
  timeout: "3m"
})

// Removing a rule from the specification breaks every migrate oracle quoting
// it, which only the full migrate-test run would otherwise report.
const migrateQuotedRules = S.Shell.Test({
  summary: "Every migrate corpus quote is text the specification or the flow still states.",
  shell: "node --test .smithers/flows/migrate/test/quoted-rules-exist.test.mjs",
  data: [migrationSources, S.glob("//docs/design/src/*.md"), S.glob("//docs/design/vips/*.md"), S.glob("//docs/user/src/setup/*.md")],
  tools: [S.Host.bin("node")],
  sandbox: "none",
  timeout: "1m"
})

// Prepare shared fixture inputs once. Test files create unique project
// directories; no leaf reinstalls packages or deletes a sibling's runtime.
const pluginPrepare = (name: string) => S.Shell.Build({
  summary: `Prepare ${name} fixtures.`,
  shell: `VIBELANG_TEST_PREPARE_ONLY=1 VIBELANG_BINARY=$PWD/packages/compiler/native/vibelang sh packages/${name}/test/run.sh`,
  data: [compilerNative, compilerSupport, S.file(`${name}/test/run.sh`), S.file(`${name}/package.json`),
    S.file(`${name}/bun.lock`), S.glob(`${name}/src/**`),
    S.file("//scripts/testing/prepare-package-tests.mjs"), S.file("//scripts/testing/package-fixtures.mjs"), ...experimentInstall, ...install, S.file("runtime/tsconfig.json"), S.glob("runtime/src/**")],
  outDirs: [`${name}/test/.prepared`],
  tools: [S.Host.bin("node"), S.Host.bin("bun")],
  sandbox: "none",
  timeout: "8m"
})
const vitePrepare = pluginPrepare("vite")
const unpluginPrepare = pluginPrepare("unplugin")
const pluginTest = (name: "vite" | "unplugin", files: readonly string[], names?: readonly string[]) => S.Shell.Test({
  summary: `${name}: ${files.join(", ")}.`,
  shell: `VIBELANG_BINARY=$PWD/packages/compiler/native/vibelang node scripts/testing/run-package-test.mjs ${name} ${files.join(" ")}` + (names ? " " + nodeTestSelection(names) : ""),
  data: [name === "vite" ? vitePrepare : unpluginPrepare, compilerNative, compilerSupport,
    ...files.map(file => S.file(file)), S.glob(`${name}/**`, { exclude: ["**/*.test.mjs"] }),
    S.file("//scripts/testing/run-package-test.mjs"), S.file("//scripts/testing/package-fixtures.mjs"),
    S.glob("vite/src/**"), S.file("vite/package.json"), S.file("vite/bun.lock"),
    S.glob("unplugin/src/**"), S.file("unplugin/package.json"), S.file("unplugin/bun.lock"),
    S.file("//scripts/testing/property.mjs"), S.file("//scripts/testing/spec-path.mjs"), S.file("//docs/design/src/007-tooling.md"),
    migrationSources, ...experimentInstall, ...install, S.file("runtime/tsconfig.json"), S.glob("runtime/src/**")],
  tools: [S.Host.bin("node"), S.Host.bin("bun")],
  sandbox: "none",
  timeout: "8m"
})
const viteTestEntries = testEntries("vite", inventory.vite, (files, names) => pluginTest("vite", files, names))
const unpluginTestEntries = testEntries("unplugin", inventory.unplugin, (files, names) => pluginTest("unplugin", files, names))
const viteTest = S.Suite({ tests: viteTestEntries.map(([, target]) => target) })
const unpluginTest = S.Suite({ tests: unpluginTestEntries.map(([, target]) => target) })

// scripts/ci.sh installs these pinned tools before the graph starts.
const compilerToolsPrepare = S.Filegroup({
  srcs: [S.file("compiler/test/tools/package.json"), S.file("compiler/test/tools/bun.lock")]
})
const compilerToolsTestEntries = testEntries("compiler-tools", inventory["compiler-tools"], (files, names) => S.Shell.Test({
  summary: `Compiler adapters: ${files.join(", ")}.`,
  shell: `VIBELANG_BINARY=$PWD/packages/compiler/native/vibelang node --test --test-concurrency=4 --test-timeout=300000 ` + nodeTestSelection(names) + files.map(file => "packages/" + file).join(" "),
  data: [compilerToolsPrepare, compilerNative, compilerSupport, ...files.map(file => S.file(file)),
    S.file("vite/package.json"), S.file("vite/bun.lock"), S.glob("vite/src/**"), migrationSources,
    S.file("//experiments/package.json"), S.file("//experiments/bun.lock")],
  tools: [S.Host.bin("node"), S.Host.bin("bun")],
  sandbox: "none",
  timeout: "8m"
}))
const compilerToolsTest = S.Suite({ tests: compilerToolsTestEntries.map(([, target]) => target) })

const sourceMapToolsPrepare = S.Shell.Build({
  summary: "Prepare source-map fixtures and generated fuzz programs.",
  shell: "VIBELANG_TEST_PREPARE_ONLY=1 VIBELANG_BINARY=$PWD/packages/compiler/native/vibelang sh packages/compiler/test/source-maps/run.sh",
  data: [compilerNative, compilerSupport, Tsc.srcs, S.file("//typescript/go.work"), ...experimentInstall,
    S.file("//scripts/testing/prepare-package-tests.mjs"), S.file("//scripts/testing/package-fixtures.mjs"),
    S.glob("vite/src/**"), S.glob("unplugin/src/**"), S.file("vite/package.json"), S.file("unplugin/package.json"),
    ...install, S.file("runtime/tsconfig.json"), S.glob("runtime/src/**")],
  outDirs: ["compiler/test/source-maps/.prepared"],
  tools: [S.Host.bin("node"), S.Host.bin("bun"), S.Host.bin("go")],
  sandbox: "none",
  timeout: "8m"
})
const sourceMapToolsTestEntries = testEntries("source-map-tools", inventory["source-map-tools"], (files, names) => S.Shell.Test({
  summary: `Source maps: ${files.join(", ")}.`,
  shell: `VIBELANG_BINARY=$PWD/packages/compiler/native/vibelang node scripts/testing/run-package-test.mjs source-map-tools ${files.join(" ")}` + (names ? " " + nodeTestSelection(names) : ""),
  data: [sourceMapToolsPrepare, compilerNative, compilerSupport, ...files.map(file => S.file(file)),
    S.file("//scripts/testing/run-package-test.mjs"), S.file("//scripts/testing/package-fixtures.mjs"),
    S.glob("vite/**", { exclude: ["**/*.test.mjs"] }), S.glob("unplugin/**", { exclude: ["**/*.test.mjs"] }),
    S.file("//scripts/testing/property.mjs"), S.file("//scripts/testing/spec-path.mjs"),
    S.file("//docs/design/src/005-services.md"), S.file("//docs/maintainers/source-maps.md"),
    S.file("//experiments/package.json"), S.file("//experiments/bun.lock"),
    S.file("//typescript/vibelang/lsp-connection.mjs"), S.file("//typescript/vibelang/lsp-framing.mjs"),
    ...install, S.file("runtime/tsconfig.json"), S.glob("runtime/src/**")],
  tools: [S.Host.bin("node"), S.Host.bin("bun"), S.Host.bin("go")],
  sandbox: "none",
  timeout: "8m"
}))
const sourceMapToolsTest = S.Suite({ tests: [compilerToolsTest, ...sourceMapToolsTestEntries.map(([, target]) => target)] })
// Runs tsc and the language server through the package as npm lays it out, and
// TypeScript's own VS Code discovery code against that layout.
const typescriptShimTestEntries = testEntries("typescript-shim", inventory["typescript-shim"], (files, names) => S.Shell.Test({
  summary: "vibelang-typescript: tsc, the language server and editor discovery of VibeLang in .ts files.",
  shell: `VIBELANG_BINARY=$PWD/packages/compiler/native/vibelang node --test --test-concurrency=4 ` + nodeTestSelection(names) + files.map(file => "packages/" + file).join(" "),
  data: [compilerNative, runtimeDist, compilerSupport, ...files.map(file => S.file(file)), ...experimentInstall, S.glob("typescript-shim/**", { exclude: ["**/*.test.mjs"] }), ...install,
    S.file("//typescript/vibelang/lsp-connection.mjs"), S.file("//typescript/vibelang/lsp-framing.mjs"),
    S.file("//typescript/packages/vscode-typescript/src/util.ts"), S.file("//typescript/packages/vscode-typescript/src/tsdkPackage.ts")],
  tools: [S.Host.bin("node"), S.Host.bin("bun")],
  sandbox: "none",
  timeout: "8m"
}))
const typescriptShimTest = S.Suite({ tests: typescriptShimTestEntries.map(([, target]) => target) })

// The tooling witness imports these adapters directly. Declare their globs
// here: workspace-rooted globs still respect the declaring package's boundary.
const toolingAdapterSources = S.Filegroup({
  srcs: [
    S.glob("compiler/*.mjs"),
    S.glob("vite/src/**"),
    S.file("vite/package.json"),
    S.file("vite/bun.lock")
  ]
})

/** Every file in the npm packages, for the repository-wide checks. */
const tree = S.Filegroup({ srcs: [...S.glob(["**"])] })

export const Package = S.Package({
  targets: {
    ...Object.fromEntries([...compilerTestEntries, ...runtimeTestEntries, ...viteTestEntries, ...unpluginTestEntries,
      ...compilerToolsTestEntries, ...sourceMapToolsTestEntries, ...typescriptShimTestEntries].map(([label, target]) => [label, target] as const)),
    "vite-test-prepare": vitePrepare,
    "unplugin-test-prepare": unpluginPrepare,
    "compiler-tools-test-prepare": compilerToolsPrepare,
    "source-map-tools-test-prepare": sourceMapToolsPrepare,
    "runtime-dist": runtimeDist,
    "runtime-test": runtimeTests,
    "runtime-package": runtimePackageTest,
    "runtime-kernel-contracts": runtimeKernelContracts,
    "runtime-readme-exports": runtimeReadmeExports,
    "runtime-published": runtimePublished,
    "compiler-native": compilerNative,
    "tooling-adapter-srcs": toolingAdapterSources,
    "migrate-toolchain-baseline": migrateToolchainBaseline,
    "migrate-quoted-rules": migrateQuotedRules,
    "compiler-test-1": compilerSuite(1),
    "compiler-test-2": compilerSuite(2),
    "compiler-test-3": compilerSuite(3),
    "compiler-test-4": compilerSuite(4),
    "migrate-helper-identity": migrateHelperIdentity,
    "migrate-source-child-native": migrateSourceChildNative,
    "vite-paths-imports-copy": vitePathsImportsCopy,
    "migrate-test": migrateTest,
    "migrate-lost-wrapper": migrateLostWrapper,
    "migrate-record-provenance": migrateRecordProvenance,
    "migrate-warning-provenance": migrateWarningProvenance,
    "migrate-plain-probe": migratePlainProbe,
    "migrate-native-loadpaths": migrateNativeLoadpaths,
    "migrate-loader-validation": migrateLoaderValidation,
    "compiler-tools-test": compilerToolsTest,
    "source-map-tools-test": sourceMapToolsTest,
    "vite-test": viteTest,
    "unplugin-test": unpluginTest,
    "typescript-shim-test": typescriptShimTest,
    tree
  }
})
