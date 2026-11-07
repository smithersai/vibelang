package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// VIP-6: a direct global call has the native Effect export's signature.
func TestNativeCallbackDirectCall(t *testing.T) {
	for _, body := range []string{
		"return try callback<number>(resume => resume(Effect.succeed(7)))",
		"return try callback<number, string>(resume => resume(Effect.fail(\"failed\")))",
		"return try callback<number>(resume => resume(Exit.succeed(9)))",
		"const register = (resume: (program: number!!) => void) => resume(Effect.succeed(7)); return try callback<number>(register)",
		"return try callback<number>((resume, signal) => { resume(Effect.succeed(signal.aborted ? 0 : 7)); return Effect.void })",
	} {
		t.Run(body, func(t *testing.T) {
			for _, call := range []string{body, strings.ReplaceAll(body, "callback<number", "Effect.callback<number")} {
				program, file, _, _ := editorProgram(t, "export effect function main() { "+call+" }")
				for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
					if d.Category() == diagnostics.CategoryError {
						t.Fatal(diagnosticWithNotes(d))
					}
				}
			}
		})
	}
}

// Services keeps EK4402 as a warning in formerly accepted boundary callbacks.
func TestNativeCallbackPlatformMigrationWarning(t *testing.T) {
	for _, tc := range []struct {
		name, source string
		category     diagnostics.Category
	}{
		{"native", "export const value = callback(() => { const name = process.env.COMPLETE })", warningCategory},
		{"generic", "export const value = callback<void>(() => { const name = process.env.COMPLETE })", warningCategory},
		{"nested", "export const value = callback(() => { const read = () => process.env.COMPLETE; read() })", warningCategory},
		{"bracket", "export const value = callback(() => { const name = process.env['COMPLETE'] })", warningCategory},
		{"outside", "export const value = process.env.COMPLETE", errorCategory},
		{"input", "export const value = callback(() => {}, process.env.COMPLETE)", errorCategory},
		{"named-registration", "const register = () => { const name = process.env.COMPLETE }; export const value = callback(register)", errorCategory},
		{"shadowed", "const callback = (run: () => void) => run(); export const value = callback(() => { const name = process.env.COMPLETE })", errorCategory},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := smithersPlatformCase(t, tc.source)
			found := 0
			for _, d := range platformCallProgram(t, dir).GetSemanticDiagnostics(t.Context(), nil) {
				if d.Source() == diagnosticSource && d.Code() == EK4402.Code {
					found++
					if d.Category() != tc.category {
						t.Errorf("EK4402 category %s, want %s: %s", d.Category().Name(), tc.category.Name(), d.String())
					}
				}
			}
			if found != 1 {
				t.Fatalf("expected one platform diagnostic, got %d", found)
			}
		})
	}
}
