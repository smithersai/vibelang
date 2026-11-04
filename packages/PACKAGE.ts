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
  summary: "Compile the runtime's sources to dist/ with the TypeScript its lockfile pins.",
  shell: "cd packages/runtime && rm -rf dist && bun run build",
  data: [...install, S.file("runtime/tsconfig.json"), S.glob("runtime/src/**")],
  tools: [S.Host.bin("bun")],
  outDirs: ["runtime/dist"],
  sandbox: "none",
  timeout: "10m"
})

const runtimeTest = S.Shell.Test({
  summary: "Run the runtime's bun tests against dist/.",
  shell: "cd packages/runtime && bun test --timeout 30000",
  data: [runtimeDist, ...install, S.file("runtime/tsconfig.json"), S.glob("runtime/src/**"), S.glob("runtime/tests/**"), S.file("//scripts/testing/property.mjs"), S.file("//docs/design/src/005-services.md"), S.file("//docs/design/src/001-functions.md")],
  tools: [S.Host.bin("bun"), S.Host.bin("node")],
  sandbox: "none",
  timeout: "15m"
})

// A small pre-merge check for package entrypoints, export identity and the Effect pin.
const runtimePackageTest = S.Shell.Test({
  summary: "Check the runtime package entries, ABI export identity and Effect version guard.",
  shell: "cd packages/runtime && bun test --timeout 30000 tests/package.test.ts tests/package-error-matcher.property.test.ts && cd ../.. && " +
    "node --test --test-name-pattern='runtime export table covers every built JavaScript root export' docs/tools/bugbash4-docs.test.mjs",
  data: [runtimeDist, ...install, S.glob("runtime/tests/**"), S.file("runtime/README.md"), S.file("//docs/tools/bugbash4-docs.test.mjs")],
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

const compilerTest = S.Shell.Test({
  summary: "The compiler package's node tests.",
  shell: "cd packages/compiler && bun install --frozen-lockfile && VIBELANG_BINARY=\"$PWD/native/vibelang\" node --test test/*.test.mjs",
  // Migration properties exercise the flow's package-export and Bun.build edits.
  // Their helpers and the TypeScript API install must enter the cache key too.
  data: [compilerNative, Tsc["go-vibelangfmt"], runtimeDist, S.glob("compiler/**"), migrationSources,
    S.file("//docs/tools/package.json"), S.file("//docs/tools/bun.lock"),
    S.file("//scripts/testing/property.mjs"), S.file("//docs/design/src/001-functions.md"), S.file("//docs/design/src/007-tooling.md"),
    S.file("vite/src/relative-imports.js"), S.file("vite/src/paths-imports.js"), S.file("unplugin/src/relative-imports.js"),
    S.file("//typescript/vibelang/lsp-format-shape.mjs"), S.file("//typescript/vibelang/lsp-connection.mjs"),
    S.file("//typescript/vibelang/lsp-framing.mjs"), ...install],
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
  tools: [S.Host.bin("node")],
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
    "cd ../../.smithers/flows && node --test " +
    "--test-reporter=spec --test-reporter-destination=stdout " +
    "--test-reporter=../../scripts/testing/migrate-progress.mjs --test-reporter-destination=stderr " +
    "migrate/test/*.test.mjs convert/*.test.mjs",
  data: [compilerNative, runtimeDist, S.glob("compiler/**"), migrationSources,
    S.file("//docs/tools/package.json"), S.file("//docs/tools/bun.lock"),
    S.file("//scripts/testing/property.mjs"), S.file("//scripts/testing/spec-path.mjs"), S.file("//scripts/testing/migrate-progress.mjs"), S.file("//docs/design/src/001-functions.md"), S.file("//docs/design/src/007-tooling.md"),
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
    "runtime-published": runtimePublished,
    "compiler-native": compilerNative,
    "migrate-toolchain-baseline": migrateToolchainBaseline,
    "compiler-test": compilerTest,
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
