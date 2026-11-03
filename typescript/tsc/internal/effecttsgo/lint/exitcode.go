package lint

import (
	"github.com/microsoft/TypeScript/tsc/internal/effecttsgo/etscore"
	"github.com/microsoft/TypeScript/tsc/internal/effecttsgo/etsexecutehooks"
	"github.com/microsoft/TypeScript/tsc/internal/effecttsgo/internal/rules"
	"github.com/microsoft/TypeScript/tsc/internal/effecttsgo/shim/ast"
	"github.com/microsoft/TypeScript/tsc/internal/effecttsgo/shim/compiler"
	shimcore "github.com/microsoft/TypeScript/tsc/internal/effecttsgo/shim/core"
	"github.com/microsoft/TypeScript/tsc/internal/effecttsgo/shim/execute/tsc"
)

// The exit-code and noEmitOnError filters etsexecutehooks registers drop the
// Effect diagnostics that the plugin's ignoreEffectErrorsInTscExitCode,
// ignoreEffectWarningsInTscExitCode and ignoreEffectSuggestionsInTscExitCode
// name, and they know a diagnostic as Effect's by its 377xxx code. The rules
// here report EK38xx codes (importedDiagnostics), so these filters replace
// them, judging each rule's diagnostic by the code Effect gave it.
func init() {
	tsc.RegisterFilterDiagnosticsForExitCodeCallback(filterForExitCode)
	compiler.RegisterFilterDiagnosticsForNoEmitOnErrorCallback(filterForExitCode)
}

// effectRuleCodes maps each imported rule's EK38xx code to a code Effect
// reports for that rule.
var effectRuleCodes = func() map[int32]int32 {
	result := map[int32]int32{}
	for _, r := range rules.All {
		if code, ok := importedRuleCodes[r.Name]; ok && len(r.Codes) > 0 {
			result[code] = r.Codes[0]
		}
	}
	return result
}()

// filterForExitCode is etsexecutehooks.FilterDiagnosticsForExitCode over the
// diagnostics as Effect reported them: each imported rule's diagnostic stands
// in under its Effect code, and the ones the filter keeps come back as they
// were printed.
func filterForExitCode(opts *shimcore.CompilerOptions, diagnostics []*ast.Diagnostic) []*ast.Diagnostic {
	effect := opts.Effect
	if effect == nil {
		if !configuresImportedLint(opts.VibeLang) {
			return diagnostics
		}
		// A code severity entry enables the same default plugin as run(). Its
		// default suggestion-ignore policy must apply to exit and emit as well.
		effect = etscore.ParseFromPlugins([]any{map[string]any{"name": etscore.EffectPluginName}})
	}
	judged := make([]*ast.Diagnostic, len(diagnostics))
	printed := map[*ast.Diagnostic]*ast.Diagnostic{}
	for i, d := range diagnostics {
		judged[i] = d
		if code, ok := effectRuleCodes[d.Code()]; ok && d.Source() == "EK" {
			judged[i] = ast.NewExternalDiagnostic(d.File(), d.Loc(), "", d.Category(), code, "")
			printed[judged[i]] = d
		}
	}
	kept := etsexecutehooks.FilterDiagnosticsForExitCode(effect, judged)
	for i, d := range kept {
		if original, ok := printed[d]; ok {
			kept[i] = original
		}
	}
	return kept
}
