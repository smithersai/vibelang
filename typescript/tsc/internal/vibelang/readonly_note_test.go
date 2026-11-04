package vibelang

import (
	"strings"
	"testing"
)

// Chapters 3 and 6 make every field of an error or a data variant readonly,
// as Effect's Data.TaggedError and Data.TaggedEnum do. TS2540's note must say
// so and must not offer the retired mutable marker, which EK2125 rejects in a
// variant and EK3410 retires in a plain error.
func TestReadonlyFieldNoteOffersNoMutableMarker(t *testing.T) {
	cases := []struct{ name, source, field string }{
		{"data field", "data Shape { Circle { r: number } }\nexport const grow = (c: Extract<Shape, { _tag: \"Circle\" }>): void => { c.r = 2 }\n", "r"},
		{"data optional field", "data Shape { Circle { r?: number } }\nexport const grow = (c: Extract<Shape, { _tag: \"Circle\" }>): void => { c.r = 2 }\n", "r"},
		{"data second variant", "data Shape { Dot; Square { side: number; label: string } }\nexport const rename = (s: Extract<Shape, { _tag: \"Square\" }>): void => { s.label = \"x\" }\n", "label"},
		{"generic data field", "data Box<A> { Full { value: A }; Empty }\nexport const put = (b: Extract<Box<number>, { _tag: \"Full\" }>): void => { b.value = 2 }\n", "value"},
		{"error field", "error Failed { attempts: number }\nexport const retry = (e: Failed): void => { e.attempts = 2 }\n", "attempts"},
		{"error quoted field", "error Failed { \"retry-count\": number }\nexport const retry = (e: Failed): void => { e[\"retry-count\"] = 2 }\n", "\"retry-count\""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, c.source)
			found := false
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Code() != 2540 {
					continue
				}
				found = true
				var notes []string
				for _, chained := range d.MessageChain() {
					notes = append(notes, chained.String())
				}
				text := strings.Join(notes, "\n")
				if strings.Contains(text, "mutable") {
					t.Errorf("TS2540 note offers the retired mutable marker: %q", text)
				}
				want := "Every field of a data variant or an error is readonly, as in Effect's Data.TaggedEnum and Data.TaggedError; construct a new value with the changed " + c.field + " instead."
				if !strings.Contains(text, want) {
					t.Errorf("TS2540 note = %q, want %q", text, want)
				}
			}
			if !found {
				t.Fatalf("no TS2540 for %s", c.source)
			}
		})
	}
	t.Run("ordinary readonly keeps no note", func(t *testing.T) {
		program, file, _, _ := editorProgram(t, "export function f(s: { readonly n: number }) { s.n = 1 }\n")
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			if d.Code() == 2540 && len(d.MessageChain()) != 0 {
				t.Errorf("a written readonly modifier got a note: %v", d.MessageChain()[0].String())
			}
		}
	})
}
