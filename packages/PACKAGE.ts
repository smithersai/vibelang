import { Smithers as S } from "@smthrs/targets"
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

const runtimeDist = S.Shell.Build({
  summary: "Compile the runtime with its pinned TypeScript and verify Node's guarded entry preserves the ABI.",
  shell: "cd packages/runtime && rm -rf dist && bun run build && cd ../.. && node --test packages/runtime/tests/entry-exports.node.test.mjs",
  data: [...install, S.file("runtime/tsconfig.json"), S.glob("runtime/src/**"), S.file("runtime/tests/entry-exports.node.test.mjs")],
  tools: [S.Host.bin("bun"), S.Host.bin("node")],
  outDirs: ["runtime/dist"],
  sandbox: "none",
  timeout: "10m"
})

const runtimeTest = S.Shell.Test({
  summary: "Run the runtime's bun tests against dist/.",
  // Keep failures visible within the graph preview even after hundreds of passing tests.
  shell: "cd packages/runtime && bun test --timeout 30000 --only-failures",
  data: [runtimeDist, ...install, S.file("runtime/tsconfig.json"), S.glob("runtime/src/**"), S.glob("runtime/tests/**"), S.file("//scripts/testing/property.mjs"), S.file("//docs/design/src/005-services.md"), S.file("//docs/design/src/001-functions.md")],
  tools: [S.Host.bin("bun"), S.Host.bin("node")],
  sandbox: "none",
  timeout: "15m"
})

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

