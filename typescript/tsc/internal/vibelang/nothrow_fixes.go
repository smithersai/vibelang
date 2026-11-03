package vibelang

import (
	"context"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// EK0401's quick fixes, in DESIGN.md's order (nothrow, 2026-10-31):
//
//  1. Make the function effect. Its throw becomes Effect.fail; a call known
//     to throw becomes try Effect.try(() => call). A plain return annotation
//     goes, because an effect function's written return type is an Effect
//     (EK0106): the Effect type is inferred.
//
//     function f(x: number): number { if (x < 0) throw new Bad() … }
//     effect function f(x: number) { if (x < 0) throw new Bad() … }
//
//  2. Use die: the same, with the throw statement written return try die(e),
//     which keeps a JavaScript throw's runtime meaning inside an Effect, a
//     defect.
//
// A plain catch handler becomes catch effect (e) => …. Neither fix is
// offered for a constructor, accessor, plain generator, initializer, static
// block, parameter list or the top level, which can't be effect code: their
// fix is moving the code to a .ts file. Nor is it offered where making the
// function effect would change a type something else fixes (FuzzEditor,
// editor:quickfix-error:EK401:TS2394 and TS2416): an overload implementation,
// whose overloads must stay compatible with it, and a method whose name a
// base class, an implemented interface or the object's contextual type
// declares, or a callback whose parameter type wants a value.

func init() {
	ls.RegisterCodeFixProvider(nothrowFix)
}

var nothrowFix = &ls.CodeFixProvider{
	Source:     diagnosticSource,
	ErrorCodes: []int32{EK0401.Code},
	GetCodeActions: func(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		site := reportedNode(fix.SourceFile, fix.Span, func(node *ast.Node) bool {
			// a throw expression is a call of a parser program arrow around a
			// throw statement: the reported node is the throw inside it
			return node.Kind == ast.KindThrowStatement || ast.IsCallExpression(node) && !isProgramArrow(ast.SkipParentheses(node.Expression())) || ast.IsNewExpression(node)
		})
		if site == nil {
			return nil, nil
		}
		c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
		defer done()
		home := analyzerFor(c).plainHomeOf(site)
		if home == nil || effectBreaksContract(c, home) {
			return nil, nil
		}
		edits := makeEffectEdits(fix, site, home)
		if edits == nil {
			return nil, nil
		}
		file := fix.SourceFile
		var actions []*ls.CodeAction
		name := functionDisplayName(home)
		description := "Make " + name + " an effect function"
		if isCatchHandlerOf(home) {
			description = "Make the handler an effect handler: catch effect"
		}
		actions = append(actions, &ls.CodeAction{Description: description, Changes: edits})
		if site.Kind == ast.KindThrowStatement && enclosingFunction(site) == home {
			// a throw statement, not a throw expression, whose arrow the parser writes
			operand := site.Expression()
			die := append(append([]*lsproto.TextEdit{}, edits...), replaceRange(fix, nodeStart(file, site), site.End(), "return try die("+nodeText(file, operand)+")")...)
			actions = append(actions, &ls.CodeAction{Description: description + " and fail with a defect: die", Changes: die})
		}
		return actions, nil
	},
}

// makeEffectEdits returns the edits that make home, the plain code that holds
// site, effect code, or nil when home can't be effect code.
func makeEffectEdits(fix *ls.CodeFixContext, site *ast.Node, home *ast.Node) []*lsproto.TextEdit {
	if home == nil {
		return nil
	}
	switch home.Kind {
	case ast.KindFunctionDeclaration, ast.KindFunctionExpression, ast.KindArrowFunction, ast.KindMethodDeclaration:
	default:
		return nil // a constructor, accessor, initializer, static block or the top level
	}
	if ast.GetFunctionFlags(home)&ast.FunctionFlagsGenerator != 0 || home.Body() == nil {
		return nil // effect function* is a Stream producer, another meaning
	}
	for n := site.Parent; n != nil && n != home; n = n.Parent {
		if n.Kind == ast.KindParameter {
			return nil // a parameter list runs before the Effect exists
		}
	}
	file := fix.SourceFile
	text := file.Text()
	at := nodeStart(file, home)
	if modifiers := home.Modifiers(); modifiers != nil && len(modifiers.Nodes) > 0 {
		at = scanner.SkipTrivia(text, modifiers.End())
	}
	if home.Kind == ast.KindMethodDeclaration {
		at = nodeStart(file, home.Name())
	}
	if home.Kind == ast.KindArrowFunction && !strings.HasPrefix(text[at:], "(") && !strings.HasPrefix(text[at:], "<") {
		return nil // effect needs the parameter list in parentheses
	}
	edits := replaceRange(fix, at, at, "effect ")
	if annotation := home.Type(); annotation != nil {
		start := nodeStart(file, annotation)
		colon := start - 1
		for colon > 0 && (text[colon] == ' ' || text[colon] == '\t') {
			colon--
		}
		if text[colon] != ':' {
			return nil
		}
		edits = append(edits, replaceRange(fix, colon, annotation.End(), "")...)
	}
	if site.Kind != ast.KindThrowStatement {
		edits = append(edits, replaceRange(fix, nodeStart(file, site), site.End(), "try Effect.try(() => "+nodeText(file, site)+")")...)
	}
	return edits
}

// effectBreaksContract reports whether making home effect would change a type
// that something else fixes: an overload implementation, whose overload
// signatures must stay compatible with it (TS2394), or a method whose name a
// base class, an implemented interface or the object literal's contextual
// type declares (TS2416, TS2322).
func effectBreaksContract(c *checker.Checker, home *ast.Node) bool {
	if ast.IsFunctionExpressionOrArrowFunction(home) {
		// a callback whose parameter type wants a value: an effect callback
		// returns an Effect there (TS2345).
		if t := c.GetContextualType(home, checker.ContextFlagsNone); t != nil {
			for _, signature := range c.GetSignaturesOfType(t, checker.SignatureKindCall) {
				result := c.GetReturnTypeOfSignature(signature)
				if result.Flags()&(checker.TypeFlagsAnyOrUnknown|checker.TypeFlagsVoid|checker.TypeFlagsTypeVariable) == 0 && !isEffectfulType(c, result) {
					return true
				}
			}
		}
	}
	if ast.IsFunctionDeclaration(home) || ast.IsMethodDeclaration(home) {
		if symbol := c.GetSymbolOfDeclaration(home); symbol != nil && len(symbol.Declarations()) > 1 {
			return true
		}
	}
	if !ast.IsMethodDeclaration(home) || home.Name() == nil || !ast.IsIdentifier(home.Name()) {
		return false
	}
	name := home.Name().Text()
	owner := home.Parent
	if ast.IsClassLike(owner) {
		for _, kind := range []ast.Kind{ast.KindExtendsKeyword, ast.KindImplementsKeyword} {
			for _, element := range ast.GetHeritageElements(owner, kind) {
				if t := c.GetTypeAtLocation(element); t != nil && c.GetPropertyOfType(t, name) != nil {
					return true
				}
			}
		}
	}
	if ast.IsObjectLiteralExpression(owner) {
		if t := c.GetContextualType(owner, checker.ContextFlagsNone); t != nil && c.GetPropertyOfType(t, name) != nil {
			return true
		}
	}
	return false
}
