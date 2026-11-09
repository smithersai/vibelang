package vibelang

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// The current spelling of services, controls, and layers (D223, D221).
//
//	service Users { find(id: string): User!NotFound }
//	control Approval { approve(request: string): boolean!! }
//	const UsersLive = Layer.effect(Users, effect { const seen = new Set<string>(); return { find(id) { ... } } })
//
// Retired service class and layer declarations report errors naming --fix.
// Control class retains its existing warning. Legacy lowering remains available
// so --fix can preserve declaration APIs and execution before removing syntax.

var (
	EK0909 = message(909, errorCategory, "service class declarations are retired: write service without class.")
	// EK2120: the existing control class warning. {0} is the word.
	EK2120 = message(2120, warningCategory, "{0} class is the older spelling: write {0} without class.")
	// EK2121: a retired layer declaration. Its repair retains setup timing.
	EK2121 = message(2121, errorCategory, "layer declarations are retired: write Layer.effect(Service, effect { ... }) or Layer.succeed(Service, { ... }).")
)

func init() {
	registry[EK0909.Code] = EK0909
	registry[EK2120.Code] = EK2120
	registry[EK2121.Code] = EK2121
	fileChecks = append(fileChecks, checkDeclarationSpelling)
}

// declarationWordRange returns the range of the word service or control that
// declared class, from the abstract modifier the parser anchored on it, and
// false when class was not declared with that word.
func declarationWordRange(class *ast.Node) (core.TextRange, bool) {
	for _, modifier := range class.ModifierNodes() {
		if modifier.Kind == ast.KindAbstractKeyword && modifier.Flags&ast.NodeFlagsReparsed != 0 {
			return modifier.Loc, true
		}
	}
	return core.TextRange{}, false
}

// layerDeclarationCall returns the Layer.effect or Layer.succeed call the
// parser wrote for statement when statement is a layer declaration, and nil
// otherwise. The parser anchors the synthesized Layer on the word layer.
func layerDeclarationCall(statement *ast.Node) *ast.Node {
	if !ast.IsVariableStatement(statement) {
		return nil
	}
	declarations := statement.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes
	if len(declarations) != 1 || declarations[0].Initializer() == nil || !ast.IsCallExpression(declarations[0].Initializer()) {
		return nil
	}
	call := declarations[0].Initializer()
	callee := call.Expression()
	if callee.Flags&ast.NodeFlagsReparsed == 0 || !ast.IsPropertyAccessExpression(callee) {
		return nil
	}
	if name := callee.Name().Text(); name != "effect" && name != "succeed" {
		return nil
	}
	if layer := callee.Expression(); !ast.IsIdentifier(layer) || layer.Text() != "Layer" {
		return nil
	}
	return call
}

// classKeywordAfter returns the end of the class keyword that follows the
// word service or control ending at end, and false when no class follows.
func classKeywordAfter(text string, end int) (int, bool) {
	after := scanner.SkipTrivia(text, end)
	if !strings.HasPrefix(text[after:], "class") {
		return 0, false
	}
	stop := after + len("class")
	if stop < len(text) {
		if ch := text[stop]; ch == '_' || ch == '$' || ch >= '0' && ch <= '9' || ch >= 'a' && ch <= 'z' || ch >= 'A' && ch <= 'Z' || ch >= 0x80 {
			return 0, false
		}
	}
	return stop, true
}

// checkDeclarationSpelling reports EK2120 over service class or control class,
// and EK2121 at a layer declaration.
func checkDeclarationSpelling(c *checker.Checker, file *ast.SourceFile) {
	text := file.Text()
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		if ast.IsClassDeclaration(n) {
			if word, ok := declarationWordRange(n); ok {
				if stop, ok := classKeywordAfter(text, word.End()); ok {
					if text[word.Pos():word.End()] == "service" {
						reportAt(c, file, core.NewTextRange(word.Pos(), stop), EK0909)
					} else {
						reportAt(c, file, core.NewTextRange(word.Pos(), stop), EK2120, "control")
					}
				}
			}
		}
		if call := layerDeclarationCall(n); call != nil {
			d := reportAt(c, file, call.Expression().Expression().Loc, EK2121)
			note(d, "The automatic rewrite requires Layer to be Effect's value namespace; a shadowed or type-only binding needs an explicit library constructor.")
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// sourceText returns node's text in file, without leading trivia.
func sourceText(file *ast.SourceFile, node *ast.Node) string {
	return scanner.GetSourceTextOfNodeFromSourceFile(file, node, false /*includeTrivia*/)
}

// lineIndent returns the whitespace that starts the line holding pos.
func lineIndent(text string, pos int) string {
	lineStart := strings.LastIndexByte(text[:pos], '\n') + 1
	end := lineStart
	for end < len(text) && (text[end] == ' ' || text[end] == '\t') {
		end++
	}
	return text[lineStart:end]
}
