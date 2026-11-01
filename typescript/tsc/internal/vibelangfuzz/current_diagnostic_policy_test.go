package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

var currentDiagnosticPolicyQuotes = []string{
	"A row whose rule starts \"warning\" or \"lint warning\" is a warning; every other code is an error.",
	"Only a warning's code, or an `EK38xx` code, may appear in `vibe.severities`",
	"| `EK4609` | lint warning:",
	"| `EK4610` | lint warning:",
}

func TestCurrentDiagnosticPolicyQuoted(t *testing.T) {
	chapter := SpecText(grammarAppendix)
	for _, quote := range currentDiagnosticPolicyQuotes {
		if !strings.Contains(chapter, quote) {
			t.Fatalf("Appendix B no longer says %q; update the oracle", quote)
		}
	}
}

func currentDiagnosticWitness(t *testing.T, key string, variant uint8) {
	t.Helper()
	TestCurrentDiagnosticPolicyQuoted(t)
	code := int32(4609)
	if key == "deferred" {
		code = 4610
	} else if key == "fixed-error" {
		code = 4701
	} else {
		key = "fiber"
	}
	categories := []diagnostics.Category{diagnostics.CategoryError, diagnostics.CategoryWarning, diagnostics.CategorySuggestion}
	category := categories[int(variant)%len(categories)]
	configured := variant&4 != 0
	// VIP-5/Appendix B call Fiber and Deferred await advisories warnings.
	// VIP-30 permits warning overrides but never downgrading a language error.
	valid := category == diagnostics.CategoryWarning || configured
	if key == "fixed-error" {
		valid = category == diagnostics.CategoryError
	}
	file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/project/main.vibe", PathKey: "/project/main.vibe"}, "x", core.ScriptKindTS)
	d := ast.NewExternalDiagnostic(file, core.NewTextRange(0, 1), "EK", category, code, "diagnostic policy witness")
	gaps := &Gaps{}
	CheckDiagnostics(gaps, "/project", []*ast.Diagnostic{d}, !configured)
	if gaps.Any() == valid {
		Gap(t, "FuzzCurrentDiagnosticPolicy", fmt.Sprintf("policy:%s:category-%d:configured-%t", key, category, configured),
			"VIP-5, VIP-30, VIP-34: current warning policy must apply; valid=%t gaps=%v", valid, gaps.found)
	}
}

func TestCurrentDiagnosticPolicyRegression(t *testing.T) {
	for _, key := range []string{"fiber", "deferred", "fixed-error"} {
		for variant := uint8(0); variant < 8; variant++ {
			t.Run(fmt.Sprintf("%s/%d", key, variant), func(t *testing.T) { currentDiagnosticWitness(t, key, variant) })
		}
	}
}

func FuzzCurrentDiagnosticPolicy(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"fiber", "deferred", "fixed-error"} {
		f.Add(key, uint8(0))
		f.Add(key, uint8(1))
		f.Add(key, uint8(6))
	}
	f.Fuzz(func(t *testing.T, key string, variant uint8) { currentDiagnosticWitness(t, key, variant) })
}

// Keep the original acceptance witness selected regardless of the short
// sampler's stride, so unrelated case additions cannot hide this regression.
func TestCompileCurrentDiagnosticPolicy(t *testing.T) {
	for _, seed := range CaseSeeds() {
		if seed.Name == "vibe-severities" {
			CheckCompile(t, NewWorkspace(t), "FuzzCompile", Archive(seed.Files))
			return
		}
	}
	t.Fatal("missing vibe-severities acceptance witness")
}
