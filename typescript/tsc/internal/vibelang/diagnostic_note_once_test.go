package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
)

// A diagnostic with no automatic fix carries one note that says why. The note
// is attached by code when the diagnostic is made, so a code listed twice
// printed the same explanation twice.
func TestDiagnosticNotesAppearOnce(t *testing.T) {
	file := parseVibeLang(t, "export const value = 1\n")
	settings := map[string]string{}
	for _, m := range registry {
		settings[m.String()] = "warning"
	}
	options := &core.CompilerOptions{VibeLang: &core.VibeLangOptions{Diagnostics: settings}}
	noted := 0
	for code, m := range registry {
		d := newDiagnosticAt(options, file, core.NewTextRange(0, 6), m)
		if d == nil {
			continue
		}
		seen := map[string]bool{}
		for _, child := range d.MessageChain() {
			text := child.String()
			if seen[text] {
				t.Errorf("EK%d carries this note twice: %s", code, text)
			}
			seen[text] = true
		}
		if code == EK4810.Code && len(seen) > 0 {
			noted++
		}
	}
	if noted != 1 {
		t.Fatal("EK4810 was not made with its note")
	}
}
