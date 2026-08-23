import { buildSemanticProjectModels } from "../src/language/semantic.ts"
import { compileProject } from "../src/language/project-compile.ts"

const cases: Record<string, string> = {
  busyWait: `
export function slowWork(input: { spinUntilMs: number; value: number }): { value: number } {
  while (Date.now() < input.spinUntilMs) {
    // spin
  }
  return { value: input.value + 1 }
}
`,
  asyncSleep: `
export async function sleepy(input: { ms: number }): Promise<{ ok: boolean }> {
  await new Promise((resolve) => setTimeout(resolve, input.ms))
  return { ok: true }
}
`,
  mutableLoop: `
export function loopy(input: { rounds: number }): { total: number } {
  let total = 0
  for (let index = 0; index < input.rounds; index++) {
    total = total + index
  }
  return { total }
}
`
}
for (const [name, source] of Object.entries(cases)) {
  try {
    const project = buildSemanticProjectModels([{ fileName: "probe.sm", source }], {})
    const diags = project.analysis.diagnostics
    console.log(name, "analysis diags:", diags.length, diags.slice(0, 3).map(d => d.message))
    if (diags.length === 0) {
      const rows = project.analysis.files["probe.sm"]?.rows
      console.log(name, "rows:", JSON.stringify(rows))
      const emitted = compileProject([{ fileName: "probe.sm", source }], { outDir: "/tmp/x", runtimeImport: "smithers-runtime", sourceMap: false })
      console.log(name, "emit diags:", emitted.diagnostics.length)
    }
  } catch (error) {
    console.log(name, "threw:", (error as Error).message)
  }
}
