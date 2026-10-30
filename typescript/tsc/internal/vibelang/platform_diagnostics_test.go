package vibelang

import (
	"strings"
	"testing"
)

func TestGlobalThisPlatformDiagnostics(t *testing.T) {
	files := computedKeyFiles(false)
	// Node types load only when named: an unresolved process is TS2591, not EK4402.
	files["/workspace/x/src/tsconfig.json"] = `{"compilerOptions":{"strict":true,"target":"ESNext","module":"NodeNext","declaration":true,"types":["node"]},"files":["main.vibe"]}`
	files["/workspace/x/src/node_modules/@types/node/package.json"] = `{"name":"@types/node","types":"index.d.ts"}`
	files["/workspace/x/src/node_modules/@types/node/index.d.ts"] = `declare var process: { env: { TMPDIR: string | undefined } }`
	files["/workspace/x/src/main.vibe"] = `export const direct = (): string | undefined => process.env.TMPDIR
export const viaGlobal = (): string | undefined => globalThis.process?.env?.TMPDIR
export const viaGlobalPlain = (): string | undefined => globalThis.process.env.TMPDIR
export const viaBracket = (): string | undefined => globalThis["process"].env.TMPDIR
export const held = globalThis.process
export const local = (globalThis: { process: { env: { TMPDIR: string } } }): string => globalThis.process.env.TMPDIR`
	p := computedKeyProgram(t, files)
	count := 0
	for _, d := range p.GetSemanticDiagnostics(t.Context(), nil) {
		if d.Code() != EK4402.Code {
			continue
		}
		count++
		if !strings.Contains(diagnosticWithNotes(d), "process") || !strings.Contains(diagnosticWithNotes(d), "Config") {
			t.Errorf("wrong replacement: %s", diagnosticWithNotes(d))
		}
	}
	// held holds process as a value, which is platform code too (D310).
	if count != 5 {
		t.Fatalf("got %d platform diagnostics, want 5", count)
	}
}
