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
  shell: "cd packages/compiler && bun install --frozen-lockfile && node --test test/*.test.mjs",
  // Migration properties exercise the flow's package-export and Bun.build edits.
  // Their helpers and the TypeScript API install must enter the cache key too.
  data: [compilerNative, Tsc["go-vibelangfmt"], runtimeDist, S.glob("compiler/**"), migrationSources,
    S.file("//docs/tools/package.json"), S.file("//docs/tools/bun.lock"),
    S.file("//scripts/testing/property.mjs"), S.file("//docs/design/src/001-functions.md"), S.file("//docs/design/src/007-tooling.md"),
    S.file("vite/src/relative-imports.js"), S.file("vite/src/paths-imports.js"), S.file("unplugin/src/relative-imports.js"),
    S.file("//typescript/vibelang/lsp-format-shape.mjs"), ...install],
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
    S.glob("vite/src/**"), S.glob("unplugin/src/**"), ...install],
  tools: [S.Host.bin("node"), S.Host.bin("bun"), S.Host.bin("jj")],
  sandbox: "none",
  timeout: "90m"
})

// The bundler plugins compile through vibelang/project and pass its source
// maps on, so a change to the compiler package reruns them. Each run.sh links
// this checkout's compiler into its fixtures and builds a private copy of the
// runtime's sources with the native compiler, under test/.fixtures: it never
// writes packages/runtime, which the runtime and compiler targets read.
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
    "runtime-published": runtimePublished,
    "compiler-native": compilerNative,
    "compiler-test": compilerTest,
    "migrate-test": migrateTest,
    "compiler-tools-test": compilerToolsTest,
    "vite-test": viteTest,
    "unplugin-test": unpluginTest,
    tree
  }
})
