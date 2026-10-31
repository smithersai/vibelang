import { readFileSync } from "node:fs"
import { Smithers as S } from "@smthrs/targets"
import { Package as Root } from "../../PACKAGE.ts"
import { Package as Packages } from "../../packages/PACKAGE.ts"
import { Package as Tsc } from "../../typescript/tsc/PACKAGE.ts"

// The selector and targets share one reviewed map. Each family runs saved
// seeds only, with a 90-second test deadline; admission/build have a separate
// outer budget. Whole-suite fuzzing remains a post-merge check.
const families = JSON.parse(readFileSync(new URL("map.json", import.meta.url), "utf8")) as
  Record<string, { paths: string[], tests: string[] }>
const targets = Object.fromEntries(Object.entries(families).map(([name, family]) => [name, S.Shell.Test({
  summary: "Changed-path fuzz seeds: " + name + ".",
  shell: "cd typescript/tsc && GOCACHE=$HOME/.cache/go-build-smthrs CGO_ENABLED=0 GOMAXPROCS=8 GOFLAGS=-p=8 " +
    "VIBELANG_FUZZ_REQUIRE=1 VIBELANG_FUZZ_HANG=60s EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules " +
    "go test -v -short -count=1 -timeout=90s -trimpath -run '^(" + family.tests.join("|") + ")$' ./internal/vibelangfuzz/",
  data: [Root.tree, Tsc.srcs, Tsc["vibelangfuzz-files"], Packages["runtime-dist"], S.file("map.json")],
  tools: [S.Host.bin("go"), S.Host.bin("node")],
  sandbox: "none",
  exclusive: true,
  timeout: "30m"
})]))

export const Package = S.Package({ targets })
