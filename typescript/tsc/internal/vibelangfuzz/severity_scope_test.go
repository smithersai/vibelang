package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// Chapter 007 / own warnings remain distinct from imported rule severity overrides: docs/design/src/007-tooling.md#cef47c7292c08f00

func TestUnrelatedSeverityKeepsDiagnosticDefaults(t *testing.T) {
	project := Project{Config: `{"vibe":{"severities":{"EK4610":"off"}}}`}
	file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/project/main.vibe", PathKey: "/project/main.vibe"}, "x", core.ScriptKindTS)
	d := ast.NewExternalDiagnostic(file, core.NewTextRange(0, 1), "EK", diagnostics.CategoryError, 4609, "unconfigured Fiber warning")
	gaps := &Gaps{}
	CheckDiagnostics(gaps, "/project", []*ast.Diagnostic{d}, DefaultsApply(project))
	if !gaps.Any() {
		t.Fatal("an EK4610 override disabled the default warning category check for EK4609")
	}
}

const severityScopeQuote = "`severities` merges entry by diagnostic code"

func TestSeverityScopeQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), severityScopeQuote) {
		t.Fatalf("VIP-30 no longer says %q", severityScopeQuote)
	}
	TestCurrentDiagnosticPolicyQuoted(t)
}

func severityScopeWitness(t *testing.T, key string, variant uint8) {
	t.Helper()
	TestSeverityScopeQuoted(t)
	code, other := int32(4609), int32(4610)
	if key == "deferred" {
		code, other = 4610, 4609
	} else if key == "fixed-error" {
		code = 4701
	} else {
		key = "fiber"
	}
	categories := []diagnostics.Category{diagnostics.CategoryError, diagnostics.CategoryWarning, diagnostics.CategorySuggestion}
	got := categories[int(variant)%3]
	severity := []string{"error", "warning", "suggestion", "off"}[int(variant)/3%4]
	mode := int(variant) / 12 % 3
	overrides := map[string]string{}
	if mode == 1 {
		overrides[fmt.Sprintf("EK%04d", code)] = severity
	}
	if mode == 2 {
		overrides[fmt.Sprintf("EK%04d", other)] = severity
	}
	encoded, err := json.Marshal(map[string]any{"vibe": map[string]any{"severities": overrides}})
	if err != nil {
		t.Fatal(err)
	}
	project := Project{Config: string(encoded)}
	file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/project/main.vibe", PathKey: "/project/main.vibe"}, "x", core.ScriptKindTS)
	d := ast.NewExternalDiagnostic(file, core.NewTextRange(0, 1), "EK", got, code, "severity scope witness")
	gaps := &Gaps{}
	CheckDiagnostics(gaps, "/project", []*ast.Diagnostic{d}, DefaultsApply(project), overrides)
	want := diagnostics.CategoryWarning
	if key == "fixed-error" {
		want = diagnostics.CategoryError
	} else if mode == 1 {
		want = map[string]diagnostics.Category{"error": diagnostics.CategoryError, "warning": diagnostics.CategoryWarning, "suggestion": diagnostics.CategorySuggestion}[severity]
	}
	valid := got == want
	if mode == 1 && severity == "off" && key != "fixed-error" {
		valid = false
	}
	if gaps.Any() == valid {
		Gap(t, "FuzzDiagnosticSeverityScope", fmt.Sprintf("severity:%s:mode%d:%s:category%d", key, mode, severity, got), "VIP-30 per-code override must preserve other defaults and fixed errors: valid=%t gaps=%v", valid, gaps.found)
	}
}

func TestDiagnosticSeverityScopeRegression(t *testing.T) {
	for _, key := range []string{"fiber", "deferred", "fixed-error"} {
		for variant := uint8(0); variant < 36; variant++ {
			t.Run(fmt.Sprintf("%s/%d", key, variant), func(t *testing.T) { severityScopeWitness(t, key, variant) })
		}
	}
}

func FuzzDiagnosticSeverityScope(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"fiber", "deferred", "fixed-error"} {
		for _, variant := range []uint8{0, 12, 24} {
			f.Add(key, variant)
		}
	}
	f.Fuzz(func(t *testing.T, key string, variant uint8) { severityScopeWitness(t, key, variant) })
}

func TestCompileSeverityOverridesByCode(t *testing.T) {
	w := NewWorkspace(t)
	source := "import type { Fiber, Deferred } from \"effect\"\nexport async function fiber(v: Fiber.Fiber<number>) { return await v }\nexport async function deferred(v: Deferred.Deferred<number>) { return await v }"
	for _, scenario := range []struct {
		name          string
		parent, child map[string]string
	}{
		{"defaults", nil, nil},
		{"local", nil, map[string]string{"EK4609": "error", "EK4610": "off"}},
		{"inherited", map[string]string{"EK4609": "error", "EK4610": "off"}, nil},
		{"child-overrides", map[string]string{"EK4609": "error", "EK4610": "off"}, map[string]string{"EK4609": "warning"}},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			var root map[string]any
			if err := json.Unmarshal([]byte(DefaultConfig), &root); err != nil {
				t.Fatal(err)
			}
			files := map[string]string{"main.vibe": source}
			if scenario.parent != nil {
				data, _ := json.Marshal(map[string]any{"vibe": map[string]any{"severities": scenario.parent}})
				files["base.json"] = string(data)
				root["extends"] = "./base.json"
			}
			if scenario.child != nil {
				root["vibe"] = map[string]any{"severities": scenario.child}
			}
			data, _ := json.Marshal(root)
			files["tsconfig.json"] = string(data)
			CheckCompile(t, w, "FuzzCompile", Archive(files))
		})
	}
}
