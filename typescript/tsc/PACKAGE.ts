import { readdirSync } from "node:fs"
import { Smithers as S } from "@smthrs/targets"

// Go tests retain all non-test sources, including the fuzz oracle helpers.
// Native executables never import internal/vibelangfuzz; its independent
// cache-input regression checks the real transitive Go dependency graph.
const sources = (exclude: ReadonlyArray<string> = []) => S.Filegroup({
  srcs: [
    S.file("go.mod"),
    S.file("go.sum"),
    ...S.glob(["**", "!**/*_test.go", "!**/testdata/**", "!go.mod", "!go.sum", ...exclude])
  ]
})
const srcs = sources()
// Decision snapshots are execution inputs, not Go embeds. The independent
// dependency audit rejects future imports or embeds of excluded inputs.
const nativeSrcs = sources([
  "!internal/vibelangfuzz/**",
  "!internal/vibelangmapper/forms_decisions.txt",
  "!internal/vibelangmapper/forms_decisions_approved.txt",
])

/** Every file in the module, for checks that read the whole tree. */
const tree = S.Filegroup({ srcs: [...S.glob(["**"])] })

// One file group per Go package directory a test target covers: its tests and
// testdata. A `_test.go` edit re-keys only that package's test target.
// Parser parity also reads its external corpus and the pinned stock diagnostics receipt.
const jsxClashInputs = S.Filegroup({
  srcs: [
    ...readdirSync(new URL("../vibelang/cases/vibex-clash/", import.meta.url))
      .sort()
      .map((name) => S.file("//typescript/vibelang/cases/vibex-clash/" + name))
  ]
})
const files = (dir: string) => S.Filegroup({
  srcs: [S.glob(`${dir}/**`), S.glob("testdata/**"), ...(dir === "internal/parser" ? [jsxClashInputs] : [])]
})

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
    "native-srcs": nativeSrcs,
    tree,
    "effect-shim-files": files("internal/effecttsgo/shim/checker"),
    "vibelang-files": files("internal/vibelang"),
    "vibelangfuzz-files": files("internal/vibelangfuzz"),
    "vibelangmapper-files": files("internal/vibelangmapper"),
    "go-vibelangestree": goTest("Go tests of VibeLang's ESLint tree exporter.", "./internal/vibelangestree/...", "internal/vibelangestree"),
    "go-vibelangfmt": goTest("Go tests of VibeLang's formatter and dprint packaging.", "./internal/vibelangfmt/...", "internal/vibelangfmt"),
    "go-ls": goTest("Go tests of the language service and VibeLang editor integration.", "./internal/ls/...", "internal/ls"),
    "go-checker": goTest("Go tests of internal/checker.", "./internal/checker/...", "internal/checker"),
    "go-parser": goTest("Go tests of internal/parser.", "./internal/parser/...", "internal/parser"),
    "go-format": goTest("Go tests of internal/format.", "./internal/format/...", "internal/format"),
    "go-vibelangfmt": goTest("Go tests of the VibeLang formatter.", "./internal/vibelangfmt/...", "internal/vibelangfmt"),
    "go-core": goTest("Go tests of internal/core.", "./internal/core/...", "internal/core"),
    "go-effectglobals": goTest(
      "Go tests of internal/effectglobals: the globals of a .vibe file match the installed effect/Effect.",
      "./internal/effectglobals/...",
      "internal/effectglobals"
    )
  }
})
