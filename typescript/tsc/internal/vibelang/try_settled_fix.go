package vibelang

import (
	"context"
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"strings"
)

func init() {
	tsFormFixCodes = append(tsFormFixCodes, 2345, 2322)
	nativeFixCodes = append(nativeFixCodes, 2345, 2322)
	ls.RegisterCodeFixProvider(trySettledTupleFix)
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{
		Source:         diagnosticSource,
		ErrorCodes:     []int32{EK9202.Code},
		GetCodeActions: trySettledTupleFix.GetCodeActions,
	})
}

// An explicit call of the existing helper preserves the old contract exactly,
// including one operand evaluation and a custom source map. Only syntax uses
// the stricter VIP-18 native callback rule. No cast or eager tuple enumeration
// can preserve all three properties.
var trySettledTupleFix = &ls.CodeFixProvider{
	ErrorCodes: []int32{2345, 2322},
	GetCodeActions: func(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
		defer done()
		var call *ast.Node
		var visit func(*ast.Node) bool
		visit = func(n *ast.Node) bool {
			if n.End() < fix.Span.Pos() || n.Pos() > fix.Span.End() {
				return false
			}
			if tryOperationName(n) == "try.allSettled" {
				call = n
				return true
			}
			return n.ForEachChild(visit)
		}
		fix.SourceFile.AsNode().ForEachChild(visit)
		if call == nil {
			// A fixed-length result usually fails at a later binding's name.
			// Follow references only within the statement containing this diagnostic.
			var statement *ast.Node
			var enclosing func(*ast.Node) bool
			enclosing = func(n *ast.Node) bool {
				if n.End() < fix.Span.Pos() || n.Pos() > fix.Span.End() {
					return false
				}
				if ast.IsStatement(n) {
					statement = n
				}
				return n.ForEachChild(enclosing)
			}
			fix.SourceFile.AsNode().ForEachChild(enclosing)
			seen := map[*ast.Node]bool{}
			var references func(*ast.Node) bool
			references = func(n *ast.Node) bool {
				if n == nil || seen[n] {
					return false
				}
				seen[n] = true
				if tryOperationName(n) == "try.allSettled" {
					call = n
					return true
				}
				if ast.IsIdentifier(n) {
					if symbol := c.GetSymbolAtLocation(n); symbol != nil {
						if d := symbol.ValueDeclaration(); d != nil && d.Kind == ast.KindVariableDeclaration && n != d.Name() {
							if references(d.Initializer()) {
								return true
							}
						}
					}
				}
				return n.ForEachChild(references)
			}
			if statement != nil {
				references(statement)
			}
		}
		if call == nil {
			return nil, nil
		}
		operand := call.Arguments()[0]
		operandType := c.GetTypeAtLocation(operand)
		if !checker.IsTupleType(c.GetApparentType(operandType)) {
			if !tryOperationArrayType(c, operandType) || (fix.ErrorCode != 2345 && fix.ErrorCode != EK9202.Code) {
				return nil, nil
			}
			// Synthetic native callback errors cover the complete operand.
			// A consumer's argument error or an error inside the operand
			// does not justify rewriting an otherwise valid array operation.
			if fix.ErrorCode == 2345 && (fix.Span.Pos() != nodeStart(fix.SourceFile, operand) || fix.Span.End() != operand.End()) {
				return nil, nil
			}
		}
		if fix.ErrorCode == EK9202.Code {
			// An empty tuple or never[] gains a requirement from native map's
			// unconstrained callback inference. Preserve real service needs.
			element := c.GetIndexTypeOfType(operandType, c.GetNumberType())
			if element == nil || element.Flags()&checker.TypeFlagsNever == 0 {
				return nil, nil
			}
		}
		name := "$settledTuple"
		for strings.Contains(fix.SourceFile.Text(), name) {
			name += "_"
		}
		text := "(try " + name + "(" + expressionText(fix.SourceFile, operand) + "))"
		changes := replaceRange(fix, nodeStart(fix.SourceFile, call), call.End(), text)
		at := tryOperationImportPosition(fix.SourceFile)
		imported := "import { $tryAllSettled as " + name + " } from \"vibelang-runtime\"\n"
		if at > 0 && fix.SourceFile.Text()[at-1] != '\n' {
			imported = "\n" + imported
		}
		if at == nodeStart(fix.SourceFile, call) {
			changes[0].NewText = imported + text
		} else {
			changes = append(changes, replaceRange(fix, at, at, imported)...)
		}
		return []*ls.CodeAction{{Description: "Preserve the previous allSettled contract", Changes: changes}}, nil
	},
}
