package vibelang

import (
	"regexp"
	"slices"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// A foreign function value whose written @throws does not fit the function
// type it is checked against is EK0402 (Chapter 3, "Assignability"; VIP-4,
// decided detail 250). "A function whose thrown type is T is assignable to
// a function type only when that type admits T: a type without @throws
// admits only never, @throws {U} admits subtypes of U, and @throws {unknown}
// admits anything." The rule applies at every site where TypeScript checks
// one call signature against another. This check covers the sites that give
// a .vibe value a contextual function type: an argument, an object member (a
// JSX attribute is one, VIP-39), a spread member, an initializer or
// assignment, an array element and a return against a written type.
//
//	// handlers.ts
//	/** @throws {Error} */ export function risky(): void { … }
//	export declare function call(f: () => void): void
//
//	call(risky)                     // EK0402: () => void admits only never
//	const h: () => void = risky     // EK0402
//
// The source must be a foreign declaration that writes @throws: the default
// for an untagged foreign function is outside this check. A .vibe function
// can't throw (EK0401 at its throw), so it fits every function type.
// Appendix E's shipped contracts admit what they say: the thunk of Effect.try
// and tryPromise (the function argument or the options object's try
// property) and the Promise executor admit unknown, and a parameter named by
// @rethrows, written or shipped for Array's iteration methods and Array.from,
// admits anything.

func init() {
	fileChecks = append(fileChecks, checkCallbackThrows)
}

func checkCallbackThrows(c *checker.Checker, file *ast.SourceFile) {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if isTypeScriptModule(node) || isHatchArgument(node) {
			return false
		}
		if (ast.IsIdentifier(node) || ast.IsPropertyAccessExpression(node)) && isContextualValue(node) {
			checkCallbackValue(c, node)
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// isContextualValue reports whether expr is a value TypeScript checks
// against a contextual type: an argument, an object member's value, an
// initializer, an assignment's right side, an array element, a returned
// value or a JSX attribute's expression, through parentheses and the
// branches of a conditional.
func isContextualValue(expr *ast.Node) bool {
	node := expr
	for node.Parent != nil && (ast.IsParenthesizedExpression(node.Parent) ||
		ast.IsConditionalExpression(node.Parent) && node != node.Parent.AsConditionalExpression().Condition) {
		node = node.Parent
	}
	p := node.Parent
	if p == nil {
		return false
	}
	switch p.Kind {
	case ast.KindCallExpression, ast.KindNewExpression:
		return p.Arguments() != nil && slices.Contains(p.Arguments(), node)
	case ast.KindPropertyAssignment, ast.KindVariableDeclaration, ast.KindPropertyDeclaration, ast.KindParameter:
		return p.Initializer() == node
	case ast.KindBinaryExpression:
		b := p.AsBinaryExpression()
		return b.OperatorToken.Kind == ast.KindEqualsToken && b.Right == node
	case ast.KindArrayLiteralExpression, ast.KindReturnStatement, ast.KindJsxExpression:
		return true
	case ast.KindArrowFunction:
		return p.Body() == node
	}
	return false
}

// throwContract is what a function type's @throws tags say: whether it has
// one, whether one names unknown (or any), which admits anything, and the
// other types they name. A tag naming never adds nothing.
type throwContract struct {
	tagged  bool
	unknown bool
	types   []*checker.Type
}

// writtenThrows reads the @throws tags on decl's JSDoc hosts.
func writtenThrows(c *checker.Checker, decl *ast.Node) throwContract {
	var contract throwContract
	for _, host := range jsdocHosts(decl) {
		for _, jsdoc := range host.JSDoc(nil) {
			for _, tag := range jsdocTags(jsdoc) {
				if !ast.IsJSDocThrowsTag(tag) || tag.AsJSDocThrowsTag().TypeExpression == nil {
					continue
				}
				contract.tagged = true
				t := tag.AsJSDocThrowsTag().TypeExpression.AsJSDocTypeExpression().Type
				switch {
				case t == nil, t.Kind == ast.KindUnknownKeyword, t.Kind == ast.KindAnyKeyword:
					contract.unknown = true
				case t.Kind == ast.KindNeverKeyword:
				default:
					contract.types = append(contract.types, c.GetTypeFromTypeNode(t))
				}
			}
		}
	}
	return contract
}

// admits reports whether a function type whose contract is dst admits a
// function that throws src.
func (dst throwContract) admits(c *checker.Checker, src throwContract) bool {
	switch {
	case dst.unknown:
		return true
	case src.unknown:
		return false
	case len(src.types) == 0:
		return true
	case len(dst.types) == 0:
		return false
	}
	bound := c.GetUnionType(dst.types)
	for _, t := range src.types {
		if !c.IsTypeAssignableTo(t, bound) {
			return false
		}
	}
	return true
}

// foreignThrows returns the contract of the foreign function expr names. It
// reports false when expr names no foreign value, when a declaration of it
// writes no @throws, or when its @throws names only never.
func foreignThrows(c *checker.Checker, expr *ast.Node) (throwContract, bool) {
	name := expr
	if ast.IsPropertyAccessExpression(expr) {
		name = expr.Name()
	}
	symbol := c.GetSymbolAtLocation(name)
	if symbol != nil && symbol.Flags()&ast.SymbolFlagsAlias != 0 {
		symbol = c.GetAliasedSymbol(symbol)
	}
	if symbol == nil || symbol.Flags()&(ast.SymbolFlagsFunction|ast.SymbolFlagsMethod|ast.SymbolFlagsVariable|ast.SymbolFlagsProperty) == 0 || len(symbol.Declarations()) == 0 {
		return throwContract{}, false
	}
	var contract throwContract
	for _, decl := range symbol.Declarations() {
		file := ast.GetSourceFileOfNode(decl)
		if file == nil || isVibeLangFile(file) || isLibFile(c, file) {
			return throwContract{}, false
		}
		own := writtenThrows(c, decl)
		if !own.tagged {
			return throwContract{}, false
		}
		contract.unknown = contract.unknown || own.unknown
		contract.types = append(contract.types, own.types...)
	}
	return contract, contract.unknown || len(contract.types) > 0
}

func checkCallbackValue(c *checker.Checker, expr *ast.Node) {
	src, ok := foreignThrows(c, expr)
	if !ok || admittedByShippedContract(c, expr) {
		return
	}
	contextual := c.GetContextualType(expr, checker.ContextFlagsNone)
	if contextual == nil {
		return
	}
	members := []*checker.Type{contextual}
	if contextual.Flags()&checker.TypeFlagsUnion != 0 {
		members = contextual.Types()
	}
	var signatures []*checker.Signature
	for _, t := range members {
		signatures = append(signatures, c.GetSignaturesOfType(t, checker.SignatureKindCall)...)
	}
	if len(signatures) == 0 {
		return // not a function type, such as unknown or a type parameter
	}
	for _, signature := range signatures {
		decl := signature.Declaration()
		if decl == nil || writtenThrows(c, decl).admits(c, src) {
			return
		}
	}
	name := scanner.GetTextOfNode(expr)
	d := report(c, expr, EK0402)
	note(d, "{0} is declared @throws {{1}}; the function type it is checked against admits only what its own @throws says, and without @throws only never.", name, thrownText(c, src))
	note(d, "Pass a function that handles the throw, call {0} through Effect.try, or write @throws on the function type.", name)
}

// thrownText spells a source contract for a note.
func thrownText(c *checker.Checker, src throwContract) string {
	if src.unknown {
		return "unknown"
	}
	return c.TypeToString(c.GetUnionType(src.types))
}

// rethrowsTag matches a @rethrows tag and the parameter it names, wherever
// it sits in a JSDoc comment, on its own line or after a @throws tag.
var rethrowsTag = regexp.MustCompile(`@rethrows\s+([A-Za-z_$][\w$]*)`)

// shippedRethrows maps each lib method Appendix E annotates @rethrows to
// the parameter it rethrows.
var shippedRethrows = map[string]string{
	"map": "callbackfn", "forEach": "callbackfn", "filter": "predicate", "find": "predicate",
	"some": "predicate", "every": "predicate", "sort": "compareFn", "reduce": "callbackfn", "from": "mapfn",
}

// admittedByShippedContract reports whether expr is an argument, or the try
// property of an options argument, whose callee admits whatever it throws:
// Effect.try's and tryPromise's thunk, the Promise executor, or a parameter
// named by @rethrows.
func admittedByShippedContract(c *checker.Checker, expr *ast.Node) bool {
	node := expr
	for ast.IsParenthesizedExpression(node.Parent) {
		node = node.Parent
	}
	call := node.Parent
	if ast.IsPropertyAssignment(call) && declarationName(call) == "try" && ast.IsObjectLiteralExpression(call.Parent) {
		options := call.Parent
		if p := options.Parent; p != nil && ast.IsCallExpression(p) && slices.Contains(p.Arguments(), options) {
			return isExportOf(c, p, "effect", "Effect", []string{"try_", "try", "tryPromise"})
		}
		return false
	}
	if call == nil || !(ast.IsCallExpression(call) || ast.IsNewExpression(call)) || call.Arguments() == nil {
		return false
	}
	index := slices.Index(call.Arguments(), node)
	if index < 0 {
		return false
	}
	if ast.IsCallExpression(call) && isExportOf(c, call, "effect", "Effect", []string{"try_", "try", "tryPromise"}) {
		return true
	}
	decl := signatureDeclaration(c, call)
	if decl == nil || !ast.IsFunctionLike(decl) {
		return false
	}
	parameters := decl.Parameters()
	if index >= len(parameters) {
		if len(parameters) == 0 || parameters[len(parameters)-1].AsParameterDeclaration().DotDotDotToken == nil {
			return false
		}
		index = len(parameters) - 1
	}
	parameter := declarationName(parameters[index])
	declFile := ast.GetSourceFileOfNode(decl)
	if isLibFile(c, declFile) {
		if ast.IsNewExpression(call) && parameter == "executor" {
			return true // new Promise(executor): the executor admits unknown
		}
		owner := ownerOf(decl)
		return owner != nil && shippedRethrows[declarationName(owner)] == parameter
	}
	for _, host := range jsdocHosts(decl) {
		for _, jsdoc := range host.JSDoc(nil) {
			for _, m := range rethrowsTag.FindAllStringSubmatch(declFile.Text()[jsdoc.Pos():jsdoc.End()], -1) {
				if m[1] == parameter {
					return true
				}
			}
		}
	}
	return false
}
