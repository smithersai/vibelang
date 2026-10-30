// Package lint runs Effect's type-aware lint rules, vendored from Effect-TS/tsgo
// in the directories beside it, inside the VibeLang compiler (VIP-38).
//
// It is VibeLang's own code: sync.sh never touches it. It registers the same
// checker hooks as effect-tsgo's etscheckerhooks, so a tsconfig.json plugin entry
// { "name": "@effect/language-service", ... } reports the rules' diagnostics in
// builds and the language server, for .ts and .vibe files alike; Command is
// `vibelang lint`, which takes the rules from an Oxlint configuration instead.
package lint

import (
	"context"
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/effecttsgo/internal/rules"
	"github.com/microsoft/TypeScript/tsc/internal/locale"
	"maps"
	"slices"
	"strconv"

	"github.com/microsoft/TypeScript/tsc/internal/effecttsgo/etscore"
	_ "github.com/microsoft/TypeScript/tsc/internal/effecttsgo/etsexecutehooks"
	"github.com/microsoft/TypeScript/tsc/internal/effecttsgo/internal/effectconfigcheck"
	"github.com/microsoft/TypeScript/tsc/internal/effecttsgo/internal/effectconfigraw"
	"github.com/microsoft/TypeScript/tsc/internal/effecttsgo/internal/rulerunner"
	"github.com/microsoft/TypeScript/tsc/internal/effecttsgo/internal/typeparser"
	"github.com/microsoft/TypeScript/tsc/internal/effecttsgo/shim/ast"
	"github.com/microsoft/TypeScript/tsc/internal/effecttsgo/shim/checker"
)

func init() {
	names := slices.Sorted(maps.Keys(vibeAnswers))
	for _, name := range names {
		if answer := vibeAnswers[name]; answer.ek != "" {
			core.VibeLintPorts[answer.ek] = append(core.VibeLintPorts[answer.ek], fmt.Sprintf("EK%d", importedRuleCodes[name]))
		}
	}

	effectconfigraw.Register()
	effectconfigcheck.Register()
	checker.RegisterAfterCheckSourceFileCallback(afterCheckSourceFile)
	checker.RegisterExpressionCheckedCallback(typeparser.RecordCheckedExpressionType)
}

func afterCheckSourceFile(ctx context.Context, program checker.Program, c *checker.Checker, sf *ast.SourceFile) {
	options := program.Options().Effect
	if options == nil {
		if program.Options().VibeLang == nil || len(program.Options().VibeLang.Severities) == 0 {
			return
		}
		options = etscore.ParseFromPlugins([]any{map[string]any{"name": etscore.EffectPluginName}})
	}
	for _, d := range run(ctx, program, c, sf, options) {
		c.AddDiagnostic(d)
	}
}

// run reports the rules options enables for sf, leaving out on a .vibe file
// the rules whose pattern VibeLang's syntax gives another meaning (vibeRules).
func run(ctx context.Context, program checker.Program, c *checker.Checker, sf *ast.SourceFile, options *etscore.EffectPluginOptions) []*ast.Diagnostic {
	// Rule queries must not overwrite the types the check recorded.
	defer typeparser.PauseCheckedExpressionTypes(c)()
	options = releaseSeverities(options, program.Options().VibeLang)

	diagnostics, err := rulerunner.Run(ctx, program, c, sf, options, ruleNamesFor(sf), rulerunner.MinVisibleSeverity(options))
	if err != nil {
		return nil
	}
	return importedDiagnostics(diagnostics)
}

// The pin assigns floatingEffect first, then ASCII order (details 106/142).
var importedRuleCodes = func() map[string]int32 {
	result := map[string]int32{}
	for code, name := range core.VibeImportedLintCodes {
		n, _ := strconv.Atoi(code[2:])
		result[name] = int32(n)
	}
	return result
}()

func releaseSeverities(base *etscore.EffectPluginOptions, vibe *core.VibeLangOptions) *etscore.EffectPluginOptions {
	if vibe == nil || len(vibe.Severities) == 0 {
		return base
	}
	result := *base
	result.DiagnosticSeverity = maps.Clone(base.DiagnosticSeverity)
	if result.DiagnosticSeverity == nil {
		result.DiagnosticSeverity = map[string]etscore.Severity{}
	}
	for name, code := range importedRuleCodes {
		if value, ok := vibe.Severities[fmt.Sprintf("EK%d", code)]; ok {
			result.DiagnosticSeverity[name] = etscore.ParseSeverity(value)
		}
	}
	// File overrides are resolved before release entries so the code setting wins.
	result.Overrides = slices.Clone(base.Overrides)
	for i := range result.Overrides {
		result.Overrides[i].Options.DiagnosticSeverity = maps.Clone(result.Overrides[i].Options.DiagnosticSeverity)
		if result.Overrides[i].Options.DiagnosticSeverity == nil {
			result.Overrides[i].Options.DiagnosticSeverity = map[string]etscore.Severity{}
		}
		for name, code := range importedRuleCodes {
			if value, ok := vibe.Severities[fmt.Sprintf("EK%d", code)]; ok {
				result.Overrides[i].Options.DiagnosticSeverity[name] = etscore.ParseSeverity(value)
			}
		}
	}
	return &result
}

func importedDiagnostics(items []*ast.Diagnostic) []*ast.Diagnostic {
	var result []*ast.Diagnostic
	for _, d := range items {
		name := ""
		for _, r := range rules.All {
			if slices.Contains(r.Codes, d.Code()) {
				name = r.Name
				break
			}
		}
		if code, ok := importedRuleCodes[name]; ok {
			result = append(result, ast.NewExternalDiagnostic(d.File(), d.Loc(), "EK", d.Category(), code, name+": "+d.Localize(locale.Default)).SetMessageChain(d.MessageChain()).SetRelatedInfo(d.RelatedInformation()))
		} else {
			result = append(result, d)
		}
	}
	return result
}
