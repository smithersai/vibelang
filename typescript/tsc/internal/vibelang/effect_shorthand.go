package vibelang

import (
	"regexp"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// effect occupies the same modifier position as TypeScript async (VIP-39).
// A function declaration keeps function; the retired shorthand reports EK0101.
// Methods retain their normal method spelling.

func init() {
	fileChecks = append(fileChecks, checkShorthands)
	tsFormRules[EK0101.Code] = &tsFormRule{
		message: EK0101,
		find:    func(*checker.Checker, *ast.SourceFile, func(*ast.Node, *formRewrite, ...any)) {},
	}
}

// checkShorthands reports EK0101 at each shorthand declaration of file.
func checkShorthands(c *checker.Checker, file *ast.SourceFile) {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if name := shorthandName(file, node); name != nil {
			reportAt(c, file, tsFormSpan(file, name), EK0101, shorthandModifier(node), name.Text())
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// functionWord also serves effectMarkerEdit when offering EK0501 repairs.
var functionWord = regexp.MustCompile(`\bfunction\b`)

// shorthandName returns the name of node when node is a function declaration
// written without function, or nil.
func shorthandName(file *ast.SourceFile, node *ast.Node) *ast.Node {
	if file == nil || !ast.IsFunctionDeclaration(node) || node.Name() == nil || !isVibeLangFile(file) {
		return nil
	}
	name := node.Name()
	// Comments between export and the modifier are not a function keyword.
	// Scan the declaration head with TypeScript's trivia-aware scanner.
	s := scanner.GetScannerForSourceFile(file, nodeStart(file, node))
	for s.Token() != ast.KindEndOfFile && s.TokenStart() < name.Pos() {
		if s.Token() == ast.KindFunctionKeyword {
			return nil
		}
		s.Scan()
	}
	return name
}

// shorthandModifier is the word written before a shorthand declaration's
// name: effect, or async.
func shorthandModifier(fn *ast.Node) string {
	if isMarkedEffect(fn) {
		return "effect"
	}
	return "async"
}
