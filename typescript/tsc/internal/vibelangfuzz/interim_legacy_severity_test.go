package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"testing"
)

func TestInterimLegacySeveritiesQuoted(t *testing.T) {
	TestLegacySeverityQuoted(t)
	TestCurrentDiagnosticPolicyQuoted(t)
}

func checkInterimLegacySeverity(t *testing.T, code int32, severity string) {
	TestInterimLegacySeveritiesQuoted(t)
	file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "fixture/main.vibe", PathKey: "fixture/main.vibe"}, "x", core.ScriptKindTS)
	name := fmt.Sprintf("EK%04d", code)
	if !Facts().IsRegistered(code) || Facts().Default(code) != DefaultOff || Facts().IsAdjustable(code) {
		t.Fatalf("fixture %s must be an interim, default-off diagnostic outside modern configurable keys", name)
	}
	options := &core.VibeLangOptions{Diagnostics: map[string]string{name: severity}}
	category := diagnostics.CategoryWarning
	if severity == "error" {
		category = diagnostics.CategoryError
	}
	d := ast.NewExternalDiagnostic(file, core.NewTextRange(0, 1), "EK", category, code, "configured legacy warning")
	g := &Gaps{}
	CheckDiagnostics(g, "fixture", []*ast.Diagnostic{d}, true, EffectiveSeverities(options))
	if g.Any() != (severity == "off") {
		Gap(t, "FuzzInterimLegacySeverities", "policy:"+name+":"+severity, "legacy %s=%s: %v", name, severity, g.found)
	}
	// An override for one compatibility code cannot hide another rule's default.
	other := ast.NewExternalDiagnostic(file, core.NewTextRange(0, 1), "EK", diagnostics.CategoryWarning, 704, "unrelated language error")
	g = &Gaps{}
	CheckDiagnostics(g, "fixture", []*ast.Diagnostic{other}, true, EffectiveSeverities(options))
	if !g.Any() {
		Gap(t, "FuzzInterimLegacySeverities", "policy:"+name+":"+severity, "legacy override hid an unrelated language error's category")
	}
	g = &Gaps{}
	CheckDiagnostics(g, "fixture", []*ast.Diagnostic{d}, true)
	if !g.Any() {
		Gap(t, "FuzzInterimLegacySeverities", "policy:"+name+":"+severity, "unconfigured default-off diagnostic was admitted")
	}
	ExpectPending(t, "FuzzInterimLegacySeverities", "policy:"+name+":"+severity)
}

func TestInterimLegacySeverityOverrides(t *testing.T) {
	for code := int32(4821); code <= 4825; code++ {
		for _, severity := range []string{"error", "warning", "off"} {
			t.Run(fmt.Sprintf("%d/%s", code, severity), func(t *testing.T) { checkInterimLegacySeverity(t, code, severity) })
		}
	}
}

func FuzzInterimLegacySeverities(f *testing.F) {
	startShortBudget(f)
	for code := uint8(0); code < 5; code++ {
		f.Add(code, uint8(0))
		f.Add(code, uint8(1))
		f.Add(code, uint8(2))
	}
	f.Fuzz(func(t *testing.T, code, category uint8) {
		checkInterimLegacySeverity(t, 4821+int32(code%5), []string{"error", "warning", "off"}[category%3])
	})
}
