package vibelangfuzz

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const forTryOperandQuote = "an operand that is not a \x60Stream\x60, \x60for try (const x of [1, 2]) { }\x60"

func forTryOperandsChapter(t testing.TB) {
	t.Helper()
	text, err := os.ReadFile(SpecPath("002-running.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), forTryOperandQuote) {
		t.Fatalf("chapter 2 no longer says %q", forTryOperandQuote)
	}
}
func TestForTryOperandsQuoted(t *testing.T) { forTryOperandsChapter(t) }

// VIP-20, decided detail 288: compare the source operand's admission with a
// native TypeScript assignment to Stream<any, any, any>. This is a static
// oracle, not a runtime witness for never or a dynamic guard for any.
func FuzzForTryOperands(f *testing.F) {
	startShortBudget(f)
	forTryOperandsChapter(f)
	domains := []struct{ key, typ, decl, generic string }{
		{"any", "any", "", ""},
		{"never", "never", "", ""},
		{"stream", "Stream.Stream<number>", "", ""},
		{"alias", "Rows", "type Rows = Stream.Stream<number>;", ""},
		{"intersection", "Stream.Stream<number> & { label: string }", "", ""},
		{"constraint", "T", "", "<T extends Stream.Stream<number>>"},
		{"union", "Stream.Stream<number> | Stream.Stream<string>", "", ""},
		{"constrained-union", "T", "", "<T extends Stream.Stream<number> | Stream.Stream<string>>"},
		{"missing-channel", "Omit<Stream.Stream<number>, \"channel\">", "", ""},
		{"missing-pipe", "Omit<Stream.Stream<number>, \"pipe\">", "", ""},
		{"unknown", "unknown", "", ""},
		{"optional", "Stream.Stream<number> | undefined", "", ""},
		{"array", "readonly number[]", "", ""},
		{"async-iterable", "AsyncIterable<number>", "", ""},
		{"marker-only", "{ readonly [Stream.TypeId]: { readonly _A: () => number; readonly _E: () => never; readonly _R: () => never } }", "", ""},
	}
	for _, d := range domains {
		f.Add([]byte(d.key))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		forTryOperandsChapter(t)
		index := 0
		if len(data) > 0 {
			index = int(data[0]) % len(domains)
		}
		parts := strings.SplitN(string(data), ":", 2)
		for i, d := range domains {
			if parts[0] == d.key {
				index = i
				break
			}
		}
		d := domains[index]
		binding, operand := "const row", "rows"
		if len(parts) > 1 {
			if len(parts[1])%2 != 0 {
				binding = "let row"
			}
			if len(parts[1])%3 != 0 {
				operand = "(rows)"
			}
		}
		prefix := "import { Stream } from \"effect\"; " + d.decl
		native := fmt.Sprintf("%s export function check%s(rows: %s): void { const accepted: Stream.Stream<any, any, any> = rows; }", prefix, d.generic, d.typ)
		reference, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.ts": native}})
		if err != nil {
			t.Fatal(err)
		}
		defer reference.Remove()
		rejects := false
		for _, diag := range reference.Diagnostics {
			if diag.Category() == diagnostics.CategoryError {
				if IsEK(diag) || diag.Code() != 2322 && diag.Code() != 2739 && diag.Code() != 2741 {
					t.Fatalf("invalid native reference: %s", diag.String())
				}
				rejects = true
			}
		}
		source := fmt.Sprintf("%s export effect function check%s(rows: %s) { for try (%s of %s) {} }", prefix, d.generic, d.typ, binding, operand)
		result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		count := 0
		for _, diag := range result.Diagnostics {
			if diag.Category() == diagnostics.CategoryError {
				if IsEK(diag) && diag.Code() == 2004 {
					count++
					continue
				}
				if !IsEK(diag) && (d.key == "unknown" && diag.Code() == 18046 || d.key == "optional" && diag.Code() == 18048) {
					continue
				}
				t.Fatalf("unexpected diagnostic for %s: %s\n%s", d.key, diag.String(), source)
			}
		}
		expected := 0
		if rejects {
			expected = 1
		}
		if count != expected {
			t.Fatalf("VIP-20/detail288 %s: native assignment rejects=%v, EK2004 count=%d; %s\n%s", d.key, rejects, count, forTryOperandQuote, source)
		}
	})
}
