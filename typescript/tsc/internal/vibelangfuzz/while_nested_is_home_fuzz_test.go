package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const whileNestedIsHomeTarget = "FuzzWhileNestedIsHome"
const whileNestedIsHomeQuote = "Lexical `is` bindings in `while` and `do…while` have the pinned explainer's loop-head/per-iteration scope, rather than an enclosing block's scope."

// Each key places the binding is somewhere other than a top-level conjunct
// of the while condition.
var whileNestedIsHomes = []string{"or", "not", "ternary", "argument", "nested-or", "mixed", "comma", "logical-and-inner"}

func whileNestedIsHomeQuoted(t testing.TB) {
	t.Helper()
	if !strings.Contains(SpecText("004-match.md"), whileNestedIsHomeQuote) {
		t.Fatal("while-condition binding home authority changed")
	}
}
func TestWhileNestedIsHomeQuoted(t *testing.T) { whileNestedIsHomeQuoted(t) }

// A static acceptance check: every form is a valid while condition whose
// binding the body reads through a closure, so it compiles without errors.
// Runtime cells are compared in the paired compiler case.
func FuzzWhileNestedIsHome(f *testing.F) {
	startShortBudget(f)
	whileNestedIsHomeQuoted(f)
	for _, home := range whileNestedIsHomes {
		for mode := uint8(0); mode < 8; mode++ {
			f.Add(home, mode)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		if !slices.Contains(whileNestedIsHomes, key) {
			key = whileNestedIsHomes[int(mode)%len(whileNestedIsHomes)]
		}
		mode %= 8
		keyword := "let"
		if mode&1 != 0 {
			keyword = "const"
		}
		binding := "(n++ is " + keyword + " v)"
		condition := map[string]string{
			"or":                "n < 3 && (n === 1 || " + binding + ")",
			"not":               "!(n > 2 || !" + binding + ")",
			"ternary":           binding + " ? v < 3 : false",
			"argument":          "n < 3 && keep(" + binding + ")",
			"nested-or":         "n < 3 && (false || (false || " + binding + "))",
			"mixed":             "(n is let w) && w < 3 && (false || " + binding + ")",
			"comma":             "(keep(true), n < 3 && " + binding + ")",
			"logical-and-inner": "n < 3 && (keep(true) ? " + binding + " && v < 3 : false)",
		}[key]
		body := "{ reads.push(() => v) }"
		if mode&2 != 0 {
			body = "reads.push(() => v)"
		}
		loop := "while (" + condition + ") " + body
		if mode&4 != 0 {
			loop = "outer: " + loop
		}
		source := "declare function keep(flag: boolean): boolean\n" +
			"export function f() { let n = 0; const reads: Array<() => number> = []\n  " + loop + "\n  " + loop + "\n  return reads }\n"
		gapKey := fmt.Sprintf("home:%s:%d", key, mode)
		result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}, Config: "{\"compilerOptions\":{\"target\":\"ES2022\",\"module\":\"NodeNext\",\"strict\":true,\"skipLibCheck\":true,\"noEmit\":true,\"types\":[]},\"files\":[\"main.vibe\"]}"})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		for _, d := range result.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				Gap(t, whileNestedIsHomeTarget, gapKey, "%s: unexpected %s\n%s", whileNestedIsHomeQuote, specDiagnosticText(d), source)
				return
			}
		}
	})
}
