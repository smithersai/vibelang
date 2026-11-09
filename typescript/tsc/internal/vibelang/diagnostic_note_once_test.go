package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
)

// Repeated registry entries must not duplicate diagnostic notes.
func TestDiagnosticNotesAppearOnce(t *testing.T) {
	file := parseVibeLang(t, "export const value = 1\n")
	settings := map[string]string{}
	for _, m := range registry {
		settings[m.String()] = "warning"
	}
	options := &core.CompilerOptions{VibeLang: &core.VibeLangOptions{Diagnostics: settings}}
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

	}
}
