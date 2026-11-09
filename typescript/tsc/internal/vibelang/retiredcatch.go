package vibelang

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
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
		// VIP-5 handler annotations are ordinary function parameter types,
		// not the retired type-filtering catch-clause syntax.

		if n.Kind == ast.KindTryStatement {
			if chain := retiredCatchOf(file, n); chain != nil {
				for _, clause := range chain.clauses {
					switch {
					case clause.cause && clause.name != nil:
						reportAt(c, file, annotationRange(text, clause.name), EK2113)

					case clause.typeNode != nil:
						name := "e" // a destructured binding is no name to test
						if clause.name != nil && ast.IsIdentifier(clause.name) {
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

// rightmostName returns the last identifier of an entity name.
func rightmostName(name *ast.Node) *ast.Node {
	if name.Kind == ast.KindQualifiedName {
		return name.AsQualifiedName().Right
	}
	return name
}
