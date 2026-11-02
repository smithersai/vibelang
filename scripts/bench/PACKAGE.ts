import { Smithers as S } from "@smthrs/targets"
import { Package as Packages } from "../../packages/PACKAGE.ts"

export const Package = S.Package({ targets: {
  synthetic: S.Shell.Test({
    summary: "Both synthetic benchmark languages compile and run equivalently across project shapes and fan-in boundaries.",
    shell: "SYNTHETIC_REQUIRE=1 node --test scripts/bench/gen-synthetic.test.mjs",
    data: [
      Packages["compiler-native"], Packages["runtime-dist"], Packages["runtime-published"],
      S.file("//experiments/package.json"), S.file("//experiments/bun.lock"),
      S.file("gen-synthetic.mjs"), S.file("gen-synthetic.test.mjs"),
      S.file("//packages/compiler/package.json"), S.file("//packages/compiler/bun.lock"),
      S.file("//scripts/testing/property.mjs")
    ],
    tools: [S.Host.bin("node")],
    sandbox: "none",
    timeout: "5m"
  })
} })
