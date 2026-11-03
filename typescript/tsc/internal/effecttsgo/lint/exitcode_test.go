package lint

import (
	"math/rand"
	"slices"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/effecttsgo/etscore"
	"github.com/microsoft/TypeScript/tsc/internal/effecttsgo/shim/ast"
	shimcore "github.com/microsoft/TypeScript/tsc/internal/effecttsgo/shim/core"
	"github.com/microsoft/TypeScript/tsc/internal/effecttsgo/shim/diagnostics"
)

// opencode's http-recorder build ran stock `bunx tsc --emitDeclarationOnly`,
// which ignores the tsconfig's @effect/language-service entry and exited 0.
// Setup replaced it with vibelang, whose only diagnostics were imported
// unstableApiUsage warnings (EK38130), and the build exited 2. Setup now
// writes the plugin's own exit options into the entry; vibelang honors them
// (VIP-38 R3). As in @effect/tsgo (etscore.EffectPluginOptions), each option
// covers its own category: ignoreEffectWarningsInTscExitCode warnings,
// ignoreEffectErrorsInTscExitCode errors. The witness:
//
//	import { FileSystem } from "effect"
//	export const api = FileSystem.FileSystem
func TestEffectExitOptionsWitness(t *testing.T) {
	code := importedRuleCodes["unstableApiUsage"]
	if code == 0 {
		t.Fatal("unstableApiUsage has no imported code")
	}
	warning := ast.NewExternalDiagnostic(nil, shimcore.NewTextRange(0, 1), "EK", diagnostics.CategoryWarning, code, "unstableApiUsage: `effect/FileSystem#FileSystem` is an unstable API.")
	affects := func(plugin map[string]any) bool {
		plugin["name"] = etscore.EffectPluginName
		opts := &shimcore.CompilerOptions{Effect: etscore.ParseFromPlugins([]any{plugin})}
		return slices.ContainsFunc(filterForExitCode(opts, []*ast.Diagnostic{warning}), (*ast.Diagnostic).AffectsBuild)
	}
	if !affects(map[string]any{}) {
		t.Fatal("without the options an imported warning must fail the build (VIP-38 R3)")
	}
	if affects(map[string]any{"ignoreEffectWarningsInTscExitCode": true, "ignoreEffectErrorsInTscExitCode": true}) {
		t.Fatal("with the options setup writes, a warnings-only build must exit 0, as the replaced tsc did")
	}
	if !affects(map[string]any{"ignoreEffectErrorsInTscExitCode": true}) {
		t.Fatal("ignoreEffectErrorsInTscExitCode covers errors only; a warning must still fail")
	}
}

// FuzzEffectExitOptions: over any mix of own and imported diagnostics of every
// category and any plugin exit options, the filter keeps every own VibeLang
// and TypeScript diagnostic, and drops an imported one exactly when its
// category's option is set (suggestions and messages: ignoreEffectSuggestions,
// default true; warnings; errors).
func FuzzEffectExitOptions(f *testing.F) {
	f.Add(int64(1), uint8(1), uint8(0))
	f.Add(int64(38130), uint8(6), uint8(3))
	f.Fuzz(func(t *testing.T, seed int64, size uint8, ignores uint8) {
		r := rand.New(rand.NewSource(seed))
		categories := []diagnostics.Category{diagnostics.CategoryError, diagnostics.CategoryWarning, diagnostics.CategorySuggestion, diagnostics.CategoryMessage}
		imported := []int32{importedRuleCodes["unstableApiUsage"], importedRuleCodes["floatingEffect"], importedRuleCodes["schemaNumber"]}
		var diags []*ast.Diagnostic
		for i := range int(size % 12) {
			category := categories[r.Intn(len(categories))]
			switch r.Intn(4) {
			case 0: // an imported rule, printed as EK38xx
				diags = append(diags, ast.NewExternalDiagnostic(nil, shimcore.NewTextRange(i, i+1), "EK", category, imported[r.Intn(len(imported))], "imported"))
			case 1: // Effect's own code range
				diags = append(diags, ast.NewExternalDiagnostic(nil, shimcore.NewTextRange(i, i+1), "", category, 377000+int32(r.Intn(999)), "effect"))
			case 2: // an own VibeLang diagnostic
				diags = append(diags, ast.NewExternalDiagnostic(nil, shimcore.NewTextRange(i, i+1), "EK", category, 4609, "own"))
			default: // a TypeScript diagnostic
				diags = append(diags, ast.NewExternalDiagnostic(nil, shimcore.NewTextRange(i, i+1), "", category, 2322, "ts"))
			}
		}
		plugin := map[string]any{"name": etscore.EffectPluginName}
		set := func(bit uint8, key string) bool {
			if ignores&(bit<<3) != 0 { // unset: the option's default
				return key == "ignoreEffectSuggestionsInTscExitCode"
			}
			plugin[key] = ignores&bit != 0
			return ignores&bit != 0
		}
		ignoreErrors := set(1, "ignoreEffectErrorsInTscExitCode")
		ignoreWarnings := set(2, "ignoreEffectWarningsInTscExitCode")
		ignoreSuggestions := set(4, "ignoreEffectSuggestionsInTscExitCode")
		ignored := func(d *ast.Diagnostic) bool {
			if !d.IsImportedEffectLint() {
				return false
			}
			switch d.Category() {
			case diagnostics.CategoryError:
				return ignoreErrors
			case diagnostics.CategoryWarning:
				return ignoreWarnings
			default:
				return ignoreSuggestions
			}
		}
		opts := &shimcore.CompilerOptions{Effect: etscore.ParseFromPlugins([]any{plugin})}
		kept := filterForExitCode(opts, diags)
		want := slices.DeleteFunc(slices.Clone(diags), ignored)
		if !slices.Equal(kept, want) {
			t.Fatalf("options %v kept %d diagnostics, want %d", plugin, len(kept), len(want))
		}
	})
}
