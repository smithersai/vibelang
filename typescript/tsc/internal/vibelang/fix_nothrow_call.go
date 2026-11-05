package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"strconv"
	"strings"
)

// The actual throwing call executes in TypeScript. Fixed-arity method argument
// thunks evaluate after its getter. Bare calls and constructors keep argument
// reads in their original scope, retaining control-flow narrowing.
// Function (without a call signature) avoids inventing a never-throws contract.
// Generic/overloaded/predicate/optional calls and suspension operands refuse at their site.
func nothrowCallBody(method string, arity int, construct bool) string {
	constraint := "Function"
	target := "target"
	callable := "Extract<T,(...args:any[])=>any>"
	params := "Parameters<" + callable + ">"
	result := "ReturnType<" + callable + ">"
	if method != "" {
		constraint = "{" + strconv.Quote(method) + ":Function}"
		target = "target[" + strconv.Quote(method) + "]"
		callable = "Extract<T[" + strconv.Quote(method) + "],(...args:any[])=>any>"
		params = "Parameters<" + callable + ">"
		result = "ReturnType<" + callable + ">"
	}
	if construct {
		constraint = "new(...args:any[])=>any"
		target = "new target"
		params = "ConstructorParameters<T>"
		result = "InstanceType<T>"
	}
	signature := "target:T"
	operands := []string{}
	for i := 0; i < arity; i++ {
		name := fmt.Sprintf("arg%d", i)
		parameterType := params + fmt.Sprintf("[%d]", i)
		if method != "" {
			signature += "," + name + ":()=>" + parameterType
			operands = append(operands, name+"()")
		} else {
			signature += "," + name + ":" + parameterType
			operands = append(operands, name)
		}
	}
	return "export function invoke<T extends " + constraint + ">(" + signature + "):" + result + " { return " + target + "(" + strings.Join(operands, ",") + ") }"
}

