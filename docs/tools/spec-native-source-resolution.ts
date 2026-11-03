import type { Rule, Violation } from "./spec-lint"

// VIP-34's native TypeScript resolution contract does not mean exact filename lookup.
export const nativeSourceResolution: Rule = {
  name: "native-source-resolution",
  finding: "r20 ASTRA-1: a written .ts specifier was said to find only the .ts file",
  check(spec) {
    const out: Violation[] = []
    for (const [file, text] of spec) {
      const body = text.replace(/^```[^]*?^```/gm, block => block.replace(/[^\n]/g, " "))
      const exclusive = /`\.\/([\w-]+)\.(tsx?)`\s+(?:finds|resolves to|can resolve to)\s+only\s+`\1\.\2`/g
      for (const match of body.matchAll(exclusive)) {
        out.push({ rule: this.name, file, line: text.slice(0, match.index).split("\n").length,
          message: "native source-extension lookup also substitutes TypeScript sources and declarations; exclude VibeLang fallbacks without claiming exact filename lookup" })
      }
    }
    return out
  }
}