// The compiler package's node tests run in COMPILER_TEST_SHARDS targets split by file (node --test-shard), each on its
// own box. One target took over its 15-minute timeout on a post-merge box (failed 901.3s), and a gate that ran out of
// time before it finished could not land anything that changed the compiler package. scripts/test-runners.test.mjs
// checks that every shard exists and that together they cover test/*.test.mjs.
const COMPILER_TEST_SHARDS = 4
const compilerTest = (shard: number) => S.Shell.Test({
  summary: `The compiler package's node tests, shard ${shard} of ${COMPILER_TEST_SHARDS}.`,
  // scripts/ci.sh provisions dependencies before parallel targets start.
  // Reinstalling here races sibling shards while Bun replaces package executables.
  shell: "cd packages/compiler && VIBELANG_BINARY=\"$PWD/native/vibelang\" " +
    `node --test --test-reporter=../../scripts/testing/node-failures.mjs --test-shard=${shard}/${COMPILER_TEST_SHARDS} test/*.test.mjs`,
  // Migration properties exercise the flow's package-export and Bun.build edits.
  // Their helpers and the TypeScript API install must enter the cache key too.
  // Shard 1 carries the edge to the formatter's Go tests, so a compiler gate still selects them
  // (scripts/compiler-formatter-gate.test.mjs). They write no output the node tests read, and in every shard they cost
  // 206-297 s of a box before the tests start (measured 2026-11-04).
  data: [compilerNative, ...(shard === 1 ? [Tsc["go-vibelangfmt"]] : []), runtimeDist, S.glob("compiler/**"), migrationSources,
    S.file("//docs/tools/package.json"), S.file("//docs/tools/bun.lock"),
    S.file("//scripts/testing/node-failures.mjs"), S.file("//scripts/testing/property.mjs"), S.file("//docs/design/src/001-functions.md"), S.file("//docs/design/src/004-match.md"), S.file("//docs/design/src/005-services.md"), S.file("//docs/design/src/007-tooling.md"),
    S.file("vite/src/relative-imports.js"), S.file("vite/src/paths-imports.js"), S.file("unplugin/src/relative-imports.js"),
    S.file("vite/src/vibe-directive.js"), S.file("unplugin/src/vibe-directive.js"),
    S.file("//typescript/vibelang/lsp-format-shape.mjs"), S.file("//typescript/vibelang/lsp-connection.mjs"),
    S.file("//typescript/vibelang/lsp-framing.mjs"),
    S.file("//typescript/vibelang/cases/tsforms-schemas/main.vibe"),
    S.file("//typescript/vibelang/cases/tsforms-schemas-fixed/main.vibe"), ...install],
  tools: [S.Host.bin("node"), S.Host.bin("bun"), S.Host.bin("jj")],
  sandbox: "none",
  timeout: "15m"
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
  shell: "cd packages/compiler && bun install --frozen-lockfile && " +
    "cd ../../.smithers/flows && files=$(node ../../scripts/testing/migrate-slice.mjs migrate/test/*.test.mjs convert/*.test.mjs) && node --test " +
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
const migrateToolchainBaseline = S.Shell.Test({
  summary: "Reject toolchain regressions after valid target dependency probes.",
  shell: "node --test .smithers/flows/migrate/test/toolchain-baseline.property.test.mjs",
  data: [migrationSources, ...install],
  tools: [S.Host.bin("node"), S.Host.bin("jj")],
  sandbox: "none",
  timeout: "3m"
})

const pluginTest = (name: string, summary: string, timeout: string) => S.Shell.Test({
  summary,
  shell: `VIBELANG_BINARY=$PWD/packages/compiler/native/vibelang sh packages/${name}/test/run.sh`,
  data: [compilerNative, S.glob("compiler/**"), S.glob(`${name}/**`),
    S.file("//scripts/testing/property.mjs"), S.file("//scripts/testing/spec-path.mjs"), S.file("//docs/design/src/007-tooling.md"),
    migrationSources,
    ...install, S.file("runtime/tsconfig.json"), S.glob("runtime/src/**")],
  tools: [S.Host.bin("node"), S.Host.bin("bun")],
  sandbox: "none",
  timeout
})
// vibelang/metro, vibelang/babel and vibelang/emit against the tools they
// adapt, at the versions test/tools/package.json pins.
const compilerToolsTest = S.Shell.Test({
  summary: "vibelang/metro, vibelang/babel and vibelang/emit against Metro, Babel, the React Compiler and Oxc.",
  shell: "VIBELANG_BINARY=$PWD/packages/compiler/native/vibelang sh packages/compiler/test/tools/run.sh",
  // The migrate flow patches oxc-transform-react with lib/react-tools.mjs; one test applies it to the real package.
  data: [compilerNative, S.glob("compiler/**"), S.glob("vite/src/**"), migrationSources, S.file("//experiments/package.json"), S.file("//experiments/bun.lock")],
  tools: [S.Host.bin("node"), S.Host.bin("bun")],
  sandbox: "none",
  timeout: "10m"
})
const viteTest = pluginTest("vite", "vibelang-vite's node tests: Vite and Vitest builds, source maps and watch.", "15m")
const unpluginTest = pluginTest("unplugin", "vibelang-unplugin's node tests: each bundler's build, source maps and watch.", "20m")

/** Every file in the npm packages, for the repository-wide checks. */
const tree = S.Filegroup({ srcs: [...S.glob(["**"])] })

export const Package = S.Package({
  targets: {
    "runtime-dist": runtimeDist,
    "runtime-test": runtimeTest,
    "runtime-package": runtimePackageTest,
    "runtime-kernel-contracts": runtimeKernelContracts,
    "runtime-readme-exports": runtimeReadmeExports,
    "runtime-published": runtimePublished,
    "compiler-native": compilerNative,
    "migrate-toolchain-baseline": migrateToolchainBaseline,
    "compiler-test-1": compilerTest(1),
    "compiler-test-2": compilerTest(2),
    "compiler-test-3": compilerTest(3),
    "compiler-test-4": compilerTest(4),
    "migrate-helper-identity": migrateHelperIdentity,
    "migrate-test": migrateTest,
    "migrate-lost-wrapper": migrateLostWrapper,
    "migrate-record-provenance": migrateRecordProvenance,
    "migrate-warning-provenance": migrateWarningProvenance,
    "migrate-plain-probe": migratePlainProbe,
    "migrate-native-loadpaths": migrateNativeLoadpaths,
    "migrate-loader-validation": migrateLoaderValidation,
    "compiler-tools-test": compilerToolsTest,
    "vite-test": viteTest,
    "unplugin-test": unpluginTest,
    tree
  }
})
