package vibelang

import (
	"context"
	"regexp"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// Retired catch clauses (D216, D217). Testing a failure's type in a catch
// clause, `catch (e: NotFound)` (D131), and catching a whole Cause,
// `catch (cause: Cause)` (D176), are retired in favor of pattern matching:
//
//	try { return find(id) } catch (e) {
//	  return match (e) { when NotFound: "missing"; default: throw e; }
//	}
//	return match (try exit(effect { return try find(id) })) {
//	  when Exit.Success(let value): value;
//	  when Exit.Failure(let cause): fallback;
//	}
//
// The old clauses still compile as before (the parser's chain in
// parser/vibelang.go) and draw the warnings EK2112 and EK2113. Their quick fix
// rewrites the clauses from the chain the parser built: the original type
// nodes and statements keep their source positions.

func init() {
	fileChecks = append(fileChecks, checkRetiredCatches)
	ls.RegisterCodeFixProvider(retiredCatchFix)
}

// An oldClause is one catch clause of a retired chain as the user wrote it.
type oldClause struct {
	name       *ast.Node   // the clause's variable, or nil
	typeNode   *ast.Node   // the clause's type when it tests one, or nil
	cause      bool        // a clause typed Cause (D176)
	statements []*ast.Node // the clause's own statements, after its binding
	open       int         // the position of the clause block's {
	end        int         // the end of the clause block, after its }
}

// A retiredCatch is a try statement's catch clauses when they form the chain
// the parser builds for typed or Cause clauses.
type retiredCatch struct {
	try     *ast.Node
	clauses []oldClause
	causes  bool // the chain catches a Cause (D176)
}

// retiredCatchOf returns the retired chain of try, a try statement, or nil
// when its catch clause is one untyped clause as written.
func retiredCatchOf(file *ast.SourceFile, try *ast.Node) *retiredCatch {
	clause := try.AsTryStatement().CatchClause
	if clause == nil || clause.AsCatchClause().VariableDeclaration == nil {
		return nil
	}
	name := clause.AsCatchClause().VariableDeclaration.Name()
	if name == nil || name.Kind != ast.KindIdentifier || name.Flags&ast.NodeFlagsReparsed == 0 {
		return nil
	}
	statements := clause.AsCatchClause().Block.AsBlock().Statements.Nodes
	result := &retiredCatch{try: try}
	switch name.Text() {
	case "$caught":
		if len(statements) != 1 {
			return nil
		}
		result.collect(file, statements[0])
	case "$cause":
		if len(statements) != 2 {
			return nil
		}
		result.causes = true
		result.collect(file, statements[1])
	default:
		return nil
	}
	if len(result.clauses) == 0 {
		return nil
	}
	return result
}

// collect appends the clauses of chain, a statement of the parser's chain.
func (r *retiredCatch) collect(file *ast.SourceFile, chain *ast.Node) {
	text := file.Text()
	for chain != nil {
		switch chain.Kind {
		case ast.KindBlock:
			r.clauses = append(r.clauses, r.clauseOf(text, chain, nil))
			return
		case ast.KindThrowStatement: // the rethrow that ends a chain without an untyped clause
			return
		case ast.KindIfStatement:
			test := chain.Expression()
			var typeNode *ast.Node
			switch {
			case isFailureTest(test):
				typeNode = test.TypeArguments()[0]
			case test.Kind == ast.KindTrueKeyword && test.Flags&ast.NodeFlagsReparsed != 0:
			case test.Kind == ast.KindBinaryExpression && test.Flags&ast.NodeFlagsReparsed != 0:
			default:
				return
			}
			r.clauses = append(r.clauses, r.clauseOf(text, chain.AsIfStatement().ThenStatement, typeNode))
			chain = chain.AsIfStatement().ElseStatement
		default:
			return
		}
	}
}

// clauseOf reads one clause from body, the block the parser built for it.
func (r *retiredCatch) clauseOf(text string, body *ast.Node, typeNode *ast.Node) oldClause {
	statements := body.AsBlock().Statements.Nodes
	clause := oldClause{typeNode: typeNode, end: body.End()}
	from := body.Pos()
	if len(statements) > 0 && statements[0].Kind == ast.KindVariableStatement {
		declarations := statements[0].AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes
		if len(declarations) == 1 {
			if init := declarations[0].Initializer(); init != nil && init.Kind == ast.KindIdentifier && init.Flags&ast.NodeFlagsReparsed != 0 && (init.Text() == "$caught" || init.Text() == "$cause") {
				clause.name = declarations[0].Name()
				clause.cause = init.Text() == "$cause"
				statements = statements[1:]
				from = clause.name.End()
			}
		}
	}
	if typeNode != nil {
		from = typeNode.End()
	}
	clause.statements = statements
	clause.open = openingBrace(text, from)
	return clause
}

// openingBrace returns the position of the { that starts a catch clause's
// block, scanning from from: past the rest of the clause's head (a type and
// the closing parenthesis) when from is inside it.
func openingBrace(text string, from int) int {
	depth := 0
	for i := scanner.SkipTrivia(text, from); i < len(text); i++ {
		switch text[i] {
		case '(', '<', '[':
			depth++
		case '>', ']':
			depth--
		case ')':
			if depth == 0 {
				brace := scanner.SkipTrivia(text, i+1)
				if brace < len(text) && text[brace] == '{' {
					return brace
				}
				return -1
			}
			depth--
		case '{':
			if depth == 0 {
				return i
			}
		}
	}
	return -1
}

// annotationRange returns the range of a Cause clause's type annotation: the
// text after its variable's colon, up to the closing parenthesis.
func annotationRange(text string, name *ast.Node) core.TextRange {
	colon := scanner.SkipTrivia(text, name.End())
	if colon >= len(text) || text[colon] != ':' {
		return core.NewTextRange(scanner.SkipTrivia(text, name.Pos()), name.End())
	}
	start := scanner.SkipTrivia(text, colon+1)
	end := start
	depth := 0
	for end < len(text) {
		c := text[end]
		if c == ')' && depth == 0 {
			break
		}
		switch c {
		case '(', '<', '[':
			depth++
		case ')', '>', ']':
			depth--
		}
		end++
	}
	return core.NewTextRange(start, len(strings.TrimRight(text[:end], " \t\r\n")))
}

// checkRetiredCatches reports EK2112 at each typed catch clause and EK2113 at
// each catch clause typed Cause.
func checkRetiredCatches(c *checker.Checker, file *ast.SourceFile) {
	text := file.Text()
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		if expression := catchExpressionOf(n); expression != nil {
			handler := expression.Arguments()[1]
			if len(handler.Parameters()) == 1 {
				parameter := handler.Parameters()[0]
				if parameter.Type() != nil && ast.IsIdentifier(parameter.Name()) {
					report(c, parameter.Type(), EK2112, parameter.Name().Text())
				}
			}
		}
		if n.Kind == ast.KindTryStatement {
			if chain := retiredCatchOf(file, n); chain != nil {
				for _, clause := range chain.clauses {
					switch {
					case clause.cause && clause.name != nil:
						reportAt(c, file, annotationRange(text, clause.name), EK2113)
					case clause.typeNode != nil:
						name := "e"
						if clause.name != nil {
							name = clause.name.Text()
						}
						reportAt(c, file, core.NewTextRange(scanner.SkipTrivia(text, clause.typeNode.Pos()), clause.typeNode.End()), EK2112, name)
					}
				}
			}
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// retiredCatchFix is the quick fix of EK2112 and EK2113.
var retiredCatchFix = &ls.CodeFixProvider{
	Source:     diagnosticSource,
	ErrorCodes: []int32{EK2112.Code, EK2113.Code},
	GetCodeActions: func(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		if fix.Diagnostic == nil {
			return nil, nil
		}
		chain := retiredCatchAt(fix.SourceFile, fix.Span)
		if chain == nil {
			return retiredCatchExpressionActions(ctx, fix)
		}
		c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
		defer done()
		description, start, newText, ok := chain.rewrite(c, fix.SourceFile)
		if !ok {
			return nil, nil
		}
		end := chain.try.AsTryStatement().CatchClause.End()
		if chain.causes {
			end = chain.try.End()
		}
		return []*ls.CodeAction{{
			Description: description,
			Changes:     []*lsproto.TextEdit{{Range: fix.LS.ToLSPRange(fix.SourceFile, core.NewTextRange(start, end)), NewText: newText}},
		}}, nil
	},
}

// retiredCatchAt returns the retired chain whose catch clauses contain span.
func retiredCatchAt(file *ast.SourceFile, span core.TextRange) *retiredCatch {
	var found *retiredCatch
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		if found != nil {
			return true
		}
		if n.Kind == ast.KindTryStatement {
			if clause := n.AsTryStatement().CatchClause; clause != nil && clause.Pos() <= span.Pos() && span.End() <= clause.End() {
				if chain := retiredCatchOf(file, n); chain != nil {
					found = chain
				}
			}
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return found
}

// dottedName is a pattern a type can become: a name or a dotted name.
var dottedName = regexp.MustCompile(`^[A-Za-z_$][A-Za-z0-9_$]*(\.[A-Za-z_$][A-Za-z0-9_$]*)*$`)

// patternOf returns the match pattern for a clause's type: each member of a
// union must name a class, such as an error declaration, so that the
// pattern tests instances of it. ok is false for any other type.
func patternOf(c *checker.Checker, text string, typeNode *ast.Node) (string, bool) {
	var members []*ast.Node
	if typeNode.Kind == ast.KindUnionType {
		members = typeNode.AsUnionTypeNode().Types.Nodes
	} else {
		members = []*ast.Node{typeNode}
	}
	var patterns []string
	for _, member := range members {
		if member.Kind != ast.KindTypeReference || member.AsTypeReferenceNode().TypeArguments != nil {
			return "", false
		}
		name := member.AsTypeReferenceNode().TypeName
		if ast.NodeIsMissing(name) {
			return "", false // a syntax error's missing type has no text
		}
		source := text[scanner.SkipTrivia(text, name.Pos()):name.End()]
		if !dottedName.MatchString(source) {
			return "", false
		}
		symbol := c.GetSymbolAtLocation(rightmostName(name))
		if symbol == nil || symbol.Flags()&ast.SymbolFlagsClass == 0 {
			if symbol == nil || symbol.Flags()&ast.SymbolFlagsAlias == 0 {
				return "", false
			}
			if target := c.GetAliasedSymbol(symbol); target == nil || target.Flags()&ast.SymbolFlagsClass == 0 {
				return "", false
			}
		}
		patterns = append(patterns, source)
	}
	return strings.Join(patterns, " or "), true
}

// rightmostName returns the last identifier of an entity name.
func rightmostName(name *ast.Node) *ast.Node {
	if name.Kind == ast.KindQualifiedName {
		return name.AsQualifiedName().Right
	}
	return name
}

// rewrite returns the quick fix for the chain: its description, the start of
// the text it replaces, and the new text. The replaced text ends at the end
// of the catch clause, or of the whole try statement for a Cause clause.
func (r *retiredCatch) rewrite(c *checker.Checker, file *ast.SourceFile) (string, int, string, bool) {
	text := file.Text()
	if r.causes {
		return r.rewriteCause(text)
	}
	main := "e"
	for _, clause := range r.clauses {
		if clause.name != nil {
			main = clause.name.Text()
			break
		}
	}
	patterns := make([]string, len(r.clauses))
	for i, clause := range r.clauses {
		if clause.open < 0 {
			return "", 0, "", false
		}
		if clause.typeNode != nil {
			pattern, ok := patternOf(c, text, clause.typeNode)
			if !ok {
				return "", 0, "", false
			}
			patterns[i] = pattern
		} else if i != len(r.clauses)-1 {
			return "", 0, "", false // clauses after an untyped one cannot run (EK2106)
		}
	}
	catchStart := scanner.SkipTrivia(text, r.try.AsTryStatement().CatchClause.Pos())
	base := indentationAt(text, catchStart)
	unit := indentUnit(text, r.clauses[0], base)
	if form, ok := r.matchForm(text, main, patterns, base, unit); ok {
		return "Test the failure with match", catchStart, form, true
	}
	var b strings.Builder
	b.WriteString("catch (" + main + ") {\n" + base + unit)
	untyped := false
	for i, clause := range r.clauses {
		body := text[clause.open+1 : clause.end-1]
		if clause.name != nil && clause.name.Text() != main {
			body = "\n" + base + unit + unit + "const " + clause.name.Text() + " = " + main + body
		}
		body = reindent(body, unit)
		if patterns[i] == "" {
			untyped = true
			if i == 0 {
				return "", 0, "", false
			}
			b.WriteString(" else {" + body + "}")
			continue
		}
		if i > 0 {
			b.WriteString(" else ")
		}
		b.WriteString("if (" + main + " is " + patterns[i] + ") {" + body + "}")
	}
	if !untyped {
		b.WriteString(" else {\n" + base + unit + unit + "throw " + main + "\n" + base + unit + "}")
	}
	b.WriteString("\n" + base + "}")
	return "Test the failure with is", catchStart, b.String(), true
}

// matchForm returns the chain as `return match (e) { ... }` when every
// clause is one return of a value and names the same variable.
func (r *retiredCatch) matchForm(text, main string, patterns []string, base, unit string) (string, bool) {
	inner := base + unit + unit
	arms := make([]string, len(r.clauses))
	for i, clause := range r.clauses {
		if clause.name != nil && clause.name.Text() != main {
			return "", false
		}
		value, ok := singleReturn(text, clause.statements)
		if !ok {
			return "", false
		}
		if patterns[i] == "" {
			arms[i] = "default: " + value + ";"
		} else {
			arms[i] = "when " + patterns[i] + ": " + value + ";"
		}
		statement := clause.statements[0]
		leading := strings.TrimSpace(text[clause.open+1 : scanner.SkipTrivia(text, statement.Pos())])
		if leading != "" {
			arms[i] = reindent(leading, unit) + "\n" + inner + arms[i]
		}
		trailing := strings.TrimRight(text[statement.End():clause.end-1], " \t\r\n")
		arms[i] += reindent(trailing, unit)
	}
	if patterns[len(patterns)-1] != "" {
		arms = append(arms, "default: throw "+main+";")
	}
	return "catch (" + main + ") {\n" + base + unit + "return match (" + main + ") {\n" + inner + strings.Join(arms, "\n"+inner) + "\n" + base + unit + "}\n" + base + "}", true
}

// rewriteCause rewrites `try { return X } catch (cause: Cause) { return Y }`
// as `return match (try exit(effect { return X })) { ... }`. Other shapes have no quick fix.
func (r *retiredCatch) rewriteCause(text string) (string, int, string, bool) {
	ts := r.try.AsTryStatement()
	if ts.FinallyBlock != nil || r.try.Flags&ast.NodeFlagsVibeLang != 0 || len(r.clauses) != 1 || !r.clauses[0].cause || r.clauses[0].name == nil {
		return "", 0, "", false
	}
	body, ok := singleReturn(text, ts.TryBlock.AsBlock().Statements.Nodes)
	if !ok {
		return "", 0, "", false
	}
	fallback, ok := singleReturn(text, r.clauses[0].statements)
	if !ok {
		return "", 0, "", false
	}
	start := scanner.SkipTrivia(text, r.try.Pos())
	base := indentationAt(text, start)
	unit := "  "
	value := "value"
	if r.clauses[0].name.Text() == value {
		value = "result"
	}
	inner := base + unit
	return "Match on exit(…)", start, "return match (try exit(effect { return " + body + " })) {\n" +
		inner + "when Exit.Success(let " + value + "): " + value + ";\n" +
		inner + "when Exit.Failure(let " + r.clauses[0].name.Text() + "): " + fallback + ";\n" +
		base + "}", true
}

// singleReturn returns the text of X when statements are one `return X`.
func singleReturn(text string, statements []*ast.Node) (string, bool) {
	if len(statements) != 1 || statements[0].Kind != ast.KindReturnStatement {
		return "", false
	}
	expression := statements[0].Expression()
	if expression == nil {
		return "", false
	}
	value := strings.TrimSpace(text[expression.Pos():expression.End()])
	suffix := strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(text[expression.End():statements[0].End()]), ";"))
	if suffix != "" {
		value += " " + suffix
	}
	return value, true
}

// indentationAt returns the leading white space of the line holding pos.
func indentationAt(text string, pos int) string {
	start := strings.LastIndexByte(text[:pos], '\n') + 1
	end := start
	for end < len(text) && (text[end] == ' ' || text[end] == '\t') {
		end++
	}
	return text[start:end]
}

// indentUnit guesses one level of indentation from a clause's first line.
func indentUnit(text string, clause oldClause, base string) string {
	if clause.open < 0 {
		return "  "
	}
	body := text[clause.open+1 : clause.end-1]
	if newline := strings.IndexByte(body, '\n'); newline >= 0 {
		line := body[newline+1:]
		indent := line[:len(line)-len(strings.TrimLeft(line, " \t"))]
		if strings.HasPrefix(indent, base) && len(indent) > len(base) {
			return indent[len(base):]
		}
	}
	return "  "
}

// reindent indents every line of body after the first by unit.
func reindent(body, unit string) string {
	return strings.ReplaceAll(body, "\n", "\n"+unit)
}
