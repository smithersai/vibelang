package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"strings"
)

var EK4854 = message(4854, warningCategory, "Abstract classes no longer declare services; write a service declaration to preserve this service.")
var EK4855 = message(4855, warningCategory, "A service default is static readonly defaultValue: () => Shape; rename default and wrap its value in a thunk.")
var EK3008 = message(3008, errorCategory, "A service key must be static readonly key initialized with a string literal; write the key explicitly or remove it to derive the key.")

func init() {
	registry[EK3008.Code] = EK3008
	for _, m := range []*Message{EK4854, EK4855} {
		registry[m.Code] = m
		tsFormMessages = append(tsFormMessages, m)
		tsFormFixCodes = append(tsFormFixCodes, m.Code)
	}
	tsFormRules[EK4854.Code] = &tsFormRule{message: EK4854, find: findLegacyServices, plan: legacyServiceRewrite, diagnosed: ast.IsClassDeclaration}
	tsFormRules[EK4855.Code] = &tsFormRule{message: EK4855, find: findLegacyDefaults, plan: legacyDefaultRewrite, diagnosed: func(n *ast.Node) bool { return ast.IsPropertyDeclaration(n) || legacyDefaultReadNode(n) }}
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{Source: diagnosticSource, ErrorCodes: []int32{EK4854.Code, EK4855.Code}, GetCodeActions: typeScriptFormFix.GetCodeActions})
}

// This recognizes the retired spelling only for migration; it never affects
// class types or lowering.
func legacyService(class *ast.Node) bool {
	if class == nil || !ast.IsClassDeclaration(class) || class.Name() == nil || declarationWord(class) != "" || !ast.HasSyntacticModifier(class, ast.ModifierFlagsAbstract) || ast.GetClassExtendsHeritageElement(class) != nil || len(ast.GetImplementsHeritageClauseElements(class)) != 0 {
		return false
	}
	count := 0
	for _, member := range class.Members() {
		if ast.IsStatic(member) || ast.IsSemicolonClassElement(member) {
			continue
		}
		if (!ast.IsMethodDeclaration(member) && !ast.IsPropertyDeclaration(member)) || !ast.HasSyntacticModifier(member, ast.ModifierFlagsAbstract) {
			return false
		}
		count++
	}
	return count > 0
}

