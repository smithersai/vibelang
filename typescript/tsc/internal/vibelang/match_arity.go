package vibelang

import (
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// EK0703: an extractor pattern whose argument count can never match the list
// its matcher extracts (chapter 004, Class patterns). {0} is the matcher,
// {1} what it extracts, {2} what the pattern lists.
var EK0703 = message(703, warningCategory, "This pattern never matches: {0} extracts {1}, and the pattern lists {2}.")

func init() {
	registry[EK0703.Code] = EK0703
	fileChecks = append(fileChecks, checkExtractorArity)
}

// checkExtractorArity reports EK0703 at the matcher of an extractor pattern
// whose list can never have the length the matcher extracts. The parser
// writes an extractor pattern as `const $extractedN = $extract(matcher, s)`
// followed by the test `$extractedN.length === n`, or `>= n` before a rest
// pattern (compileList). An error declaration and one of Effect's retained
// errors extract [subject]; Option.Some, Exit.Success, Exit.Failure,
// Result.Success and Result.Failure extract one value; Option.None extracts
// []. The primitive classes test their arity in the parser and never reach
// $extract.
func checkExtractorArity(c *checker.Checker, file *ast.SourceFile) {
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsVariableDeclaration(node) && node.Name() != nil && ast.IsIdentifier(node.Name()) && node.Name().Flags&ast.NodeFlagsReparsed != 0 && strings.HasPrefix(node.Name().Text(), "$extracted") && node.Initializer() != nil {
			if call := extractionCall(c, node.Initializer()); call != nil {
				checkExtractorLength(c, node, call)
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

func checkExtractorLength(c *checker.Checker, decl, call *ast.Node) {
	matcher := call.Arguments()[0]
	known, ok := extractedLength(c, matcher)
	if !ok {
		return
	}
	operator, n, found := extractedLengthTest(decl)
	if !found {
		return
	}
	never := false
	switch operator {
	case ast.KindEqualsEqualsEqualsToken:
		never = n != known
	case ast.KindGreaterThanEqualsToken:
		never = n > known
	}
	if !never {
		return
	}
	name := scanner.GetTextOfNode(matcher)
	lists := "exactly " + strconv.Itoa(n)
	if operator == ast.KindGreaterThanEqualsToken {
		lists = "at least " + strconv.Itoa(n)
	}
	d := report(c, matcher, EK0703, name, extractedText(known), lists)
	if known == 0 {
		note(d, "Write {0} or {0}().", name)
	} else {
		note(d, "Write {0} or {0}({1}).", name, bindingList(known))
	}
}

// extractedLength returns how many values matcher, an extractor pattern's
// matcher, extracts when that is statically known.
func extractedLength(c *checker.Checker, matcher *ast.Node) (int, bool) {
	if builtin, ok := builtinMatcherOf(c, matcher); ok {
		if builtin.TypeOf != "" {
			return 0, false
		}
		return len(builtin.Values), true
	}
	symbol := c.GetSymbolAtLocation(matcher)
	if symbol != nil && symbol.Flags()&ast.SymbolFlagsAlias != 0 {
		symbol = c.GetAliasedSymbol(symbol)
	}
	if symbol != nil && isExtractedErrorClass(symbol.ValueDeclaration()) {
		return 1, true
	}
	return 0, false
}

// extractedLengthTest finds the length test the parser wrote for decl, the
// $extractedN declaration, in its block: `$extractedN.length === n` or
// `$extractedN.length >= n`.
func extractedLengthTest(decl *ast.Node) (ast.Kind, int, bool) {
	name := decl.Name().Text()
	block := decl.Parent
	for block != nil && block.Kind != ast.KindBlock && block.Kind != ast.KindSourceFile {
		block = block.Parent
	}
	if block == nil {
		return ast.KindUnknown, 0, false
	}
	var kind ast.Kind
	var n int
	found := false
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if found {
			return true
		}
		if ast.IsBinaryExpression(node) {
			b := node.AsBinaryExpression()
			left, right, operator := b.Left, b.Right, b.OperatorToken.Kind
			if (operator == ast.KindEqualsEqualsEqualsToken || operator == ast.KindGreaterThanEqualsToken) && ast.IsPropertyAccessExpression(left) && left.Name().Text() == "length" && ast.IsIdentifier(left.Expression()) && left.Expression().Text() == name && right.Kind == ast.KindNumericLiteral {
				if v, err := strconv.Atoi(right.Text()); err == nil {
					kind, n, found = operator, v, true
					return true
				}
			}
		}
		return node.ForEachChild(visit)
	}
	block.ForEachChild(visit)
	return kind, n, found
}

func extractedText(known int) string {
	switch known {
	case 0:
		return "no values ([])"
	case 1:
		return "one value"
	}
	return strconv.Itoa(known) + " values"
}

func bindingList(known int) string {
	if known == 1 {
		return "let value"
	}
	var names []string
	for i := 0; i < known; i++ {
		names = append(names, "let v"+strconv.Itoa(i+1))
	}
	return strings.Join(names, ", ")
}
