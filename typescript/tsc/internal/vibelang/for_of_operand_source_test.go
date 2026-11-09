package vibelang

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Chapter 7: native static errors keep their TS codes, as in TypeScript. A
// for try head, a for...of head with an is binding and a do expression in a
// loop head hold the operand in a generated constant. TypeScript still reports an unknown or nullable operand
// with the code and text of the same loop without that constant: it names the
// written operand, or calls it an object, and never names the constant. This
// compares the compiler with itself on loops the chapter says must agree.
func TestForOfOperandDiagnosticsNameTheSource(t *testing.T) {
	for _, row := range []struct {
		name, value, operand, want string
	}{
		{"unknown-name", "unknown", "rows", "TS18046 'rows' is of type 'unknown'."},
		{"unknown-property", "unknown", "holder.rows", "TS18046 'holder.rows' is of type 'unknown'."},
		{"unknown-call", "unknown", "load()", "TS2571 Object is of type 'unknown'."},
		{"unknown-parenthesized", "unknown", "(rows)", "TS2571 Object is of type 'unknown'."},
		{"undefined-name", "%s | undefined", "rows", "TS18048 'rows' is possibly 'undefined'."},
		{"undefined-property", "%s | undefined", "holder.rows", "TS18048 'holder.rows' is possibly 'undefined'."},
		{"null-call", "%s | null", "load()", "TS2531 Object is possibly 'null'."},
		{"both-name", "%s | null | undefined", "rows", "TS18049 'rows' is possibly 'null' or 'undefined'."},
		{"unknown-do", "unknown", "do { load() }", "TS2571 Object is of type 'unknown'."},
		{"undefined-do", "%s | undefined", "do { load() }", "TS2532 Object is possibly 'undefined'."},
	} {
		errors := func(t *testing.T, base, loop string) []string {
			value := row.value
			if strings.Contains(value, "%s") {
				value = fmt.Sprintf(value, base)
			}
			source := "declare const holder: { rows: " + value + " }; declare function load(): " + value + "; declare const probe: unknown;\n" +
				fmt.Sprintf(loop, value, row.operand)
			program, file, _, _ := editorProgram(t, source)
			var out []string
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				if text := d.String(); strings.Contains(text, "$") {
					t.Errorf("a diagnostic names a generated binding: %s\n%s", text, source)
				}
				if d.Source() == diagnosticSource {
					out = append(out, fmt.Sprintf("EK%d", d.Code()))
					continue
				}
				if at := source[d.Pos():d.End()]; at != row.operand {
					t.Errorf("TS%d is reported at %q, want the operand %q\n%s", d.Code(), at, row.operand, source)
				}
				out = append(out, fmt.Sprintf("TS%d %s", d.Code(), d.String()))
			}
			slices.Sort(out)
			return out
		}
		t.Run(row.name, func(t *testing.T) {
			native := errors(t, "number[][]", "export function check(rows: %s) { for (const [item = 0] of %s) { void item } }")
			if !slices.Equal(native, []string{row.want}) {
				t.Fatalf("native loop: want [%s] got %v", row.want, native)
			}
			head := errors(t, "number[][]", "export function check(rows: %s) { for (const [item = (probe is [let first]) ? first : 0] of %s) { void item } }")
			if !slices.Equal(head, native) {
				t.Errorf("for...of with an is binding in its head: want %v got %v", native, head)
			}
			// Chapter 2 gives the Stream rejection to EK2004, which also covers
			// the nullable operand; the unknown operand keeps the TypeScript error.
			want := []string{"EK2004"}
			if row.value == "unknown" {
				want = append(want, row.want)
			}
			stream := errors(t, "Stream.Stream<number>", "export effect function check(rows: %s) { for try (const item of %s) { void item } }")
			if !slices.Equal(stream, want) {
				t.Errorf("for try: want %v got %v", want, stream)
			}
		})
	}
}
