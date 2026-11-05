package parser

import (
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
)

func patternUsesIterator(pat *pattern) bool {
	if pat == nil {
		return false
	}
	if pat.kind == patternArray {
		return true
	}
	for _, item := range pat.items {
		if patternUsesIterator(item) {
			return true
		}
	}
	for _, clause := range pat.clauses {
		if patternUsesIterator(clause.pattern) {
			return true
		}
	}
	return patternUsesIterator(pat.rest)
}

func (p *Parser) newMatchCacheName() string {
	p.vibelangMatchTemps++
	return "$matchCache" + strconv.Itoa(p.vibelangMatchTemps)
}

func (p *Parser) matchCacheCall(ctx *matchCompile, method string, at core.TextRange, args ...*ast.Node) *ast.Node {
	return p.mCall(p.mProperty(p.mTemp(ctx.cache, at), method, at), args, at)
}

func (p *Parser) matchCacheStatements(statements []*ast.Node, cache string, at core.TextRange) []*ast.Node {
	decl := p.mConst(p.mTemp(cache, at), ast.NodeFlagsConst, p.mCall(p.vibelangIntrinsic("$matchCache", at), nil, at), at)
	return append([]*ast.Node{decl}, statements...)
}

// VibeLangMatchCacheBindings recognizes only private cache declarations
// directly in this block. Hoisted is bindings keep their tests in the source
// condition, so checking retains assignment flow; native emission guards
// their lexical home against JavaScript throws.
func VibeLangMatchCacheBindings(node *ast.Node) []*ast.Node {
	if node == nil || node.Kind != ast.KindBlock {
		return nil
	}
	var names []*ast.Node
	for _, statement := range node.Statements() {
		if name := VibeLangMatchCacheDeclaration(statement); name != nil {
			names = append(names, name)
		}
	}
	return names
}

func VibeLangMatchCacheDeclaration(node *ast.Node) *ast.Node {
	if node == nil || node.Kind != ast.KindVariableStatement {
		return nil
	}
	decls := node.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes
	if len(decls) != 1 {
		return nil
	}
	decl := decls[0]
	init := decl.Initializer()
	if init == nil || !ast.IsCallExpression(init) {
		return nil
	}
	callee := init.Expression()
	if !ast.IsIdentifier(callee) || callee.Flags&ast.NodeFlagsReparsed == 0 || callee.Text() != "$matchCache" {
		return nil
	}
	return decl.Name()
}

// VibeLangMatchCacheCondition marks an is condition whose successful path
// finishes its cache. Checking sees the original && assignment flow; native
// emission also finishes the false path without creating a callback.
func VibeLangMatchCacheCondition(node *ast.Node) *ast.Node {
	if node == nil || node.Kind != ast.KindParenthesizedExpression {
		return nil
	}
	expression := node.Expression()
	if expression.Kind != ast.KindBinaryExpression || expression.AsBinaryExpression().OperatorToken.Kind != ast.KindAmpersandAmpersandToken {
		return nil
	}
	return VibeLangMatchCacheFinish(ast.SkipParentheses(expression.AsBinaryExpression().Right))
}

// VibeLangMatchCacheFinish recognizes a private successful-cleanup step,
// including while conditions whose tests are emitted as separate statements.
func VibeLangMatchCacheFinish(node *ast.Node) *ast.Node {
	if node == nil || node.Kind != ast.KindBinaryExpression {
		return nil
	}
	binary := node.AsBinaryExpression()
	if binary.OperatorToken.Kind != ast.KindCommaToken || binary.OperatorToken.Flags&ast.NodeFlagsReparsed == 0 || binary.Right.Kind != ast.KindTrueKeyword {
		return nil
	}
	call := binary.Left
	if !ast.IsCallExpression(call) || len(call.Arguments()) != 0 {
		return nil
	}
	callee := call.Expression()
	if !ast.IsPropertyAccessExpression(callee) || callee.Name().Text() != "finish" {
		return nil
	}
	name := callee.Expression()
	if !ast.IsIdentifier(name) || name.Flags&ast.NodeFlagsReparsed == 0 || !strings.HasPrefix(name.Text(), "$matchCache") {
		return nil
	}
	return name
}

// MatchPropertyCaches preserves native checking paths while emitters replace
// only the pattern-owned observations with VIP-7 HasPropertyCached/GetCached.
// Source reads in guards, arm values and object rest remain ordinary reads.
var matchPropertyCachesKey = ast.NewSourceFileDataKey[map[*ast.Node]*ast.Node]()

func MatchPropertyCaches(file *ast.SourceFile) map[*ast.Node]*ast.Node {
	return file.GetOrComputeData(matchPropertyCachesKey, func(*ast.SourceFile) map[*ast.Node]*ast.Node { return nil })
}

func (p *Parser) cachePatternRead(read *ast.Node, ctx *matchCompile) *ast.Node {
	if ctx.cache != "" {
		if p.vibelangPropertyCaches == nil {
			p.vibelangPropertyCaches = map[*ast.Node]*ast.Node{}
		}
		p.vibelangPropertyCaches[read] = p.mTemp(ctx.cache, read.Loc)
	}
	return read
}

func patternUsesPropertyCache(pat *pattern) bool {
	if pat == nil {
		return false
	}
	if len(pat.clauses) != 0 {
		return true
	}
	for _, item := range pat.items {
		if patternUsesPropertyCache(item) {
			return true
		}
	}
	return patternUsesPropertyCache(pat.rest)
}

func patternUsesCache(pat *pattern) bool {
	return patternUsesIterator(pat) || patternUsesPropertyCache(pat)
}

// MatchIsTest returns an is wrapper's checking predicate. A property cache
// adds a declaration before the return, without changing the predicate or
// the relationship between its parameter and the captured subject.
func MatchIsTest(arrow *ast.Node) *ast.Node {
	body := arrow.Body()
	if !ast.IsBlock(body) {
		return body
	}
	statements := body.Statements()
	if len(statements) != 2 || !ast.IsVariableStatement(statements[0]) || !ast.IsReturnStatement(statements[1]) {
		return nil
	}
	declarations := statements[0].AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes
	if len(declarations) != 1 {
		return nil
	}
	name, init := declarations[0].Name(), declarations[0].Initializer()
	if !ast.IsIdentifier(name) || name.Flags&ast.NodeFlagsReparsed == 0 || !strings.HasPrefix(name.Text(), "$matchCache") ||
		init == nil || !ast.IsCallExpression(init) || !ast.IsIdentifier(init.Expression()) || init.Expression().Text() != "$matchCache" {
		return nil
	}
	return statements[1].Expression()
}
