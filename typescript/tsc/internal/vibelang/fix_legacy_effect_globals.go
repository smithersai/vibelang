package vibelang

import (
	"context"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

func init() {
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{
		ErrorCodes:     []int32{2304, 2345, 2769},
		GetCodeActions: legacyEffectGlobalActions,
	})
}

// These run beside legacy hatch type repairs in every CLI fix mode.
func legacyPreludeCompatibilityFixes(ctx context.Context, program *compiler.Program, refused map[string]bool, legacy, preVIP bool) map[*ast.SourceFile]proposal {
	plans := legacyHatchTypeMigrationFixes(ctx, program, refused)
	for _, file := range fixableFiles(program) {
		p := legacyEffectGlobalFixes(ctx, program, file, refused, legacy, preVIP, nil)
		if len(p.fixes) == 0 {
			continue
		}
		if previous, ok := plans[file]; ok {
			p = previous.withFixes(p)
		}
		plans[file] = p
	}
	return plans
}

// A scope-first call previously reached the runtime wrapper. Snapshot its
// arguments in source order, then use the native program-first function.
// Keep the old runtime initialization; it ran before authored module imports.
func legacyEffectGlobalFixes(ctx context.Context, program *compiler.Program, file *ast.SourceFile, refused map[string]bool, legacy, preVIP bool, only *ls.CodeFixContext) proposal {
	p := proposal{file: file}
	if !isVibeLangFile(file) || (!file.HasIdentifier("forkIn") && !file.HasIdentifier("sync") && !file.HasIdentifier("callback")) {
		return p
	}
	c, done := program.GetTypeCheckerForFile(ctx, file)
	defer done()
	off := !effectGlobalsOn(c, file)
	names := &freshNames{file: file}
	fx := names.freshName("$legacyForkEffect")
	initialized := names.freshName("$legacyForkInit")
	scopeName := names.freshName("$legacyForkScope")
	programName := names.freshName("$legacyForkProgram")
	var scopeType *checker.Type
	if symbol := servicesFor(c).effectExport("Scope", "Scope"); symbol != nil {
		scopeType = c.GetDeclaredTypeOfSymbol(resolvedAlias(c, symbol))
	}
	nativeImports := map[string]string{}
	runtimeImports := map[string]string{}
	var edits []sourceEdit
	nativeFork := false
	key := "legacyEffectGlobals:" + file.FileName().AsString()
	if refused[key] {
		return p
	}
	inSpan := func(n *ast.Node) bool {
		return only == nil || nodeStart(file, n) <= only.Span.End() && n.End() >= only.Span.Pos()
	}
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if parser.IsVibeLangModuleDeclaration(n) {
			return false
		}
		if ast.IsCallExpression(n) && ast.IsIdentifier(n.Expression()) && n.Expression().Text() == "forkIn" && !shadowedByValue(n.Expression(), "forkIn") && inSpan(n) {
			args := n.Arguments()
			if !preVIP && len(args) == 2 && n.QuestionDotToken() == nil && scopeType != nil && !rewriteComments.MatchString(sourceText(file, n)) {
				first, second := c.GetTypeAtLocation(args[0]), c.GetTypeAtLocation(args[1])
				if first != nil && second != nil && first.Flags()&(checker.TypeFlagsAny|checker.TypeFlagsUnknown|checker.TypeFlagsNever) == 0 && c.IsTypeAssignableTo(first, scopeType) && effectOfValue(c, second) != nil {
					types := ""
					if len(n.TypeArguments()) > 0 {
						var written []string
						for _, typ := range n.TypeArguments() {
							written = append(written, sourceText(file, typ))
						}
						types = "<" + strings.Join(written, ", ") + ">"
					}
					replacement := "do { const " + scopeName + " = (" + expressionText(file, args[0]) + "); const " + programName + " = (" + expressionText(file, args[1]) + "); " + fx + ".forkIn" + types + "(" + programName + ", " + scopeName + ") }"
					// The call's full range can include its written try prefix.
					// Replace from the callee so the caller still runs the Effect.
					edits = append(edits, sourceEdit{nodeStart(file, n.Expression()), n.End(), replacement})
					nativeFork = true
					return false // Nested legacy calls are handled in the next safe round.
				}
			}
		}
		if ast.IsIdentifier(n) && inSpan(n) && n.Flags&(ast.NodeFlagsReparsed|ast.NodeFlagsVibeLangIntrinsic) == 0 {
			name := n.Text()
			if (name == "sync" || name == "callback" || name == "forkIn") && !shadowedByValue(n, name) && legacyGlobalRead(n) {
				call := n.Parent
				called := call != nil && ast.IsCallExpression(call) && call.Expression() == n
				// Calls with pre-VIP-1 by-name arguments are migrated atomically
				// with their function bodies by tryEdits.
				useRuntime := name == "forkIn" && (legacy || preVIP) && !called
				if off && name == "forkIn" && !called {
					useRuntime = true
				}
				useNative := off && (name == "sync" || name == "callback")
				if useNative && called && (name != "sync" || !plainNativeSyncCall(c, call)) {
					useNative = false
				}
				if useRuntime || useNative {
					imports := nativeImports
					if useRuntime {
						imports = runtimeImports
					}
					alias := imports[name]
					if alias == "" {
						alias = names.freshName("$legacyGlobal" + name)
						imports[name] = alias
					}
					text := alias
					if ast.IsShorthandPropertyAssignment(n.Parent) {
						text = name + ": " + alias
					}
					edits = append(edits, sourceEdit{nodeStart(file, n), n.End(), text})
				}
			}
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	if len(edits) == 0 {
		return p
	}
	header := ""
	for _, name := range []string{"sync", "callback", "forkIn"} {
		if alias := nativeImports[name]; alias != "" {
			header += "import { " + name + " as " + alias + " } from \"effect/Effect\"\n"
		}
		if alias := runtimeImports[name]; alias != "" {
			header += "import { " + name + " as " + alias + " } from \"vibelang-runtime\"\n"
		}
	}
	if nativeFork {
		header += "import { Effect as " + fx + " } from \"effect\"\nimport { $global as " + initialized + " } from \"vibelang-runtime\"\nvoid " + initialized + "\n"
	}
	at := retiredAwaitImportPosition(file)
	if at > 0 && file.Text()[at-1] != '\n' {
		header = "\n" + header
	}
	merged := false
	for i := range edits {
		if edits[i].start == at {
			edits[i].text = header + edits[i].text
			merged = true
			break
		}
	}
	if !merged {
		edits = append(edits, sourceEdit{at, at, header})
	}
	p.fixes = append(p.fixes, fileFix{key: key, label: "native Effect globals", edits: edits})
	return p
}

func legacyGlobalRead(n *ast.Node) bool {
	p := n.Parent
	if p == nil {
		return false
	}
	if !ast.IsShorthandPropertyAssignment(p) && ast.IsDeclarationNameOrImportPropertyName(n) {
		return false
	}
	q := p
	for q != nil && ast.IsQualifiedName(q) {
		q = q.Parent
	}
	if inTypeNode(n) && (q == nil || !ast.IsTypeQueryNode(q)) {
		return false
	}
	switch {
	case ast.IsPropertyAccessExpression(p):
		return p.Expression() == n
	case ast.IsQualifiedName(p):
		return p.AsQualifiedName().Left == n
	case ast.IsShorthandPropertyAssignment(p):
		return p.Name() == n
	case ast.IsPropertyAssignment(p):
		return p.Initializer() == n
	case ast.IsPropertyDeclaration(p), ast.IsMethodDeclaration(p), ast.IsParameterDeclaration(p), ast.IsVariableDeclaration(p), ast.IsImportSpecifier(p), ast.IsExportSpecifier(p):
		return p.Name() != n && (p.Kind != ast.KindImportSpecifier && p.Kind != ast.KindExportSpecifier)
	}
	return true
}

// Native sync agrees with the old direct-call adapter for these known,
// synchronous, argument-free callbacks. Other compatibility calls remain
// available for an explicit manual boundary choice.
func plainNativeSyncCall(c *checker.Checker, call *ast.Node) bool {
	if len(call.Arguments()) != 1 {
		return false
	}
	f := ast.SkipParentheses(call.Arguments()[0])
	if !ast.IsFunctionExpressionOrArrowFunction(f) || len(f.Parameters()) != 0 || ast.GetFunctionFlags(f)&(ast.FunctionFlagsAsync|ast.FunctionFlagsGenerator) != 0 {
		return false
	}
	signatures := c.GetSignaturesOfType(c.GetTypeAtLocation(f), checker.SignatureKindCall)
	if len(signatures) != 1 {
		return false
	}
	result := c.GetReturnTypeOfSignature(signatures[0])
	return result != nil && result.Flags()&(checker.TypeFlagsAny|checker.TypeFlagsUnknown|checker.TypeFlagsTypeParameter) == 0 && c.GetPropertyOfType(result, "then") == nil
}

func legacyEffectGlobalActions(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
	if fix.Program == nil || fix.SourceFile == nil {
		return nil, nil
	}
	p := legacyEffectGlobalFixes(ctx, fix.Program, fix.SourceFile, nil, false, false, fix)
	action := &ls.CodeAction{Description: "Keep the legacy global's behavior with explicit Effect code"}
	for _, f := range p.fixes {
		for _, e := range f.edits {
			action.Changes = append(action.Changes, &lsproto.TextEdit{Range: fix.LS.ToLSPRange(fix.SourceFile, core.NewTextRange(e.start, e.end)), NewText: e.text})
		}
	}
	if len(action.Changes) == 0 {
		return nil, nil
	}
	return []*ls.CodeAction{action}, nil
}

// This recognizes the historical protocol only while planning a migration.
// It never changes checking or the native function's current signature.
func legacyForkInScopeFirst(c *checker.Checker, call *ast.Node) bool {
	if !ast.IsCallExpression(call) || len(call.Arguments()) != 2 || !ast.IsIdentifier(call.Expression()) || call.Expression().Text() != "forkIn" || shadowedByValue(call.Expression(), "forkIn") {
		return false
	}
	symbol := servicesFor(c).effectExport("Scope", "Scope")
	if symbol == nil {
		return false
	}
	first := c.GetTypeAtLocation(call.Arguments()[0])
	return first != nil && first.Flags()&(checker.TypeFlagsAny|checker.TypeFlagsUnknown|checker.TypeFlagsNever) == 0 && c.IsTypeAssignableTo(first, c.GetDeclaredTypeOfSymbol(resolvedAlias(c, symbol)))
}
