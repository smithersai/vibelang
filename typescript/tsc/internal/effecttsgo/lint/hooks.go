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
	effectconfigraw.Register()
	effectconfigcheck.Register()
	checker.RegisterAfterCheckSourceFileCallback(afterCheckSourceFile)
	checker.RegisterExpressionCheckedCallback(typeparser.RecordCheckedExpressionType)
}

func afterCheckSourceFile(ctx context.Context, program checker.Program, c *checker.Checker, sf *ast.SourceFile) {
	options := program.Options().Effect
	if options == nil {
		return
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
	diagnostics, err := rulerunner.Run(ctx, program, c, sf, options, ruleNamesFor(sf), rulerunner.MinVisibleSeverity(options))
	if err != nil {
		return nil
	}
	return diagnostics
}
