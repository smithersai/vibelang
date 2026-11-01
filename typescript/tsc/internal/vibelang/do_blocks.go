package vibelang

import (
	"context"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

var EK1019 = message(1019, errorCategory, "{0} cannot leave or hoist out of a do expression. Use let instead of var, and keep break and continue inside the do expression.")

// EK0201: a do expression whose last statement has no completion value; the
// parser reports it (parser.DoCompletionMessage; VIP-2, decided detail 247).
var EK0201 = message(201, errorCategory, parser.DoCompletionMessage)

// EK0202: a break or continue whose target is outside its effect block
// (Appendix A, EffectBlock; decided detail 247). The block is a function
// body, so the jump would cross a function boundary.
var EK0202 = message(202, errorCategory, "{0} cannot leave an effect block: the block builds its own Effect, which runs later, so a loop or switch outside it is not in reach. Move the loop into the block, or return a value from the block and jump outside it.")

func init() {
	registry[EK1019.Code] = EK1019
	registry[EK0202.Code] = EK0202
	registry[EK0201.Code] = EK0201
	fileChecks = append(fileChecks, checkDoBlocks)
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{
		Source:     diagnosticSource,
		ErrorCodes: []int32{EK1019.Code},
		GetCodeActions: func(_ context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
			if fix.SourceFile.Text()[fix.Span.Pos():fix.Span.End()] != "var" {
				return nil, nil
			}
			return []*ls.CodeAction{{Description: "Replace var with let", Changes: replaceRange(fix, fix.Span.Pos(), fix.Span.End(), "let")}}, nil
		},
	})
}

// The parser represents do with an invoked arrow whose arrow token is
// anchored on the source do keyword, unlike a source function's => token.
func isDoArrow(file *ast.SourceFile, node *ast.Node) bool {
	return programArrowWord(file, node) == "do"
}

// The parser represents an effect block, effect { … }, as an arrow whose
// arrow token is anchored on the source effect keyword (parser/vibelang_effect.go).
func isEffectBlockArrow(file *ast.SourceFile, node *ast.Node) bool {
	return node.Flags&ast.NodeFlagsVibeLangEffect != 0 && programArrowWord(file, node) == "effect"
}

// programArrowWord returns the source word an arrow's => token is anchored
// on, "do" or "effect" for the arrows the parser writes for those blocks, or
// "" for a source arrow.
func programArrowWord(file *ast.SourceFile, node *ast.Node) string {
	if node.Kind != ast.KindArrowFunction {
		return ""
	}
	token := node.AsArrowFunction().EqualsGreaterThanToken
	r := scanner.GetRangeOfTokenAtPosition(file, token.Pos())
	switch word := file.Text()[r.Pos():r.End()]; word {
	case "do", "effect":
		return word
	}
	return ""
}

func checkDoBlocks(c *checker.Checker, file *ast.SourceFile) {
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		switch node.Kind {
		case ast.KindVariableDeclarationList:
			if node.Flags&ast.NodeFlagsBlockScoped == 0 {
				for parent := node.Parent; parent != nil; parent = parent.Parent {
					if isDoArrow(file, parent) {
						reportAt(c, file, scanner.GetRangeOfTokenAtPosition(file, node.Pos()), EK1019, "var")
						break
					}
					if isFunctionBoundary(parent) {
						break
					}
				}
			}
		case ast.KindBreakStatement, ast.KindContinueStatement:
			for parent := node.Parent; parent != nil; parent = parent.Parent {
				if word := programArrowWord(file, parent); word != "" {
					keyword := scanner.GetRangeOfTokenAtPosition(file, node.Pos())
					m := EK1019
					if word == "effect" {
						m = EK0202
					}
					reportAt(c, file, keyword, m, file.Text()[keyword.Pos():keyword.End()])
					cover(c, node) // replaces TS1107 from the generated arrow boundary
					break
				}
				if isFunctionBoundary(parent) {
					break
				}
				if label := node.Label(); label != nil {
					if parent.Kind == ast.KindLabeledStatement && parent.Label().Text() == label.Text() {
						break
					}
				} else if ast.IsIterationStatement(parent, false) || node.Kind == ast.KindBreakStatement && parent.Kind == ast.KindSwitchStatement {
					break
				}
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}
