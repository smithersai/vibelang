package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"strings"
	"testing"
	"unicode"
)

// VIP-4's retirement: every retired wrapper keeps its EK0407 error at its own
// call, whose message says what to write. A local namesake and a
// listed-failure wrapper are not the retired form.
func TestTrustedEmptyRetiredRefusalIsLocated(t *testing.T) {
	for name, c := range map[string]struct {
		source  string
		retired bool
		refused bool
	}{
		"migrated":  {"const safe = trusted(Math.max, []); export effect function f() { return safe(1, 2) }", true, false},
		"export":    {"export const safe = trusted(Math.max, [])", true, true},
		"escape":    {"const safe = trusted(Math.max, []); export const escaped = [safe]", true, true},
		"plain":     {"const safe = trusted(Math.max, []); export function f() { return safe(1, 2) }", true, true},
		"unused":    {"const safe = trusted(Math.max, [])", true, true},
		"comments":  {"const safe = trusted(Math.max, /* approval */ []); export effect function f() { return safe(1, 2) }", true, true},
		"argument":  {"export const xs = [1].map(() => trusted(Math.max, []))", true, true},
		"listed":    {"const safe = trusted(Math.max, [Error]); export effect function f() { return safe(1, 2) }", false, false},
		"namesake":  {"function trusted<F>(f: F, errors: never[]): F { return f }; const safe = trusted(Math.max, []); export effect function f() { return safe(1, 2) }", false, false},
		"namespace": {"import * as Runtime from \"vibelang-runtime\"\nconst safe = Runtime.trusted(Math.max, []); export effect function f() { return safe(1, 2) }", true, false},
		"renamed":   {"import { trusted as legacy } from \"vibelang-runtime\"\nconst safe = legacy(Math.max, ([])); export effect function f() { return safe(1, 2) }", true, true},
	} {
		t.Run(name, func(t *testing.T) {
			text := c.source
			if !strings.HasPrefix(text, "import") && name != "namesake" {
				text = "import { trusted } from \"vibelang-runtime\"\n" + text
			}
			program, file, _, _ := editorProgram(t, text+"\n")
			var found []*ast.Diagnostic
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Code() == 407 {
					found = append(found, d)
				}
			}
			if !c.retired {
				if len(found) != 0 {
					t.Fatalf("not the retired wrapper, got %s", found[0].String())
				}
				return
			}
			if len(found) != 1 {
				t.Fatalf("want one EK0407, got %d", len(found))
			}
			d := found[0]
			// The call starts at its callee, the name or member path before "(Math.max".
			at := strings.Index(file.Text(), "(Math.max")
			for at > 0 && (file.Text()[at-1] == '.' || file.Text()[at-1] == '_' || unicode.IsLetter(rune(file.Text()[at-1]))) {
				at--
			}
			if d.Pos() != at || !strings.Contains(d.String(), "Write each direct call in effect code as Effect.orDie(") {
				t.Fatalf("EK0407 at %d, want the wrapper call at %d: %s", d.Pos(), at, d.String())
			}
		})
	}
}
