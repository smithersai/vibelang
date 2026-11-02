package vibelangfuzz

import (
	"encoding/json"
	"maps"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestLegacySeverityQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), legacySeverityQuote) {
		t.Fatalf("007-tooling.md no longer says %q", legacySeverityQuote)
	}
}

func TestEffectiveSeverities(t *testing.T) {
	TestLegacySeverityQuoted(t)
	for _, c := range []struct {
		name           string
		legacy, modern map[string]string
		want           map[string]string
	}{
		{"none", nil, nil, nil},
		{"legacy", map[string]string{"EK4802": "error"}, nil, map[string]string{"EK4802": "error"}},
		{"modern", nil, map[string]string{"EK4802": "off"}, map[string]string{"EK4802": "off"}},
		{"modern-wins", map[string]string{"EK4802": "error", "EK4409": "off"}, map[string]string{"EK4802": "warning"}, map[string]string{"EK4802": "warning", "EK4409": "off"}},
	} {
		got := EffectiveSeverities(&core.VibeLangOptions{Diagnostics: c.legacy, Severities: c.modern})
		if !maps.Equal(got, c.want) {
			t.Errorf("%s: EffectiveSeverities = %v, want %v", c.name, got, c.want)
		}
	}
	if got := EffectiveSeverities(nil); got != nil {
		t.Errorf("EffectiveSeverities(nil) = %v, want nil", got)
	}
}

// TestCompileLegacySeverityMap compiles a project whose legacy
// vibelang.diagnostics map raises EK4802 (lsrules.fail's tsconfig): FuzzCompile
// and FuzzSplice must accept the category the legacy setting gives it, and a
// modern vibe.severities entry for the same code must win.
func TestCompileLegacySeverityMap(t *testing.T) {
	w := NewWorkspace(t)
	source := "export effect function nested(program: Effect.Effect<number>) {\n  try Effect.succeed(1)\n  return program\n}\n"
	for _, c := range []struct {
		name   string
		legacy string
		modern string
		want   diagnostics.Category
	}{
		{"legacy-error", "error", "", diagnostics.CategoryError},
		{"modern-wins", "error", "warning", diagnostics.CategoryWarning},
	} {
		t.Run(c.name, func(t *testing.T) {
			var root map[string]any
			if err := json.Unmarshal([]byte(DefaultConfig), &root); err != nil {
				t.Fatal(err)
			}
			options := root["compilerOptions"].(map[string]any)
			options["vibelang"] = map[string]any{"diagnostics": map[string]string{"EK4802": c.legacy}}
			if c.modern != "" {
				root["vibe"] = map[string]any{"severities": map[string]string{"EK4802": c.modern}}
			}
			data, _ := json.Marshal(root)
			files := map[string]string{"main.vibe": source, "tsconfig.json": string(data)}
			project := ProjectFromArchive(Archive(files))
			a, err := w.CompileOrdered(t.Context(), project, OrderTsc, true)
			if err != nil {
				t.Fatal(err)
			}
			found := false
			for _, d := range a.Diagnostics {
				if IsEK(d) && d.Code() == 4802 {
					found = true
					if d.Category() != c.want {
						t.Fatalf("EK4802 was reported as %s, want %s", d.Category().Name(), c.want.Name())
					}
				}
			}
			a.Remove()
			if !found {
				t.Fatal("the witness reports no EK4802, so it tests nothing")
			}
			CheckCompile(t, w, "FuzzCompile", Archive(files))
		})
	}
}
