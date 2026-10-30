package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestReleaseSeverityCanonicalCodeKeys(t *testing.T) {
	for _, code := range []struct {
		number int32
		key    string
	}{
		{508, "EK0508"}, {703, "EK0703"}, {801, "EK0801"}, {38108, "EK38108"},
	} {
		for _, setting := range []struct {
			value string
			want  diagnostics.Category
			on    bool
		}{
			{"error", diagnostics.CategoryError, true},
			{"warning", diagnostics.CategoryWarning, true},
			{"suggestion", diagnostics.CategorySuggestion, true},
			{"off", diagnostics.CategoryWarning, false},
		} {
			t.Run(code.key+"/"+setting.value, func(t *testing.T) {
				options := &core.CompilerOptions{VibeLang: &core.VibeLangOptions{Severities: map[string]string{code.key: setting.value}}}
				got, on := category(options, message(code.number, warningCategory, "test warning"))
				if on != setting.on || on && got != setting.want {
					t.Fatalf("got category=%v on=%v; want category=%v on=%v", got, on, setting.want, setting.on)
				}
			})
		}
	}
}
