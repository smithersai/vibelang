package vibelang

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// Move just the throwing instruction to TypeScript. The operand stays in its
// lexical scope, at its original evaluation point, so captured cells, this,
// arguments, getters and surrounding native try/catch keep their meaning.
// No throws contract is invented: the foreign helper has the ordinary unknown
// contract, just as the same unannotated helper in a sibling .ts file would.
const nothrowRaiseBody = "export function raise(value: unknown): never { throw value }"

func preservingThrowFix(c *checker.Checker, file *ast.SourceFile, site *ast.Node, key string) (fileFix, bool) {
	if site.Kind != ast.KindThrowStatement || site.Expression() == nil {
		return fileFix{}, false
	}
	start := nodeStart(file, site)
	operand := site.Expression()
	operandStart := nodeStart(file, operand)
	if start+len("throw") > operandStart || operandStart >= operand.End() || operand.End() > len(file.Text()) || !strings.HasPrefix(file.Text()[start:], "throw") {
		return fileFix{}, false // leave a recovered or missing operand to its syntax diagnostic
	}
	home := analyzerFor(c).plainHomeOf(site)
	if home == nil {
		return fileFix{}, false
	}
	if isCatchHandlerOf(home) {
		return preservingHandlerThrows(c, file, site, home, key)
	}
	// An Effect-returning body and effect parameters prohibit unknown throws too.
	// A native catch in the same activation contains the exception, so a TS
	// instruction preserves that catch and native cleanup without changing the
	// factory result. An escaping throw cannot meet the contract.
	if ast.IsFunctionLike(home) {
		if isMarkedEffect(home) {
			return fileFix{}, false
		}
		if sig := c.GetSignatureFromDeclaration(home); sig != nil && isEffectfulType(c, c.GetReturnTypeOfSignature(sig)) && !inCatchingTry(site) {
			return fileFix{}, false
		}
	}
	name := ""
	for _, statement := range file.Statements.Nodes {
		if !parser.IsVibeLangModuleDeclaration(statement) {
			continue
		}
		module := statement.Name().Text()
		body := parser.ModuleDeclarationBody(file, statement)
		if strings.TrimSpace(file.Text()[body.Pos():body.End()]) != nothrowRaiseBody {
			continue
		}
		for _, imp := range file.Statements.Nodes {
			if !ast.IsImportDeclaration(imp) || !parser.IsVibeLangModuleReference(imp.ModuleSpecifier()) || imp.ModuleSpecifier().Text() != parser.ModuleDeclarationSpecifier(file.FileName(), module) {
				continue
			}
			clause := imp.AsImportDeclaration().ImportClause
			if clause == nil || clause.AsImportClause().NamedBindings == nil || !ast.IsNamedImports(clause.AsImportClause().NamedBindings) {
				continue
			}
			specs := clause.AsImportClause().NamedBindings.AsNamedImports().Elements.Nodes
			if len(specs) == 1 && specs[0].AsImportSpecifier().PropertyName != nil && specs[0].AsImportSpecifier().PropertyName.Text() == "raise" {
				alias := specs[0].Name()
				if c.ResolveName(alias.Text(), site, ast.SymbolFlagsValue, false) == c.GetSymbolAtLocation(alias) {
					name = alias.Text()
				}
			}
		}
	}
	var edits []sourceEdit
	if name == "" {
		name = freshName(file, "$raise")
		module := freshName(file, "$throw$ts")
		header := "\nmodule " + module + " {\n" + nothrowRaiseBody + "\n}\nimport { raise as " + name + " } from " + module + "\n"
		edits = append(edits, sourceEdit{len(file.Text()), len(file.Text()), header})
	}
	// Keep comments between the keyword and operand, including multiline trivia.
	between := file.Text()[start+len("throw") : operandStart]
	if strings.TrimSpace(between) == "" {
		between = ""
	}
	// Leave the operand's bytes outside every replacement, so a refused
	// nested call retains its original span while this throw can still move.
	closing := ")"
	if operand.End() == len(file.Text()) && len(edits) > 0 {
		closing += edits[0].text
		edits = nil
	}
	edits = append(edits,
		sourceEdit{start, nodeStart(file, operand), name + "(" + between},
		sourceEdit{operand.End(), operand.End(), closing},
	)
	return fileFix{code: EK0401.Code, edits: edits, key: key, siteStart: start, siteEnd: site.End(), sited: true}, true
}

// A plain handler's JavaScript throw is a defect in Effect TypeScript.
// The spec's die repair preserves that Exit; turning it into Effect.fail
// would silently move the value from the defect channel to the error channel.
// Replacing a native throw with an Effect return changes IteratorClose and
// disposal precedence. Such cleanup must keep the native abrupt completion.
func nothrowHasObservableCleanup(body *ast.Node) bool {
	bad := false
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if ast.IsFunctionLike(n) && !isProgramArrow(n) {
			return false
		}
		if n.Kind == ast.KindTryStatement || n.Kind == ast.KindForOfStatement || ast.IsVariableDeclarationList(n) && n.Flags&ast.NodeFlagsUsing != 0 {
			bad = true
			return true
		}
		return n.ForEachChild(visit)
	}
	body.ForEachChild(visit)
	return bad
}

func preservingHandlerThrows(c *checker.Checker, file *ast.SourceFile, site, home *ast.Node, key string) (fileFix, bool) {
	if nothrowHasObservableCleanup(home.Body()) {
		return fileFix{}, false
	}

	at := nodeStart(file, home)
	if home.Kind == ast.KindArrowFunction && file.Text()[at] != '(' && file.Text()[at] != '<' {
		return fileFix{}, false // bare-arrow modifier repair belongs to nothrow-impl
	}
	edits := []sourceEdit{{at, at, "effect "}}
	if annotation := home.Type(); annotation != nil {
		colon := nodeStart(file, annotation) - 1
		for colon >= 0 && (file.Text()[colon] == ' ' || file.Text()[colon] == '\t') {
			colon--
		}
		if colon < 0 || file.Text()[colon] != ':' {
			return fileFix{}, false
		}
		edits = append(edits, sourceEdit{colon, annotation.End(), ""})
	}
	safe := true
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if ast.IsFunctionLike(n) && !isProgramArrow(n) {
			return false
		}
		if n.Kind == ast.KindTryStatement {
			safe = false
			return true
		}
		if n.Kind == ast.KindThrowStatement {
			visible := c.ResolveName("die", n, ast.SymbolFlagsValue, false)
			if visible != nil && visible.Flags()&ast.SymbolFlagsAlias != 0 {
				visible = c.GetAliasedSymbol(visible)
			}
			if expected := servicesFor(c).effectExport("Effect", "die"); expected == nil || visible != expected {
				safe = false
				return true
			}
			expression := false
			for p := n.Parent; p != nil && p != home; p = p.Parent {
				if isProgramArrow(p) {
					expression = true
					break
				}
			}
			operand := n.Expression()
			between := file.Text()[nodeStart(file, n)+len("throw") : nodeStart(file, operand)]
			prefix := "return try die("
			if expression {
				prefix = "(try die("
			}
			suffix := ")"
			if expression {
				suffix = "))"
			}
			edits = append(edits, sourceEdit{nodeStart(file, n), operand.End(), prefix + between + nodeText(file, operand) + suffix})
			return false
		}
		return n.ForEachChild(visit)
	}
	home.Body().ForEachChild(visit)
	if !safe {
		return fileFix{}, false
	}
	return fileFix{code: EK0401.Code, edits: edits, key: key, siteStart: site.Pos(), siteEnd: site.End(), sited: true}, true
}
