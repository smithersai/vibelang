package vibelangfuzz

import (
	"errors"
	"os/exec"
	"testing"
)

func TestStockReportedNothing(t *testing.T) {
	for _, c := range []struct {
		name string
		err  error
		out  string
		want bool
	}{
		{"silent success", nil, "", true},
		{"blank output", nil, "\n", true},
		{"reported diagnostic", nil, "main.ts(1,14): error TS2322: no\n", false},
		{"failed silently", errors.New("exit status 2"), "", false},
	} {
		if got := stockReportedNothing(c.err, []byte(c.out)); got != c.want {
			t.Errorf("%s: got %v", c.name, got)
		}
	}
}

// The short seeds skip the language server on the premise tested here: it has
// no diagnostic for a project stock tsc accepts, even one it would hint about.
func TestStockCleanProjectHasNoServerSpans(t *testing.T) {
	tsc := StockTypeScript(t)
	const config = `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"noEmit":true},"files":["main.ts"]}`
	for _, c := range []struct {
		name, source string
		clean        bool
	}{
		{"accepted", "export const answer: number = 42;\n", true},
		{"hints only", "export function f(a: number) {\n  const unused = 1;\n  return a;\n  a;\n}\n/** @deprecated */\nexport function g() {}\ng();\n", true},
		{"error", "export const answer: number = 'no';\n", false},
	} {
		t.Run(c.name, func(t *testing.T) {
			dir := t.TempDir()
			for name, text := range map[string]string{"tsconfig.json": config, "main.ts": c.source} {
				if err := writeInside(dir, name, text); err != nil {
					t.Fatal(err)
				}
			}
			cmd := exec.CommandContext(t.Context(), tsc, "-p", ".", "--pretty", "false")
			cmd.Dir = dir
			out, runErr := cmd.CombinedOutput()
			if got := stockReportedNothing(runErr, out); got != c.clean {
				t.Fatalf("stock tsc reported nothing=%v, want %v: %v: %s", got, c.clean, runErr, out)
			}
			spans, _, err := stockSpans(t.Context(), tsc, dir, "main.ts")
			if err != nil {
				t.Fatal(err)
			}
			if c.clean != (len(spans) == 0) {
				t.Fatalf("clean=%v, server spans %v", c.clean, spans)
			}
		})
	}
}
