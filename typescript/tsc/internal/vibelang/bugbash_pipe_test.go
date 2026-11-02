package vibelang

import (
	"strings"
	"testing"
)

func TestBugBashCallPipeGuidance(t *testing.T) {
	for _, tc := range []struct {
		name, source, want, absent string
		code                       int32
	}{
		{"pipe span", `export function f() { return Effect.succeed(1).pipe(Effect.withSpan("n")) }`, `Effect.withSpan(() => Effect.succeed(1), "n")`, "retry", 4502},
		{"retry", `error Flaky
function f(s: number): number!Flaky { if (s < 1) throw new Flaky(); return s }
export function main() { return f(1).pipe(Effect.retry({ times: 3 }), Effect.timeout("1 second")) }`, `Effect.timeout(() => Effect.retry(() => f(1), { times: 3 }), "1 second")`, "|>", 4502},
	} {
		t.Run(tc.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, tc.source)
			found := false
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				text := diagnosticWithNotes(d)
				if strings.Contains(text, tc.absent) {
					t.Errorf("leaked %q: %s", tc.absent, text)
				}
				if d.Code() == tc.code {
					found = true
					if !strings.Contains(text, tc.want) {
						t.Errorf("missing %q: %s", tc.want, text)
					}
				}
			}
			if !found {
				t.Fatalf("missing diagnostic %d", tc.code)
			}
		})
	}
}
