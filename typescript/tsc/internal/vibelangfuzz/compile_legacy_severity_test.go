package vibelangfuzz

import (
	"encoding/json"
	"maps"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

func TestCompileLegacyDiagnosticOverrides(t *testing.T) {
	TestSeverityScopeQuoted(t)
	for _, severity := range []string{"error", "warning", "suggestion", "off"} {
		t.Run(severity, func(t *testing.T) {
			options := &core.VibeLangOptions{Diagnostics: map[string]string{"EK4802": severity}}
			// Legacy parsing admits three categories; suggestion belongs to
			// the modern map. Both paths keep the same per-code oracle.
			if severity == "suggestion" {
				options = &core.VibeLangOptions{Severities: map[string]string{"EK4802": severity}}
			}
			got := EffectiveSeverities(options)
			if got["EK4802"] != severity {
				t.Fatalf("lost legacy override: %v", got)
			}
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/project/main.vibe", PathKey: "/project/main.vibe"}, "x", core.ScriptKindTS)
			category := map[string]diagnostics.Category{"error": diagnostics.CategoryError, "warning": diagnostics.CategoryWarning, "suggestion": diagnostics.CategorySuggestion, "off": diagnostics.CategoryWarning}[severity]
			d := ast.NewExternalDiagnostic(file, core.NewTextRange(0, 1), "EK", category, 4802, "configured warning")
			gaps := &Gaps{}
			CheckDiagnostics(gaps, "/project", []*ast.Diagnostic{d}, true, got)
			if gaps.Any() != (severity == "off") {
				t.Fatalf("wrong configured category check: %v", gaps.found)
			}
			other := ast.NewExternalDiagnostic(file, core.NewTextRange(0, 1), "EK", diagnostics.CategoryError, 4609, "unrelated default warning")
			gaps = &Gaps{}
			CheckDiagnostics(gaps, "/project", []*ast.Diagnostic{other}, true, got)
			if !gaps.Any() {
				t.Fatal("legacy override disabled another diagnostic's default")
			}
		})
	}
	t.Run("precedence and input ownership", func(t *testing.T) {
		legacy := map[string]string{"EK4802": "error"}
		modern := map[string]string{"EK4802": "warning"}
		got := EffectiveSeverities(&core.VibeLangOptions{Diagnostics: legacy, Severities: modern})
		if got["EK4802"] != "warning" {
			t.Fatal(got)
		}
		got["EK4802"] = "off"
		if !maps.Equal(legacy, map[string]string{"EK4802": "error"}) || !maps.Equal(modern, map[string]string{"EK4802": "warning"}) {
			t.Fatal("mutated parsed settings")
		}
	})
	t.Run("invalid parsed legacy entries do not hide defaults", func(t *testing.T) {
		w := NewWorkspace(t)
		for _, invalid := range []map[string]string{
			{"EK4701": "warning"},
			{"EK4802": "bogus"},
			{"EK4802": "suggestion"},
		} {
			var root map[string]any
			if err := json.Unmarshal([]byte(DefaultConfig), &root); err != nil {
				t.Fatal(err)
			}
			root["compilerOptions"].(map[string]any)["vibelang"] = map[string]any{"diagnostics": invalid}
			config, err := json.Marshal(root)
			if err != nil {
				t.Fatal(err)
			}
			files := map[string]string{
				"main.vibe":     "export effect function nested(program: Effect.Effect<number>) { try Effect.succeed(1); return program }",
				"tsconfig.json": string(config),
			}
			project := ProjectFromArchive(Archive(files))
			result, err := w.CompileOrdered(t.Context(), project, OrderTsc, true)
			if err != nil {
				t.Fatal(err)
			}
			defer result.Remove()
			if result.Program == nil {
				t.Fatal("invalid-config fixture has no parsed program")
			}
			got := EffectiveSeverities(result.Program.Options().VibeLang)
			if len(got) != 0 {
				t.Fatalf("invalid legacy entry survived parsing: %v", got)
			}
			found := false
			for _, diagnostic := range result.Diagnostics {
				if IsEK(diagnostic) && diagnostic.Code() == 4802 {
					found = true
					if diagnostic.Category() != diagnostics.CategoryWarning {
						t.Fatal(diagnostic.String())
					}
				}
			}
			if !found {
				t.Fatal("fixture did not report the unrelated default warning")
			}
			CheckCompile(t, w, "FuzzCompile", Archive(files))
		}
	})
}

func TestCompileLegacySeverityFixture(t *testing.T) {
	for _, seed := range CaseSeeds() {
		if seed.Name == "returned-union-as-data.fail" {
			CheckCompile(t, NewWorkspace(t), "FuzzCompile", Archive(seed.Files))
			return
		}
	}
	t.Fatal("fixture not found")
}
