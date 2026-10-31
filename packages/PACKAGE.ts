import { Smithers as S } from "@smthrs/targets"
import { Package as Typescript } from "../typescript/PACKAGE.ts"

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
  shell: "cd packages/runtime && bun test",
  data: [runtimeDist, ...install, S.file("runtime/tsconfig.json"), S.glob("runtime/src/**"), S.glob("runtime/tests/**")],
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
  shell: "mkdir -p packages/compiler/native && cp typescript/built/local/tsc packages/compiler/native/vibelang && " +
    "packages/compiler/native/vibelang --write-dprint-plugin packages/compiler >/dev/null",
  data: [Typescript.compiler],
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
  data: [compilerNative, S.glob("compiler/**"), S.glob("//.smithers/flows/migrate/lib/**"),
    S.file("//scripts/testing/property.mjs"), S.file("//docs/design/src/007-tooling.md"),
    S.file("vite/src/relative-imports.js"), S.file("unplugin/src/relative-imports.js"), ...install],
  tools: [S.Host.bin("node"), S.Host.bin("bun")],
  sandbox: "none",
  timeout: "15m"
})

// The bundler plugins compile through vibelang/project and pass its source
// maps on, so a change to the compiler package reruns them. Each run.sh links
// this checkout's compiler into its fixtures and builds a private copy of the
// runtime's sources with the native compiler, under test/.fixtures: it never
// writes packages/runtime, which the runtime and compiler targets read.
const pluginTest = (name: string, summary: string, timeout: string) => S.Shell.Test({
  summary,
  shell: `VIBELANG_BINARY=$PWD/packages/compiler/native/vibelang sh packages/${name}/test/run.sh`,
  data: [compilerNative, S.glob("compiler/**"), S.glob(`${name}/**`), ...install, S.file("runtime/tsconfig.json"), S.glob("runtime/src/**")],
  tools: [S.Host.bin("node"), S.Host.bin("bun")],
  sandbox: "none",
  timeout
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
    "vite-test": viteTest,
    "unplugin-test": unpluginTest,
    tree
  }
})
