import { Smithers as S } from "@smthrs/targets"

// The Go module: the TypeScript 7 compiler with VibeLang's packages under
// internal/vibelang*. `srcs` is everything `go build` reads, so it is the
// compiler binary's input; test files and testdata belong to the Go test
// targets and never re-key the binary.
const srcs = S.Filegroup({
  srcs: [
    S.file("go.mod"),
    S.file("go.sum"),
    ...S.glob(["**", "!**/*_test.go", "!**/testdata/**", "!go.mod", "!go.sum"])
  ]
})

/** Every file in the module, for checks that read the whole tree. */
const tree = S.Filegroup({ srcs: [...S.glob(["**"])] })

// One file group per Go package directory a test target covers: its tests and
// testdata. A `_test.go` edit re-keys only that package's test target.
const files = (dir: string) => S.Filegroup({ srcs: [S.glob(`${dir}/**`), S.glob("testdata/**")] })

// `go test` over one package pattern, keyed on the module's sources, that
// package's files and the `go` launcher. Go's own test cache in GOCACHE also
// replays unchanged packages inside a run.
const goTest = (summary: string, pkgs: string, dir: string) =>
  S.Shell.Test({
    summary,
    shell: "cd typescript/tsc && GOCACHE=$HOME/.cache/go-build-smthrs CGO_ENABLED=0 " +
      `go test -p 8 -timeout 25m -trimpath ${pkgs}`,
    data: [srcs, files(dir)],
    tools: [S.Host.bin("go")],
    sandbox: "none",
    timeout: "30m"
  })

export const Package = S.Package({
  targets: {
    srcs,
    tree,
    "effect-shim-files": files("internal/effecttsgo/shim/checker"),
    "vibelang-files": files("internal/vibelang"),
    "vibelangfuzz-files": files("internal/vibelangfuzz"),
    "vibelangmapper-files": files("internal/vibelangmapper"),
    "go-checker": goTest("Go tests of internal/checker.", "./internal/checker/...", "internal/checker"),
    "go-parser": goTest("Go tests of internal/parser.", "./internal/parser/...", "internal/parser"),
    "go-format": goTest("Go tests of internal/format.", "./internal/format/...", "internal/format"),
    "go-core": goTest("Go tests of internal/core.", "./internal/core/...", "internal/core")
  }
})
