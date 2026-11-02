package vibelang

import (
	"slices"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

// The pipe operator (design D154, D155). In a .vibe file,
//
//	fetchUser(id) |> retry(%, policy) |> timeout(%, "1 second")
//
// evaluates each body with the topic % standing for the expression before
// the |>. The parser reads a pipe as a binary expression flagged
// NodeFlagsVibeLang and the topic as an identifier named % (parser/
// vibelang_pipes.go); the checker gives a pipe its body's type.
//
// The topic follows the by-name rule (D147). Where % stands for an argument
// whose parameter expects a program, and the left side runs an Effect, the
// left side is passed by name: each such % is a program that evaluates the
// left side when it runs, and the left side does not run before the body.
// Elsewhere the left side runs once, before the body, and % is its value.
// A pipe does one or the other (EK1008).

func init() {
	checker.RegisterNameResolutionHook(resolveTopic)
	fileChecks = append(fileChecks, checkPipes)
	ls.RegisterQuickInfoHook(topicQuickInfo)
}

// isPipe reports whether node is a pipe, left |> body.
func isPipe(node *ast.Node) bool {
	return node != nil && node.Kind == ast.KindBinaryExpression && node.Flags&ast.NodeFlagsVibeLang != 0 &&
		node.AsBinaryExpression().OperatorToken.Kind == ast.KindBarToken
}

// isTopic reports whether node is %, the topic of a pipe.
func isTopic(node *ast.Node) bool {
	return node != nil && node.Kind == ast.KindIdentifier && node.Flags&ast.NodeFlagsVibeLang != 0 && node.Text() == "%"
}

// pipeOfTopic returns the pipe whose topic topic is, the innermost pipe whose
// body holds it, or nil for a % in no pipe's body.
func pipeOfTopic(topic *ast.Node) *ast.Node {
	for n := topic; n.Parent != nil; n = n.Parent {
		if isPipe(n.Parent) && n.Parent.AsBinaryExpression().Right == n {
			return n.Parent
		}
	}
	return nil
}

// pipeOfLeft returns the pipe whose left side node is, or nil.
func pipeOfLeft(node *ast.Node) *ast.Node {
	if node != nil && isPipe(node.Parent) && node.Parent.AsBinaryExpression().Left == node {
		return node.Parent
	}
	return nil
}

// topicsOf returns pipe's topic references in source order: the %s in its
// body, except those in the body of a pipe nested there, which are that
// pipe's.
func topicsOf(pipe *ast.Node) []*ast.Node {
	var topics []*ast.Node
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		switch {
		case isTopic(n):
			topics = append(topics, n)
		case isPipe(n):
			visit(n.AsBinaryExpression().Left)
		default:
			n.ForEachChild(visit)
		}
		return false
	}
	visit(pipe.AsBinaryExpression().Right)
	return topics
}

// byNameSubject returns the expression that node passes by name: for a
// topic, its pipe's left side; for any other node, node itself.
func byNameSubject(node *ast.Node) *ast.Node {
	if isTopic(node) {
		if pipe := pipeOfTopic(node); pipe != nil {
			return pipe.AsBinaryExpression().Left
		}
	}
	return node
}

// pipeStateKey keys the topic symbols of one checker: pipe -> the symbol its
// topic resolves to, and nil -> the symbol of a % in no pipe's body.
type pipeStateKey struct{}

func topicSymbolsOf(c *checker.Checker) map[*ast.Node]*ast.Symbol {
	return c.ExtensionState(pipeStateKey{}, func() any { return map[*ast.Node]*ast.Symbol{} }).(map[*ast.Node]*ast.Symbol)
}

// resolveTopic resolves %, which no scope declares, to a value whose type is
// the type of its pipe's left side. A % in no pipe's body resolves to a value
// of the error type, so TypeScript reports nothing more than EK1007.
func resolveTopic(c *checker.Checker, location *ast.Node, name string, meaning ast.SymbolFlags) *ast.Symbol {
	if name != "%" || !isTopic(location) || meaning&ast.SymbolFlagsValue == 0 {
		return nil
	}
	symbols := topicSymbolsOf(c)
	pipe := pipeOfTopic(location)
	if symbol, ok := symbols[pipe]; ok {
		return symbol
	}
	t := c.GetErrorType()
	if pipe != nil {
		t = c.GetTypeAtLocation(pipe.AsBinaryExpression().Left)
	}
	symbol := c.NewPropertySymbol("%", t, nil)
	symbols[pipe] = symbol
	return symbol
}

// pipeIsByName reports whether pipe passes its left side by name: whether a
// topic of its body stands where a program is expected (D155).
func (a *analyzer) pipeIsByName(pipe *ast.Node) bool {
	return slices.ContainsFunc(topicsOf(pipe), a.isByName)
}

// checkPipes reports a pipe without a topic (EK1006), a % in no pipe's body
// (EK1007), and a pipe that passes its left side by name and also uses it as
// a value (EK1008).
func checkPipes(c *checker.Checker, file *ast.SourceFile) {
	if !isVibeLangFile(file) {
		return
	}
	a := analyzerFor(c)
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		switch {
		case isTopic(n):
			if pipeOfTopic(n) == nil {
				report(c, n, EK1007)
			}
		case isPipe(n):
			body := n.AsBinaryExpression().Right
			if ast.NodeIsMissing(n.AsBinaryExpression().Left) || ast.NodeIsMissing(body) {
				break // the parser already reports the missing operand
			}
			topics := topicsOf(n)
			if len(topics) == 0 {
				d := report(c, body, EK1006)
				note(d, "Write % where the value goes:   {0} |> {1}", nodeText(file, n.AsBinaryExpression().Left), "f(%)")
			} else if a.pipeIsByName(n) {
				for _, topic := range topics {
					if !a.isByName(topic) {
						left := nodeText(file, n.AsBinaryExpression().Left)
						d := report(c, topic, EK1008, left)
						note(d, "Bind the value first,   const value = {0},   or pass it by name everywhere.", left)
						break
					}
				}
			}
		}
		n.ForEachChild(visit)
		return false
	}
	file.AsNode().ForEachChild(visit)
}

// topicQuickInfo tells a hover on % what it stands for: the value of the
// pipe's left side, or, passed by name, a program that evaluates it.
func topicQuickInfo(c *checker.Checker, node *ast.Node) (string, string) {
	if !isTopic(node) {
		return "", ""
	}
	pipe := pipeOfTopic(node)
	if pipe == nil {
		return "", ""
	}
	file := ast.GetSourceFileOfNode(node)
	left := nodeText(file, pipe.AsBinaryExpression().Left)
	a := analyzerFor(c)
	t := c.TypeToStringEx(c.GetTypeAtLocation(node), node, hoverTypeFlags, nil)
	if a.isByName(node) {
		if owner, _ := ownerCall(node); owner != nil {
			return "(topic) %: " + t, "Passed by name to `" + calleeText(owner) + "` as a program: `" + left + "` runs when that program runs, not here."
		}
	}
	return "(topic) %: " + t, "The value of `" + left + "`, which runs once, before the pipe's body."
}
