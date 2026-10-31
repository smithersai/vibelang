package vibelangfmt

import (
	"testing"
)

// A missing body separator is a VibeLang syntax error (EK1306, EK0908): the
// formatter refuses the file with its line and column, as for any syntax
// error, and never inserts the separator itself.
func TestFormatRefusesMissingSeparator(t *testing.T) {
	for _, tc := range []struct{ source, at string }{
		{"export error E { a: number b: string }\n", "1:28:"},
		{"export error E { a(): number a(): number { return 1 } }\n", "1:30:"},
		{"export schema error E {\n  id: string get label() { return this.id }\n}\n", "2:14:"},
		{"export service S { a: number b: string }\n", "1:30:"},
	} {
		t.Run(tc.source, func(t *testing.T) {
			formatted, err := Format("main.vibe", tc.source, func(text string) (string, error) { return text, nil })
			if err == nil {
				t.Fatalf("formatted a missing separator: %q", formatted)
			}
			if msg := err.Error(); msg != "main.vibe: vibelang format: "+tc.at+" two members need a separator: write ; or a line break before this one" {
				t.Fatalf("got %q, want the refusal at %s", msg, tc.at)
			}
		})
	}
}
