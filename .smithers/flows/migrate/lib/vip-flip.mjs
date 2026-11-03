// Detect VIP-1 by what the compiler emits, never by its release version.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { listDeclarations } from "./declarations.mjs"
import { quote, readJson, run, writeJson } from "./util.mjs"

/** Compile an isolated .vibe project and read the unmarked arrow's return type. */
export async function probeVip1({ compiler, nodeModules, directory, log, ts, timeoutMs = 30000 }) {
  mkdirSync(directory, { recursive: true })
  const probe = mkdtempSync(join(directory, "vip1-probe-"))
  try {
    // Keep the installed Effect/prelude available without inheriting a target's
    // tsconfig, source files, generated sidecars or incremental build state.
    if (nodeModules && existsSync(nodeModules)) symlinkSync(nodeModules, join(probe, "node_modules"), "dir")
    writeFileSync(join(probe, "probe.vibe"), "export const f = (n: number) => n + 1\n")
    writeJson(join(probe, "package.json"), { type: "module" })
    writeJson(join(probe, "tsconfig.json"), {
      compilerOptions: { target: "ESNext", module: "NodeNext", moduleResolution: "NodeNext", skipLibCheck: true, types: [] },
      files: ["probe.vibe"]
    })
    const out = join(probe, "out")
    const result = await run(`${quote(compiler)} -p ${quote(join(probe, "tsconfig.json"))} --singleThreaded --declaration --emitDeclarationOnly --pretty false --outDir ${quote(out)}`,
      { cwd: probe, log, timeoutMs })
    if (result.code !== 0) return { error: `VIP-1 probe exited ${result.code}${result.timedOut ? " (timed out)" : ""}`,
      diagnosticCodes: [...new Set((result.stdout + result.stderr).match(/\b(?:EK|TS)\d{4,5}\b/g) ?? [])], log }
    const files = listDeclarations(out)
    if (files.length !== 1) return { error: `VIP-1 probe emitted ${files.length} declaration files; expected one`, log }
    const declaration = readFileSync(join(out, files[0]), "utf8")
    const source = ts.createSourceFile("probe.d.ts", declaration, ts.ScriptTarget.Latest, true)
    const bindings = source.statements.filter(ts.isVariableStatement).flatMap(s => [...s.declarationList.declarations])
      .filter(d => ts.isIdentifier(d.name) && d.name.text === "f")
    const type = bindings.length === 1 && bindings[0].type
    if (!source.parseDiagnostics.length && type && ts.isFunctionTypeNode(type)) {
      const returned = type.type
      if (returned.kind === ts.SyntaxKind.NumberKeyword) return { side: "post", declaration, log }
      // The pre-flip compiler emits Effect.Effect<number, never, never>.
      // Accept its qualified or imported spelling, but refuse any/unknown,
      // unions, aliases and unrelated declaration text.
      const name = ts.isTypeReferenceNode(returned) ? returned.typeName
        : ts.isImportTypeNode(returned) ? returned.qualifier : undefined
      const last = name && (ts.isQualifiedName(name) ? name.right : name)
      if (last && ts.isIdentifier(last) && last.text === "Effect" &&
          returned.typeArguments?.[0]?.kind === ts.SyntaxKind.NumberKeyword) return { side: "pre", declaration, log }
    }
    return { error: "VIP-1 probe has an unrecognized arrow return type", declaration, log }
  } catch (error) {
    return { error: `VIP-1 probe failed: ${error.message}`, log }
  } finally {
    rmSync(probe, { recursive: true, force: true })
  }
}

/**
 * Probe the target with its own Effect/runtime, before repinning the predecessor.
 * The consumer's dependencies belong to the installed compiler: reusing them
 * here can make the new compiler refuse an otherwise valid probe with EK3201.
 */
export async function probeTargetVip1({ toolchain, readToolchain, directory, log, ts }) {
  mkdirSync(directory, { recursive: true })
  const install = mkdtempSync(join(directory, "vip1-target-"))
  const installLog = log && log + ".install"
  try {
    const staged = toolchain.kind === "staged" ? readToolchain(toolchain.dir) : undefined
    const packages = staged
      ? [`effect@${staged.effect}`, join(staged.dir ?? toolchain.dir, staged.packages["vibelang-runtime"])]
      : [`vibelang@${toolchain.version}`, `vibelang-runtime@${toolchain.version}`]
    writeJson(join(install, "package.json"), { private: true, type: "module" })
    const result = await run(`npm install --prefix ${quote(install)} --ignore-scripts --no-audit --no-fund --package-lock=false ${packages.map(quote).join(" ")}`,
      { cwd: install, log: installLog, timeoutMs: 120000 })
    if (result.code !== 0) return { error: `target VIP-1 dependencies install exited ${result.code}${result.timedOut ? " (timed out)" : ""}`,
      fatal: true, stage: "dependencies", log: installLog }
    const nodeModules = join(install, "node_modules")
    const dependencies = Object.fromEntries(["effect", "vibelang-runtime"].map(name =>
      [name, readJson(join(nodeModules, name, "package.json")).version]))
    const probe = await probeVip1({ compiler: staged?.compiler ?? join(nodeModules, ".bin/vibelang"),
      nodeModules, directory, log, ts })
    return { ...probe, dependencies, ...(probe.diagnosticCodes?.includes("EK3201") ? { fatal: true, stage: "compile" } : {}) }
  } catch (error) {
    return { error: `target VIP-1 probe failed: ${error.message}`, fatal: true, stage: "dependencies", log: installLog }
  } finally {
    rmSync(install, { recursive: true, force: true })
  }
}
