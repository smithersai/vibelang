package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

func init() { fileChecks = append(fileChecks, checkEffectBlockJumps) }

// Native do expressions run in their enclosing activation. Effect blocks
// remain callable boundaries, so their outward loop jumps retain EK0202.
func isDoArrow(file *ast.SourceFile, node *ast.Node) bool {
	return programArrowWord(file, node) == "do"
}

func isEffectBlockArrow(file *ast.SourceFile, node *ast.Node) bool {
	return node.Flags&ast.NodeFlagsVibeLangEffect != 0 && programArrowWord(file, node) == "effect"
}

func programArrowWord(file *ast.SourceFile, node *ast.Node) string {
	if node.Kind != ast.KindArrowFunction {
		return ""
	}
	token := node.AsArrowFunction().EqualsGreaterThanToken
	r := scanner.GetRangeOfTokenAtPosition(file, token.Pos())
	word := file.Text()[r.Pos():r.End()]
	if word == "do" || word == "effect" {
		return word
	}
	return ""
}

func checkEffectBlockJumps(c *checker.Checker, file *ast.SourceFile) {
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if node.Kind == ast.KindBreakStatement || node.Kind == ast.KindContinueStatement {
			for parent := node.Parent; parent != nil; parent = parent.Parent {
				if isEffectBlockArrow(file, parent) {
					keyword := scanner.GetRangeOfTokenAtPosition(file, node.Pos())
					reportAt(c, file, keyword, EK0202, file.Text()[keyword.Pos():keyword.End()])
					cover(c, node)
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
