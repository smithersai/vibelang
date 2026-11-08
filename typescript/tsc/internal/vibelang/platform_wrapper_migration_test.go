package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const smithersPlatformNodeTypes = `export {}
declare global {
 var process: {
  readonly stdout: { write(chunk: unknown): boolean };
  exit(code: number): never;
  env: { [key: string]: string | undefined };
 };
}
`

func smithersPlatformCase(t *testing.T, source string) string {
	t.Helper()
	dir := platformCallCase(t, source)
	if strings.Contains(source, "./spy.js") {
		if err := os.WriteFile(filepath.Join(dir, "spy.ts"), []byte("export declare const vi: { spyOn<T, K extends keyof T>(value: T, key: K): void };"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(dir, "types-node/index.d.ts"), []byte(smithersPlatformNodeTypes), 0600); err != nil {
		t.Fatal(err)
	}
	return dir
}

// VIP-33 forbids the host access, but the retirement ruling keeps formerly
// accepted boundary callbacks as warnings until their preserving repair ships.
func TestLegacyWrappedPlatformMigrationWarning(t *testing.T) {
	cases := []struct {
		name, source string
		category     diagnostics.Category
	}{
		{"sync-read", "export effect function read() { return try sync(() => process.env.COMPLETE) }", warningCategory},
		{"sync-delete", "export effect function restore(previous: string | undefined) { try sync((previous) => { if (previous === undefined) delete process.env.COMPLETE; else process.env.COMPLETE = previous }, previous) }", warningCategory},
		{"try-read", "export const read = Effect.try(() => process.env.COMPLETE)", warningCategory},
		{"try-promise-read", "export const read = Effect.tryPromise(async () => process.env.COMPLETE)", warningCategory},
		{"outside", "export const read = process.env.COMPLETE", errorCategory},
		{"input-outside", "export effect function read() { return try sync((value) => value, process.env.COMPLETE) }", errorCategory},
		{"shadowed", "const sync = <A>(f: () => A): A => f(); export const read = sync(() => process.env.COMPLETE)", errorCategory},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			dir := smithersPlatformCase(t, test.source)
			seen := 0
			for _, d := range platformCallProgram(t, dir).GetSemanticDiagnostics(t.Context(), nil) {
				if d.Code() == EK4402.Code {
					seen++
					if d.Category() != test.category {
						t.Errorf("EK4402 category %v, want %v: %s", d.Category(), test.category, d.String())
					}
				}
			}
			if seen == 0 {
				t.Fatal("fixture must retain its platform diagnostic")
			}
		})
	}
}

const smithersRestoreWrapper = "export effect function restore(previous: string | undefined) { try sync((previous) => { if (previous === undefined) delete process.env.COMPLETE; else process.env.COMPLETE = previous }, previous) }"
