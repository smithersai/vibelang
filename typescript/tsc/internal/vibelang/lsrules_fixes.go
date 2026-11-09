package vibelang

import (
	"context"
	"runtime"
	"sync"
	"weak"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
)

// Shared source positions and checked analysis for diagnostics and explicit refactors.

// nodeStart returns where node's text starts, after its leading trivia.
func nodeStart(file *ast.SourceFile, node *ast.Node) int {
	return scanner.SkipTrivia(file.Text(), node.Pos())
}

// trustedValueEdit is a replacement in one of the two migration documents.
type trustedValueEdit struct {
	start, end int
	text       string
}

// EK9101 exposes unsafe data-method accesses as editor-only annotation fixes.
var EK9101 = message(9101, diagnostics.CategorySuggestion, "{0}")

// EK9100 asks for the annotation the text-only projector cannot infer. It is
// an editor warning before the emit switch; the CLI does not run this check.
var EK9100 = message(9100, legacyFormChoiceCategory, "{0}")

func init() {
	registry[EK9100.Code] = EK9100
	registry[EK9101.Code] = EK9101
	ls.RegisterFileDiagnosticsHook(formChoiceDiagnostics)
}

// formChoiceCache holds syntax-only results under weak source-file identities.
// A new file version gets a new AST; neither results nor cleanup retain it.
var formChoiceCache sync.Map // weak.Pointer[ast.SourceFile] -> func() []vibelangmapper.Diagnostic

// cachedFormChoices resolves only the requested file, once per immutable AST,
// and shares results across LS pulls and checker instances without retaining files.
func cachedFormChoices(file *ast.SourceFile) []vibelangmapper.Diagnostic {
	key := weak.Make(file)
	compute := sync.OnceValue(func() []vibelangmapper.Diagnostic {
		return vibelangmapper.FormDiagnostics(file)
	})
	cached, loaded := formChoiceCache.LoadOrStore(key, compute)
	if !loaded {
		runtime.AddCleanup(file, func(k weak.Pointer[ast.SourceFile]) { formChoiceCache.Delete(k) }, key)
	}
	return cached.(func() []vibelangmapper.Diagnostic)()
}

// formDiagnosticCache retains materialized editor diagnostics only while the
// owning program is alive; imported types and category settings can change
// across programs even when the open file's syntax has not changed.
var formDiagnosticCache sync.Map // weak.Pointer[compiler.Program] -> *sync.Map

// formChoiceDiagnostics shares one editor analysis per file and program across
// repeated pulls. Neither this cache nor the syntax cache retains a program.
func formChoiceDiagnostics(ctx context.Context, service *ls.LanguageService, file *ast.SourceFile) []*ast.Diagnostic {
	if !isVibeLangFile(file) {
		return nil
	}
	program := service.GetProgram()
	key := weak.Make(program)
	cache, loaded := formDiagnosticCache.LoadOrStore(key, &sync.Map{})
	if !loaded {
		runtime.AddCleanup(program, func(k weak.Pointer[compiler.Program]) { formDiagnosticCache.Delete(k) }, key)
	}
	compute := sync.OnceValue(func() []*ast.Diagnostic {
		// A canceled checker request must not poison later pulls of this version.
		defer func() {
			if reason := recover(); reason != nil {
				cache.(*sync.Map).Delete(file)
				panic(reason)
			}
		}()
		result := resolveFormChoiceDiagnostics(ctx, service, file)
		if ctx.Err() != nil {
			cache.(*sync.Map).Delete(file)
		}
		return result
	})
	result, _ := cache.(*sync.Map).LoadOrStore(file, compute)
	return result.(func() []*ast.Diagnostic)()
}

// resolveFormChoiceDiagnostics materializes cached syntax choices on demand.
// The CLI never calls this provider or pays for the forms resolver.
func resolveFormChoiceDiagnostics(ctx context.Context, service *ls.LanguageService, file *ast.SourceFile) []*ast.Diagnostic {
	choices := cachedFormChoices(file)
	if len(choices) == 0 {
		return nil
	}
	c, done := service.GetProgram().GetTypeCheckerForFile(ctx, file)
	defer done()
	var result []*ast.Diagnostic
	for _, choice := range choices {
		if d := newDiagnosticAt(optionsFor(c, file), file, core.NewTextRange(choice.Start, choice.Start+choice.Length), formChoiceMessage(choice.Code), choice.Message); d != nil {
			result = append(result, d)
		}
	}
	return result
}

// formChoiceMessage preserves the editor category for each projector choice.
func formChoiceMessage(code int32) *Message {
	if code == vibelangmapper.CodeDataMethod {
		return EK9101
	}
	return EK9100
}
