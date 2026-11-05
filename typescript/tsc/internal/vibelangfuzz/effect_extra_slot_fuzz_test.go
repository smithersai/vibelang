package vibelangfuzz

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"os"
	"strings"
	"testing"
)

const extraSlotQuote = "and `A!!B!C` is a syntax error (`EK0302`)"

func requireExtraSlotQuote(t testing.TB) {
	t.Helper()
	text, err := os.ReadFile(SpecPath("900-appendices.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), extraSlotQuote) {
		t.Fatalf("missing extra-slot rule: %q", extraSlotQuote)
	}
}
func TestEffectExtraSlotQuoted(t *testing.T) { requireExtraSlotQuote(t) }
func FuzzEffectExtraSlot(f *testing.F) {
	startShortBudget(f)
	requireExtraSlotQuote(f)
	for _, key := range []string{"alias", "property", "callable", "assertion", "outer-group", "inner-group"} {
		for _, mode := range []uint8{0, 1, 2} {
			f.Add(key, mode)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		scalar := []string{"number", "string", "boolean"}[mode%3]
		gap := []string{" ", " /* slot */ ", "\t"}[mode%3]
		typ := scalar + "!!string" + gap + "!boolean"
		want := 1
		switch key {
		case "outer-group":
			typ = "(" + scalar + "!!string)" + gap + "!boolean"
			want = 0
		case "inner-group":
			typ = scalar + "!(string" + gap + "!boolean)"
			want = 0
		case "alias", "property", "callable", "assertion":
		default:
			key = "alias"
		}
		source := "type X = " + typ
		switch key {
		case "property":
			source = "type X = { value: " + typ + " }"
		case "callable":
			source = "type X = () => " + typ
		case "assertion":
			source = "declare const input: unknown; const result = input as " + typ
		}
		if mode == 2 {
			source = "// café 😀\n" + source
		}
		r, err := w.Compile(t.Context(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		count := 0
		for _, d := range r.Diagnostics {
			if d.Source() == "EK" && d.Code() == 302 {
				count++
				continue
			}
			if d.Category() == diagnostics.CategoryError {
				Gap(t, "FuzzEffectExtraSlot", "extra-slot:other:"+key, "%s; unexpected %v\n%s", extraSlotQuote, d, source)
			}
		}
		if count != want {
			Gap(t, "FuzzEffectExtraSlot", "extra-slot:diagnostic:"+key, "%s; got %d want %d\n%s", extraSlotQuote, count, want, source)
		}
	})
}
