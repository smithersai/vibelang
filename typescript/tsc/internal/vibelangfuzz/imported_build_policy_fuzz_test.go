package vibelangfuzz

import (
	"fmt"
	"maps"
	"os"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/effecttsgo/etscore"
	"github.com/microsoft/TypeScript/tsc/internal/execute/tsc"
)

const importedBuildPolicyQuote = "Imported Effect diagnostics in compiler builds follow their Effect language-service configuration"

func importedBuildPolicyQuoted(t testing.TB) {
	t.Helper()
	text, err := os.ReadFile(SpecPath("007-tooling.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), importedBuildPolicyQuote) {
		t.Fatalf("chapter 7 no longer says %q", importedBuildPolicyQuote)
	}
}

func TestImportedBuildPolicyQuoted(t *testing.T) { importedBuildPolicyQuoted(t) }

// Every imported ordinal is tested through both registered configuration
// filters. Own VibeLang warnings stay non-failing, even beside an imported
// warning that the repository explicitly ignores (Smithers R3).
func FuzzImportedBuildPolicy(f *testing.F) {
	startShortBudget(f)
	importedBuildPolicyQuoted(f)

	keys := append(slices.Sorted(maps.Keys(core.VibeImportedLintCodes)), "native", "own", "own-legacy", "other")
	categories := []diagnostics.Category{diagnostics.CategoryError, diagnostics.CategoryWarning, diagnostics.CategorySuggestion}
	names := []string{"error", "warning", "suggestion"}
	for _, key := range keys {
		for _, category := range names {
			for _, ignore := range []bool{false, true} {
				f.Add([]byte(fmt.Sprintf("%s:%s:%t", key, category, ignore)))
			}
		}
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		parts := strings.Split(string(data), ":")
		key, category, ignored := "", -1, false
		if len(parts) == 3 {
			if parts[0] == "native" || parts[0] == "own" || parts[0] == "own-legacy" || parts[0] == "other" || core.VibeImportedLintCodes[parts[0]] != "" {
				key = parts[0]
			}
			category = slices.Index(names, parts[1])
			ignored = parts[2] == "true"
			if parts[2] != "true" && parts[2] != "false" {
				category = -1
			}
		}
		if key == "" || category < 0 {
			if len(data) < 3 {
				t.Skip("no category, source and ignore selection")
			}
			key, category, ignored = keys[int(data[0])%len(keys)], int(data[1])%3, data[2]&1 == 1
		}
		source, code, prefix := "imported", int32(3897), "EK"
		switch key {
		case "native":
			source, code, prefix = "native", 377108, ""
		case "own":
			source, code = "own", 4833
		case "own-legacy":
			source, code, prefix = "own", 4804, "vibelang"
		case "other":
			source, code, prefix = "own", 4804, ""
		default:
			n, err := strconv.ParseInt(key[2:], 10, 32)
			if err != nil {
				t.Fatal(err)
			}
			code = int32(n)
		}
		d := ast.NewExternalDiagnostic(nil, core.NewTextRange(0, 0), prefix, categories[category], code, "build policy probe")
		opts := &core.CompilerOptions{Effect: &etscore.EffectPluginOptions{
			IgnoreEffectErrorsInTscExitCode: ignored, IgnoreEffectWarningsInTscExitCode: ignored, IgnoreEffectSuggestionsInTscExitCode: ignored,
		}}
		want := category == 0
		if source != "own" {
			want = !ignored
		}
		for name, filter := range map[string]func(*core.CompilerOptions, []*ast.Diagnostic) []*ast.Diagnostic{
			"exit": tsc.FilterDiagnosticsForExitCodeCallback, "emit": compiler.FilterDiagnosticsForNoEmitOnErrorCallback,
		} {
			if filter == nil {
				t.Fatalf("%s Effect filter is not registered", name)
			}
			ownWarning := ast.NewExternalDiagnostic(nil, core.NewTextRange(0, 0), "EK", diagnostics.CategoryWarning, 4833, "own warning beside imported diagnostic")
			kept := filter(opts, []*ast.Diagnostic{d, ownWarning})
			got := slices.ContainsFunc(kept, (*ast.Diagnostic).AffectsBuild)
			if got != want {
				t.Fatalf("%s %s %s ignore=%t blocks=%t, want %t", name, source, names[category], ignored, got, want)
			}
			defaults := &core.CompilerOptions{VibeLang: &core.VibeLangOptions{Severities: map[string]string{"EK3897": "suggestion"}}}
			defaultKept := filter(defaults, []*ast.Diagnostic{d, ownWarning})
			defaultBlocks := slices.ContainsFunc(defaultKept, (*ast.Diagnostic).AffectsBuild)
			defaultWant := category == 0
			if source != "own" {
				defaultWant = category != 2
			}
			if defaultBlocks != defaultWant {
				t.Fatalf("%s default plugin %s %s blocks=%t, want %t", name, source, names[category], defaultBlocks, defaultWant)
			}

		}
	})
}
