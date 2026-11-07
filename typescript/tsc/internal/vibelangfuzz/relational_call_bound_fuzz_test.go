package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const relationalCallBoundTarget = "FuzzRelationalCallBound"
const relationalCallBoundQuote = "invalid `match`/`is` grammar or a pattern-specific early error without a more specific diagnostic"

// Each key is a relational operator; the mode picks the home and the call.
var relationalCallBoundKeys = []string{"<", ">", "<=", ">=", "===", "!==", "==", "!=", "in", "instanceof"}

func relationalCallBoundQuoted(t testing.TB) {
	t.Helper()
	if !strings.Contains(SpecText("004-match.md"), relationalCallBoundQuote) {
		t.Fatal("EK0707 authority changed")
	}
}
func TestRelationalCallBoundQuoted(t *testing.T) { relationalCallBoundQuoted(t) }

// A static check: a call is not a relational operand in the pinned grammar,
// so each program reports exactly one EK0707 and no syntax error.
func FuzzRelationalCallBound(f *testing.F) {
	startShortBudget(f)
	relationalCallBoundQuoted(f)
	for _, key := range relationalCallBoundKeys {
		for mode := uint8(0); mode < 8; mode++ {
			f.Add(key, mode)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		if !slices.Contains(relationalCallBoundKeys, key) {
			key = relationalCallBoundKeys[int(mode)%len(relationalCallBoundKeys)]
		}
		mode %= 8
		call := "bound()"
		if mode&4 != 0 {
			call = "table.lookup(1)"
		}
		pattern := key + " " + call
		var body string
		switch mode & 3 {
		case 0:
			body = "return match (s) { when " + pattern + ": 1; default: 0; }"
		case 1:
			body = "return s is " + pattern
		case 2:
			body = "return match (s) { when { v: " + pattern + " }: 1; default: 0; }"
		default:
			body = "return match (s) { when String and " + pattern + ": 1; default: 0; }"
		}
		source := "declare function bound(): any\ndeclare const table: { lookup(n: number): any }\n" +
			"export function f(s: unknown) { " + body + " }\n"
		gapKey := fmt.Sprintf("call-bound:%s:%d", key, mode)
		result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}, Config: "{\"compilerOptions\":{\"target\":\"ES2022\",\"module\":\"NodeNext\",\"strict\":true,\"skipLibCheck\":true,\"noEmit\":true,\"types\":[]},\"files\":[\"main.vibe\"]}"})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		var errors []string
		only707 := true
		for _, d := range result.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				errors = append(errors, specDiagnosticText(d))
				only707 = only707 && d.Code() == 707
			}
		}
		if len(errors) != 1 || !only707 {
			Gap(t, relationalCallBoundTarget, gapKey, "%s: want one EK0707, got %v\n%s", relationalCallBoundQuote, errors, source)
		}
	})
}
