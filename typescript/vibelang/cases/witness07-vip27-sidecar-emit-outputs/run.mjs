// Compatibility sidecars (.d.vibe.ts, .d.vibex.ts) are emit outputs exactly as
// a native .d.ts is: discovered pairs select the source and regenerate the
// sidecar; explicitly listed pairs keep it as an input (TS5055, exit 1,
// unchanged bytes), beside the source and under vibe.sidecarDir, and the
// required write still runs under noEmit and declaration: false.
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

// run-seconds: 600
const root = fileURLToPath(new URL("../../../", import.meta.url))
const binary = process.env.VIBELANG_BINARY || path.join(root, "built/local/tsc")
fs.mkdirSync(new URL("./out/", import.meta.url), { recursive: true })
const scratch = fs.mkdtempSync(fileURLToPath(new URL("./out/sidecars-", import.meta.url)))
const original = "// hand-written declaration\r\nexport declare const original: unique symbol;\r\n"
const fresh = "export declare const value = 42;\n"
const twins = { vibe: "ts", vibex: "tsx" }

function compile({ extension, layout, selection, options = {}, outDir }) {
  const dir = fs.mkdtempSync(path.join(scratch, extension + "-"))
  const vibe = extension in twins
  const source = "src/main." + extension
  const leaf = vibe ? "main.d." + extension + ".ts" : "main.d.ts"
  const declaration = path.posix.join(layout === "beside" ? "" : layout, "src", leaf)
  const write = (name, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true })
    fs.writeFileSync(path.join(dir, name), text)
  }
  write(source, "export const value = 42\n")
  write(declaration, original)
  const config = {
    compilerOptions: {
      target: "ESNext", module: "ESNext", jsx: "preserve", declaration: true, types: [], skipLibCheck: true, rootDir: ".",
      ...(outDir ? { outDir } : {}), ...options,
      ...(layout !== "beside" && !vibe ? { declarationDir: layout } : {}),
    },
    vibe: { effectGlobals: false, effectModules: false, ...(layout !== "beside" && vibe ? { sidecarDir: layout } : {}) },
    ...(selection === "files" ? { files: [source, declaration] } : selection === "include" ? { include: ["**/*"] } : {}),
  }
  write("tsconfig.json", JSON.stringify(config))
  const run = spawnSync(binary, ["-p", dir, "--pretty", "false"], { encoding: "utf8", timeout: 30000 })
  assert.ifError(run.error)
  const output = run.stdout + run.stderr
  return {
    observed: {
      exit: run.status,
      codes: [...output.matchAll(/(?:error|warning) ((?:TS|EK)\d+):/g)].map(m => m[1]).sort(),
      bytes: fs.readFileSync(path.join(dir, declaration), "utf8"),
    },
    exists: name => fs.existsSync(path.join(dir, name)),
    output,
  }
}

try {
  for (const [extension, native] of Object.entries(twins)) {
    for (const layout of ["beside", ".vibe/declarations"]) {
      for (const selection of ["default", "include", "files"]) {
        const label = `${extension}/${layout}/${selection}`
        const explicit = selection === "files"
        const reference = compile({ extension: native, layout, selection }).observed

        // rule-evidence: docs/design/vips/0027-declaration-output.md#prior-art | **Amended 2026-11-01: a sidecar is an emit output.** Discovery through `include` or default globs selects the source and omits its compatibility declaration, as native `.ts`/`.d.ts` discovery does.
        // rule-evidence: docs/design/vips/0027-declaration-output.md#amendment-native-overwrite-protection-2026-11-02 | An `include` source/sidecar pair selects the source and allows silent regeneration.
        // rule-evidence: docs/design/vips/0027-declaration-output.md#prior-art | A declaration explicitly selected in `files` remains an input: an attempted compatibility write over it reports `TS5055`, exits `1`, and leaves its bytes unchanged.
        // rule-evidence: docs/design/vips/0027-declaration-output.md#amendment-native-overwrite-protection-2026-11-02 | Explicit `files` inputs retain native `TS5055` protection: exit `1` and unchanged declaration bytes, including under `vibe.sidecarDir`.
        assert.deepEqual(reference, explicit
          ? { exit: 1, codes: ["TS5055"], bytes: original }
          : { exit: 0, codes: [], bytes: fresh }, label + ": native " + native + " reference")

        // rule-evidence: docs/design/vips/0027-declaration-output.md#amendment-native-overwrite-protection-2026-11-02 | Decided detail 281 replaces detail 280: compatibility sidecars are emit outputs like `.d.ts`.
        // rule-evidence: docs/design/vips/0027-declaration-output.md#prior-art | This includes `.d.vibex.ts` and mapped sidecar locations.
        const sidecar = compile({ extension, layout, selection })
        assert.deepEqual(sidecar.observed, reference, label + ": sidecar differs from native .d.ts\n" + sidecar.output)

        // rule-evidence: docs/design/vips/0027-declaration-output.md#prior-art | VIP-27's independent compatibility write still runs under `noEmit: true` and `declaration: false`; those options retain their ordinary JavaScript/public-declaration output controls.
        for (const options of [{ noEmit: true }, { declaration: false }, { noEmit: true, declaration: false }]) {
          const what = label + " " + JSON.stringify(options)
          const flagged = compile({ extension, layout, selection, options, outDir: "out" })
          assert.deepEqual(flagged.observed, reference, what + ": the required compatibility write and its overwrite check\n" + flagged.output)
          const js = extension === "vibex" ? "out/src/main.jsx" : "out/src/main.js"
          assert.equal(flagged.exists(js), !options.noEmit, what + ": ordinary JavaScript follows noEmit")
          assert.equal(flagged.exists("out/src/main.d.ts"), false, what + ": public declarations follow noEmit and declaration")
        }
      }
    }
  }
  console.log("sidecars are emit outputs")
} finally {
  fs.rmSync(scratch, { recursive: true, force: true })
}
