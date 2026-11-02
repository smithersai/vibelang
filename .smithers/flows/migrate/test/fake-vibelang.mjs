// Compiler stubs model C1 declaration emission as well as their test's --fix behavior.
// A failed --fix must not accidentally fail the earlier function-kind probe.
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
export function writeProbeAwareCompiler(file, text, options) {
  mkdirSync(dirname(file), { recursive: true })
  const line = text.indexOf("\n") + 1
  const declaration = "export declare const f: () => Effect.Effect<number, never, never>;"
  const probe = text.slice(0, line).includes("node")
    ? `if (process.getBuiltinModule("fs").existsSync("probe.vibe") && process.argv.includes("-p")) { const fs=process.getBuiltinModule("fs");fs.mkdirSync("out",{recursive:true});fs.writeFileSync("out/probe.d.ts",${JSON.stringify(declaration)});process.exit(0) }\n`
    : `if [ -f probe.vibe ] && [ "$1" = -p ]; then mkdir -p out; printf '%s\\n' '${declaration}' > out/probe.d.ts; exit 0; fi\n`
  writeFileSync(file, text.slice(0,line) + probe + text.slice(line), options)
}
