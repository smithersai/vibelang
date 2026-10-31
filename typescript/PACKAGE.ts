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
  data: [Tsc.srcs, S.file("go.work"), S.file("//scripts/native-output.sh")],
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
  data: [Tsc.srcs, S.file("go.work"), S.file("//scripts/native-output.sh")],
  tools: [S.Host.bin("go")],
  outFiles: ["built/local/vibelang-forms"],
  sandbox: "none",
  timeout: "30m"
})

/** Every file in typescript/ outside its subpackages, for the repository-wide checks. */
const tree = S.Filegroup({ srcs: [...S.glob(["**"])] })

export const Package = S.Package({ targets: { compiler, tree, "forms-generator": formsGenerator } })
