package vibelang

import (
	"context"
	"fmt"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
)

// Effect.promise(f) and Effect.sync(f) run f in a thunk: a throw, or the
// rejection of f's promise, is a defect. An unannotated foreign f may throw
// unknown, which the thunk does not admit (EK0402, chapter 003), so the fix
// writes the explicit defect bridge, which keeps each thrown or rejected value
// as the same defect:
//
//	Effect.promise(f) -> Effect.orDie(Effect.tryPromise({ try: (signal) => f(signal), catch: (e) => e }))
//	Effect.sync(f)    -> Effect.orDie(Effect.try({ try: () => f(), catch: (e) => e }))
//
// Only a name bound to a function declaration or a const qualifies: reading it
// inside the thunk instead of at the call reads the same function, with the
// same this.
func foreignThunkBridgeFixes(ctx context.Context, program *compiler.Program, file *ast.SourceFile, refused map[string]bool) proposal {
	p := proposal{file: file}
	// Each round asks every fixable file; skip the checker where no call can match.
	if text := file.Text(); !strings.Contains(text, ".promise(") && !strings.Contains(text, ".sync(") {
		return p
	}
	ds := program.GetSemanticDiagnostics(ctx, file)
	c, done := program.GetTypeCheckerForFile(ctx, file)
	defer done()
	for _, d := range ds {
		if d.Source() != diagnosticSource || d.Code() != EK0402.Code {
			continue
		}
		ref := reportedNode(file, core.NewTextRange(d.Pos(), d.End()), ast.IsIdentifier)
		if ref == nil {
			continue
		}
		call := ref.Parent
		if call == nil || !ast.IsCallExpression(call) || len(call.Arguments()) != 1 || call.Arguments()[0] != ref || call.TypeArguments() != nil {
			continue
		}
		callee := call.Expression()
		if !ast.IsPropertyAccessExpression(callee) || !ast.IsIdentifier(callee.Expression()) {
			continue
		}
		promise := isExportOf(c, call, "effect", "Effect", []string{"promise"})
		if !promise && !isExportOf(c, call, "effect", "Effect", []string{"sync"}) {
			continue
		}
		if !stableFunctionBinding(resolvedAlias(c, c.GetSymbolAtLocation(ref))) {
			continue
		}
		signatures := c.GetSignaturesOfType(c.GetTypeAtLocation(ref), checker.SignatureKindCall)
		if len(signatures) != 1 {
			continue
		}
		key := fmt.Sprintf("foreign-thunk-bridge:%d", nodeStart(file, call))
		if refused[key] || hasComment(nodeText(file, call)) {
			continue
		}
		module, name := nodeText(file, callee.Expression()), ref.Text()
		var text string
		if promise {
			thunk := "() => " + name + "()"
			if len(signatures[0].Parameters()) > 0 {
				signal := "signal"
				if name == signal {
					signal = "abort"
				}
				thunk = "(" + signal + ") => " + name + "(" + signal + ")"
			}
			text = module + ".orDie(" + module + ".tryPromise({ try: " + thunk + ", catch: (e) => e }))"
		} else {
			text = module + ".orDie(" + module + ".try({ try: () => " + name + "(), catch: (e) => e }))"
		}
		p.fixes = append(p.fixes, fileFix{code: EK0402.Code, key: key, edits: []sourceEdit{{nodeStart(file, call), call.End(), text}}, siteStart: d.Pos(), siteEnd: d.End(), sited: true})
	}
	return p
}

// stableFunctionBinding reports whether symbol is a function declaration or a
// const, so a later read of its name yields the value an earlier read did.
func stableFunctionBinding(symbol *ast.Symbol) bool {
	if symbol == nil {
		return false
	}
	if symbol.Flags()&ast.SymbolFlagsFunction != 0 {
		return true
	}
	decl := symbol.ValueDeclaration()
	return decl != nil && ast.IsVariableDeclaration(decl) && ast.IsVarConst(decl)
}