func findLegacyServices(c *checker.Checker, file *ast.SourceFile, report func(*ast.Node, *formRewrite, ...any)) {
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if r := legacyServiceRewrite(c, file, n); r.fixable() {
			report(n, r)
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

func legacyServiceRewrite(c *checker.Checker, file *ast.SourceFile, class *ast.Node) *formRewrite {
	if !legacyService(class) {
		return nil
	}
	r := &formRewrite{description: "service " + class.Name().Text()}
	classStart := scanner.SkipTrivia(file.Text(), class.Modifiers().End())
	for _, modifier := range class.ModifierNodes() {
		if modifier.Kind == ast.KindAbstractKeyword {
			between := strings.TrimSpace(file.Text()[modifier.End():classStart])
			if between != "" {
				between += " "
			}
			r.edits = append(r.edits, sourceEdit{nodeStart(file, modifier), classStart + len("class"), between + "service"})
		}
	}
	for _, member := range class.Members() {
		for _, modifier := range member.ModifierNodes() {
			if modifier.Kind == ast.KindAbstractKeyword {
				end := modifier.End()
				if end < len(file.Text()) && file.Text()[end] == 32 {
					end++
				}
				r.edits = append(r.edits, sourceEdit{nodeStart(file, modifier), end, ""})
			}
		}
	}
	return r
}

func legacyDefault(n *ast.Node) bool {
	return n != nil && ast.IsPropertyDeclaration(n) && ast.IsStatic(n) && ast.HasSyntacticModifier(n, ast.ModifierFlagsReadonly) && n.Name() != nil && !ast.IsComputedPropertyName(n.Name()) && n.Name().Text() == "default" && (declarationWord(n.Parent) == "service" || legacyService(n.Parent))
}

// A legacy default migrates as one unit (VIP-9: "including corresponding
// type and value reads"): the declaration carries the warning, and its fix
// also rewrites every read of the member in the same file, value and type
// reads alike, so the repaired file compiles. A read in another file has its
// own warning and fix, which vibelang --fix applies in the same run.
func findLegacyDefaults(c *checker.Checker, file *ast.SourceFile, report func(*ast.Node, *formRewrite, ...any)) {
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if ast.IsPropertyDeclaration(n) {
			if r := legacyDefaultRewrite(c, file, n); r.fixable() {
				report(n, r)
			}
		} else if declaration := legacyDefaultRead(c, n); declaration != nil && ast.GetSourceFileOfNode(declaration) != file {
			if r := legacyDefaultRewrite(c, file, n); r.fixable() {
				report(n, r)
			}
			return false // the parts of a read are not reads
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// legacyDefaultReadNode reports whether n is a node a read of a legacy
// default can stand at.
func legacyDefaultReadNode(n *ast.Node) bool {
	return ast.IsPropertyAccessExpression(n) || ast.IsElementAccessExpression(n) || ast.IsTypeQueryNode(n) || ast.IsIndexedAccessTypeNode(n)
}

// legacyDefaultRead returns the legacy default declaration that n reads, or
// nil. The reads are the value reads S.default and S["default"] and the type
// reads typeof S.default (with any qualified continuation) and
// (typeof S)["default"].
func legacyDefaultRead(c *checker.Checker, n *ast.Node) *ast.Node {
	var symbol *ast.Symbol
	switch {
	case ast.IsPropertyAccessExpression(n):
		if n.Name().Text() != "default" {
			return nil
		}
		symbol = c.GetSymbolAtLocation(n.Name())
	case ast.IsElementAccessExpression(n):
		argument := n.AsElementAccessExpression().ArgumentExpression
		if argument == nil || !ast.IsStringLiteral(argument) || argument.Text() != "default" {
			return nil
		}
		if t := c.GetTypeAtLocation(n.Expression()); t != nil {
			symbol = c.GetPropertyOfType(t, "default")
		}
	case ast.IsTypeQueryNode(n):
		_, name, _ := legacyDefaultTypeQuery(c, n)
		if name == nil {
			return nil
		}
		symbol = c.GetSymbolAtLocation(name)
	case ast.IsIndexedAccessTypeNode(n):
		access := n.AsIndexedAccessTypeNode()
		if !ast.IsLiteralTypeNode(access.IndexType) || !ast.IsStringLiteral(access.IndexType.AsLiteralTypeNode().Literal) || access.IndexType.AsLiteralTypeNode().Literal.Text() != "default" {
			return nil
		}
		if t := c.GetTypeFromTypeNode(access.ObjectType); t != nil {
			symbol = c.GetPropertyOfType(t, "default")
		}
	default:
		return nil
	}
	if symbol == nil || !legacyDefault(symbol.ValueDeclaration()) {
		return nil
	}
	return symbol.ValueDeclaration()
}

// legacyDefaultTypeQuery splits typeof S.default.a.b into S, the name default
// and [a b]. name is nil when the query reads no legacy default. A query with
// type arguments is left alone.
func legacyDefaultTypeQuery(c *checker.Checker, n *ast.Node) (left, name *ast.Node, tail []string) {
	query := n.AsTypeQueryNode()
	if query.TypeArguments != nil {
		return nil, nil, nil
	}
	for e := query.ExprName; e != nil && ast.IsQualifiedName(e); e = e.AsQualifiedName().Left {
		qualified := e.AsQualifiedName()
		if qualified.Right.Text() == "default" {
			if symbol := c.GetSymbolAtLocation(qualified.Right); symbol != nil && legacyDefault(symbol.ValueDeclaration()) {
				return qualified.Left, qualified.Right, tail
			}
		}
		tail = append([]string{qualified.Right.Text()}, tail...)
	}
	return nil, nil, nil
}

// legacyDefaultReadEdit rewrites one read of a legacy default: a value read
// calls the factory, and a type read names the type the factory returns, so
// an exported type keeps its meaning.
func legacyDefaultReadEdit(c *checker.Checker, file *ast.SourceFile, n *ast.Node) sourceEdit {
	var text string
	switch {
	case ast.IsPropertyAccessExpression(n):
		dot := "."
		if n.AsPropertyAccessExpression().QuestionDotToken != nil {
			dot = "?."
		}
		text = expressionText(file, n.Expression()) + dot + "defaultValue()"
	case ast.IsElementAccessExpression(n):
		open := "["
		if n.AsElementAccessExpression().QuestionDotToken != nil {
			open = "?.["
		}
		text = expressionText(file, n.Expression()) + open + "\"defaultValue\"]()"
	case ast.IsTypeQueryNode(n):
		left, _, tail := legacyDefaultTypeQuery(c, n)
		text = legacyDefaultFactoryType("typeof " + expressionText(file, left) + ".defaultValue")
		for _, member := range tail {
			text += "[\"" + member + "\"]"
		}
	case ast.IsIndexedAccessTypeNode(n):
		text = legacyDefaultFactoryType(expressionText(file, n.AsIndexedAccessTypeNode().ObjectType) + "[\"defaultValue\"]")
	}
	return sourceEdit{nodeStart(file, n), n.End(), text}
}

// Use a lexical conditional type instead of the utility name ReturnType:
// a local/imported alias or type parameter can shadow that global. The infer
// binding is local to this conditional and cannot capture a source binding.
func legacyDefaultFactoryType(factory string) string {
	return "(" + factory + " extends (...args: any) => infer __VibeDefault ? __VibeDefault : never)"
}

func legacyDefaultRewrite(c *checker.Checker, file *ast.SourceFile, n *ast.Node) *formRewrite {
	r := &formRewrite{description: "defaultValue thunk"}
	if legacyDefaultReadNode(n) {
		if legacyDefaultRead(c, n) == nil {
			return nil
		}
		r.edits = []sourceEdit{legacyDefaultReadEdit(c, file, n)}
		return r
	}
	if !legacyDefault(n) || n.Initializer() == nil {
		return nil
	}
	value := expressionText(file, n.Initializer())
	if body := ast.SkipParentheses(n.Initializer()); ast.IsObjectLiteralExpression(body) && body == n.Initializer() || ast.IsBinaryExpression(body) && body.AsBinaryExpression().OperatorToken.Kind == ast.KindCommaToken {
		value = "(" + value + ")" // an arrow body that starts with { is a block
	}
	r.edits = []sourceEdit{{nodeStart(file, n.Name()), n.Name().End(), "defaultValue"}, {nodeStart(file, n.Initializer()), n.Initializer().End(), "() => " + value}}
	if n.Type() != nil {
		r.edits = append(r.edits, sourceEdit{nodeStart(file, n.Type()), n.Type().End(), "() => " + expressionText(file, n.Type())})
	}
	// The reads of this member in this file, outside the declaration itself.
	reads := 0
	var visit func(*ast.Node) bool
	visit = func(m *ast.Node) bool {
		if m == n {
			return false
		}
		if legacyDefaultReadNode(m) && legacyDefaultRead(c, m) == n {
			r.edits = append(r.edits, legacyDefaultReadEdit(c, file, m))
			reads++
			return false
		}
		return m.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	if reads > 0 {
		r.description = fmt.Sprintf("defaultValue thunk and %d %s of %s.default", reads, plural(reads, "read", "reads"), n.Parent.Name().Text())
	}
	return r
}