func preservingNothrowCallFix(c *checker.Checker, file *ast.SourceFile, site *ast.Node, key string) (fileFix, bool) {
	if !ast.IsCallExpression(site) && !ast.IsNewExpression(site) {
		return fileFix{}, false
	}
	home := analyzerFor(c).plainHomeOf(site)
	if home == nil {
		return fileFix{}, false
	}
	if ast.IsFunctionLike(home) {
		if isMarkedEffect(home) {
			return fileFix{}, false
		}
		if sig := c.GetSignatureFromDeclaration(home); sig != nil && isEffectfulType(c, c.GetReturnTypeOfSignature(sig)) {
			return fileFix{}, false
		}
	}
	safe := true
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		// Direct eval must retain its activation's variable environment.
		if ast.IsCallExpression(n) && ast.IsIdentifier(ast.SkipParentheses(n.Expression())) && ast.SkipParentheses(n.Expression()).Text() == "eval" {
			safe = false
			return true
		}
		if n.Kind == ast.KindYieldExpression || n.Kind == ast.KindAwaitExpression {
			safe = false
			return true
		}
		return n.ForEachChild(visit)
	}
	site.ForEachChild(visit)
	if ast.IsCallExpression(site) && ast.IsIdentifier(ast.SkipParentheses(site.Expression())) && ast.SkipParentheses(site.Expression()).Text() == "eval" {
		safe = false
	}
	if !safe {
		return fileFix{}, false
	}

	callee := site.Expression()
	if callee == nil || len(site.TypeArguments()) != 0 {
		return fileFix{}, false
	}
	kind := checker.SignatureKindCall
	construct := ast.IsNewExpression(site)
	if construct {
		kind = checker.SignatureKindConstruct
	}
	calleeType := c.GetTypeAtLocation(callee)
	if !stableNothrowCallTarget(calleeType) {
		return fileFix{}, false
	}
	signatures := c.GetSignaturesOfType(calleeType, kind)
	if len(signatures) != 1 || len(signatures[0].TypeParameters()) != 0 || c.GetTypePredicateOfSignature(signatures[0]) != nil {
		return fileFix{}, false
	}
	method := ""
	target := callee
	if !construct && ast.IsPropertyAccessExpression(callee) {
		if callee.Expression() == nil || callee.Expression().Kind == ast.KindSuperKeyword || !ast.IsIdentifier(callee.Name()) {
			return fileFix{}, false
		}
		method = callee.Name().Text()
		target = callee.Expression()
	} else if !construct && !ast.IsIdentifier(callee) {
		return fileFix{}, false
	}
	if !stableNothrowCallTarget(c.GetTypeAtLocation(target)) {
		return fileFix{}, false
	}
	if strings.Contains(nodeText(file, callee), "?.") {
		return fileFix{}, false
	}
	args := site.Arguments()
	for _, arg := range args {
		if ast.IsSpreadElement(arg) {
			return fileFix{}, false
		}
	}
	open := scanner.SkipTrivia(file.Text(), callee.End())
	if open >= site.End() || file.Text()[open] != '(' {
		return fileFix{}, false
	}
	// Keep comments intact even where a callee suffix cannot be moved verbatim.
	// The ordinary operand bytes need no rewrite; decline this spelling instead.
	trivia := file.Text()[target.End():open]
	prefix := file.Text()[nodeStart(file, site):nodeStart(file, target)]
	if strings.Contains(trivia, "/*") || strings.Contains(trivia, "//") || strings.Contains(prefix, "/*") || strings.Contains(prefix, "//") {
		return fileFix{}, false
	}
	bodyText := nothrowCallBody(method, len(args), construct)

	name := ""
	for _, statement := range file.Statements.Nodes {
		if !parser.IsVibeLangModuleDeclaration(statement) {
			continue
		}
		body := parser.ModuleDeclarationBody(file, statement)
		if strings.TrimSpace(file.Text()[body.Pos():body.End()]) != bodyText {
			continue
		}
		module := statement.Name().Text()
		for _, imp := range file.Statements.Nodes {
			if !ast.IsImportDeclaration(imp) || !parser.IsVibeLangModuleReference(imp.ModuleSpecifier()) || imp.ModuleSpecifier().Text() != parser.ModuleDeclarationSpecifier(file.FileName(), module) {
				continue
			}
			clause := imp.AsImportDeclaration().ImportClause
			if clause == nil || clause.AsImportClause().NamedBindings == nil || !ast.IsNamedImports(clause.AsImportClause().NamedBindings) {
				continue
			}
			specs := clause.AsImportClause().NamedBindings.AsNamedImports().Elements.Nodes
			if len(specs) == 1 && specs[0].AsImportSpecifier().PropertyName != nil && specs[0].AsImportSpecifier().PropertyName.Text() == "invoke" {
				alias := specs[0].Name()
				if c.ResolveName(alias.Text(), site, ast.SymbolFlagsValue, false) == c.GetSymbolAtLocation(alias) {
					name = alias.Text()
				}
			}
		}
	}
	var edits []sourceEdit
	if name == "" {
		name = freshName(file, "$invoke")
		module := freshName(file, "$call$ts")
		header := "\nmodule " + module + " {\n" + bodyText + "\n}\nimport { invoke as " + name + " } from " + module + "\n"
		edits = append(edits, sourceEdit{len(file.Text()), len(file.Text()), header})
	}
	// Leave each original operand outside replacement ranges. This also preserves
	// the bytes of any nested diagnostic that cannot itself be repaired.
	start := nodeStart(file, site)
	targetStart := nodeStart(file, target)
	if start == targetStart {
		edits = append(edits, sourceEdit{start, start, name + "("})
	} else {
		edits = append(edits, sourceEdit{start, targetStart, name + "("})
	}
	separator := ","
	if len(args) == 0 {
		separator = ""
	}
	edits = append(edits, sourceEdit{target.End(), open + 1, separator})
	if method != "" {
		for _, arg := range args {
			edits = append(edits, sourceEdit{nodeStart(file, arg), nodeStart(file, arg), "() => ("}, sourceEdit{arg.End(), arg.End(), ")"})
		}
	}
	return fileFix{code: EK0401.Code, edits: edits, key: key, siteStart: site.Pos(), siteEnd: site.End(), sited: true}, true
}

// A deferred receiver can change an inferred result from its constraint
// (number) to ReturnType<T["read"]>. Union/intersection calls also combine
// parameter domains differently from Parameters<T>. Keep these sites intact.
func stableNothrowCallTarget(t *checker.Type) bool {
	return t != nil && t.Flags()&(checker.TypeFlagsInstantiableNonPrimitive|checker.TypeFlagsUnionOrIntersection) == 0
}
