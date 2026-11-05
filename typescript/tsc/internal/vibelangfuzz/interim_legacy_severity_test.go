package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"slices"
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
	for _, code := range []int32{4816, 4818, 4821, 4822, 4823, 4824, 4825} {
		for _, severity := range []string{"error", "warning", "off"} {
			t.Run(fmt.Sprintf("%d/%s", code, severity), func(t *testing.T) { checkInterimLegacySeverity(t, code, severity) })
		}
	}
}

// lsrules.fail raises these to errors through compilerOptions.vibelang.diagnostics.
var interimLegacyWarnings = []int32{4804, 4805, 4806, 4807, 4808, 4809, 4810, 4812, 4815}

func checkInterimLegacyWarning(t *testing.T, code int32) {
	TestInterimLegacySeveritiesQuoted(t)
	name := fmt.Sprintf("EK%04d", code)
	if !slices.Contains(Facts().Interim, code) || Facts().Default(code) != DefaultWarning || Facts().IsAdjustable(code) {
		t.Fatalf("fixture %s must be an interim warning outside modern configurable keys", name)
	}
	file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "fixture/main.vibe", PathKey: "fixture/main.vibe"}, "x", core.ScriptKindTS)
	reported := func(category diagnostics.Category) *ast.Diagnostic {
		return ast.NewExternalDiagnostic(file, core.NewTextRange(0, 1), "EK", category, code, "configured legacy warning")
	}
	raised := EffectiveSeverities(&core.VibeLangOptions{Diagnostics: map[string]string{name: "error"}})
	for _, tc := range []struct {
		name       string
		category   diagnostics.Category
		severities []map[string]string
		gap        bool
	}{
		{"default warning", diagnostics.CategoryWarning, nil, false},
		{"raised to error", diagnostics.CategoryError, []map[string]string{raised}, false},
		{"error without configuration", diagnostics.CategoryError, nil, true},
		{"raised but printed as a warning", diagnostics.CategoryWarning, []map[string]string{raised}, true},
	} {
		g := &Gaps{}
		CheckDiagnostics(g, "fixture", []*ast.Diagnostic{reported(tc.category)}, true, tc.severities...)
		if g.Any() != tc.gap {
			Gap(t, "FuzzInterimLegacySeverities", "policy:"+name+":warning-default", "%s: gaps %v", tc.name, g.found)
		}
	}
	ExpectPending(t, "FuzzInterimLegacySeverities", "policy:"+name+":warning-default")
}

func TestInterimLegacyWarningOverrides(t *testing.T) {
	for _, code := range interimLegacyWarnings {
		t.Run(fmt.Sprint(code), func(t *testing.T) { checkInterimLegacyWarning(t, code) })
	}
}

// VIP-30 keeps interim EK92xx out of configuration, so a legacy map entry for
// EK9204 moves nothing and its default category still holds.
func TestInterimEK92xxIgnoresLegacySeverity(t *testing.T) {
	TestInterimSeverityRulesQuoted(t)
	file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "fixture/main.vibe", PathKey: "fixture/main.vibe"}, "x", core.ScriptKindTS)
	raised := EffectiveSeverities(&core.VibeLangOptions{Diagnostics: map[string]string{"EK9204": "error"}})
	for _, tc := range []struct {
		category diagnostics.Category
		gap      bool
	}{{diagnostics.CategoryWarning, false}, {diagnostics.CategoryError, true}} {
		d := ast.NewExternalDiagnostic(file, core.NewTextRange(0, 1), "EK", tc.category, 9204, "interim warning")
		g := &Gaps{}
		CheckDiagnostics(g, "fixture", []*ast.Diagnostic{d}, true, raised)
		if g.Any() != tc.gap {
			t.Fatalf("%v: gaps %v", tc.category, g.found)
		}
	}
}

func FuzzInterimLegacySeverities(f *testing.F) {
	startShortBudget(f)
	for code := uint8(0); code < 7; code++ {
		f.Add(code, uint8(0))
		f.Add(code, uint8(1))
		f.Add(code, uint8(2))
	}
	f.Fuzz(func(t *testing.T, code, category uint8) {
		checkInterimLegacySeverity(t, []int32{4816, 4818, 4821, 4822, 4823, 4824, 4825}[code%7], []string{"error", "warning", "off"}[category%3])
	})
}
