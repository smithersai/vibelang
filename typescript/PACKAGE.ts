import { Smithers as S } from "@smthrs/targets"
import { Package as Tsc } from "./tsc/PACKAGE.ts"

// The compiler binary every case, Go test and package test runs. It is keyed on
// the Go module's sources and the `go` launcher's bytes; go.mod's `go` line
// selects the toolchain release, which Go verifies against its checksum
// database. GOCACHE only speeds a rebuild: Go keys its own entries by content,
// so it is not an input.
const compiler = S.Shell.Build({
  summary: "Build the VibeLang compiler, typescript/built/local/tsc.",
  shell: "cd typescript/tsc && GOCACHE=$HOME/.cache/go-build-smthrs CGO_ENABLED=0 GOFLAGS=-trimpath " +
    "sh ../../scripts/native-output.sh build ../built/local/tsc ./cmd/tsc",
  data: [Tsc["native-srcs"], S.file("go.work"), S.file("//scripts/native-output.sh")],
  tools: [S.Host.bin("go")],
  outFiles: ["built/local/tsc"],
  sandbox: "none",
  timeout: "30m"
})

// Generation reads declarations and .vibe files at execution time, but this
// executable reads only compiler build inputs. Docs and tests must not rebuild it.
const formsGenerator = S.Shell.Build({
  summary: "Build the forms-table generator independently of its data inputs.",
  shell: "cd typescript/tsc && GOCACHE=$HOME/.cache/go-build-smthrs CGO_ENABLED=0 " +
    "sh ../../scripts/native-output.sh build ../built/local/vibelang-forms -p 8 -trimpath ./cmd/vibelang-forms",
  data: [Tsc["native-srcs"], S.file("go.work"), S.file("//scripts/native-output.sh")],
  tools: [S.Host.bin("go")],
  outFiles: ["built/local/vibelang-forms"],
  sandbox: "none",
  timeout: "30m"
})

// The mapper's Go tests run the mapper CLI and compile a runtime copy with the
// compiler. Both executables are built here from the compiler build inputs, so
// a test run links neither: //:go-vibelangmapper hands them to the tests
// through VIBELANG_MAPPER_TEST_TSC and VIBELANG_MAPPER_TEST_MAPPER
// (internal/vibelangmapper/scope_test.go). A plain `go test` still links its own.
const mapper = S.Shell.Build({
  summary: "Build the TypeScript mapper CLI, typescript/built/local/vibelang-mapper.",
  shell: "cd typescript/tsc && GOCACHE=$HOME/.cache/go-build-smthrs CGO_ENABLED=0 " +
    "go build -p 8 -trimpath -o ../built/local/vibelang-mapper ./cmd/vibelang-mapper",
  data: [Tsc["native-srcs"], S.file("go.work")],
  tools: [S.Host.bin("go")],
  outFiles: ["built/local/vibelang-mapper"],
  sandbox: "none",
  timeout: "30m"
})

// Keep the real cache-key fixture out of the every-change release suite:
// only build declarations and SDK inputs can change its cache-key fixtures.
const nativeInputs = S.Shell.Test({
  summary: "Check native cache isolation and production dependency coverage.",
  shell: "node --test typescript/native-inputs.test.mjs",
  data: [
    S.file("tsc/PACKAGE.ts"), S.file("go.work"), S.file("PACKAGE.ts"), S.file("native-inputs.test.mjs"),
    S.file("//.smithers/WORKSPACE.ts"), S.file("//.smithers/package.json"), S.file("//.smithers/bun.lock"),
    S.file("//scripts/native-output.sh")
  ],
  tools: [S.Host.bin("node"), S.Host.bin("go"), S.Host.bin("bun")],
  sandbox: "none",
  timeout: "10m"
})

// This cheap audit follows production edits without rerunning SDK fixtures.
const nativeDeps = S.Shell.Test({
  summary: "Reject native executable imports of excluded fuzz packages.",
  shell: "node --test typescript/native-deps.test.mjs",
  data: [Tsc["native-srcs"], S.file("go.work"), S.file("native-deps.test.mjs")],
  tools: [S.Host.bin("node"), S.Host.bin("go")],
  sandbox: "none",
  timeout: "10m"
})

/** Every file in typescript/ outside its subpackages, for the repository-wide checks. */
const tree = S.Filegroup({ srcs: [...S.glob(["**"])] })

export const Package = S.Package({ targets: { compiler, mapper, tree, "forms-generator": formsGenerator, "native-inputs": nativeInputs, "native-deps": nativeDeps } })
