import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { command, defaultCompiler, extract, linkModules } from "./check-snippets"

test("RD-001: the complete crypto example uses native keys and declares every input", async () => {
  const source = extract(readFileSync(new URL("../user/src/platform/platform-globals.md", import.meta.url), "utf8"))
    .find(block => block.source.includes("effect function experimental("))!.source
  const temp = mkdtempSync(join(tmpdir(), "docs-native-crypto-"))
  try {
    linkModules(temp)
    writeFileSync(join(temp, "package.json"), '{"name":"docs-native-crypto","type":"module"}')
    writeFileSync(join(temp, "main.vibe"), source)
    writeFileSync(join(temp, "tsconfig.json"), JSON.stringify({
      compilerOptions: { strict: true, target: "es2022", module: "nodenext", skipLibCheck: true, types: [], noEmit: true },
      files: ["main.vibe"]
    }))
    const result = await command([defaultCompiler(), "--singleThreaded", "-p", "tsconfig.json"], temp, 30000)
    expect(result).toMatchObject({ exitCode: 0 })
  } finally { rmSync(temp, { recursive: true, force: true }) }
}, 40000)

test("RD-001 property: native crypto keys survive renaming; byte containers are rejected", async () => {
  const { createRequire } = await import("node:module")
  const fc = createRequire(new URL("../../packages/runtime/package.json", import.meta.url))("fast-check")
  const source = extract(readFileSync(new URL("../user/src/platform/platform-globals.md", import.meta.url), "utf8"))
    .find(block => block.source.includes("effect function experimental("))!.source
  await fc.assert(fc.asyncProperty(
    fc.constantFrom(["macKey", "Mac.Key"], ["aeadKey", "Aead.Key"], ["privateKey", "Signature.PrivateKey"], ["publicKey", "Signature.PublicKey"]),
    fc.stringMatching(/^[a-z]{1,8}$/), fc.boolean(),
    async ([key, type]: string[], suffix: string, bytes: boolean) => {
      const temp = mkdtempSync(join(tmpdir(), "docs-crypto-property-"))
      try {
        linkModules(temp)
        const renamed = source.replace(new RegExp("\\b" + key + "\\b", "g"), key + suffix)
          .replace(key + suffix + ": " + type, key + suffix + ": " + (bytes ? "Redacted.Redacted<Uint8Array>" : type))
        writeFileSync(join(temp, "package.json"), '{"name":"docs-crypto-property","type":"module"}')
        writeFileSync(join(temp, "main.vibe"), renamed)
        writeFileSync(join(temp, "tsconfig.json"), JSON.stringify({
          compilerOptions: { strict: true, module: "nodenext", target: "es2022", skipLibCheck: true, types: [], noEmit: true }, files: ["main.vibe"]
        }))
        const result = await command([defaultCompiler(), "--singleThreaded", "-p", "tsconfig.json"], temp, 30000)
        expect(result.exitCode).toBe(bytes ? 2 : 0)
        if (bytes) expect(result.stdout).toContain("TS2739")
      } finally { rmSync(temp, { recursive: true, force: true }) }
    }), { numRuns: 12, seed: 4001 })
}, 60000)

