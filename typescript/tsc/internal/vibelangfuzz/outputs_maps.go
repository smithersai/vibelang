package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"github.com/microsoft/TypeScript/tsc/internal/sourcemap"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

type statementSpan struct{ start, end int }

// statementKey identifies a statement preserved by emit, ignoring trivia and
// optional semicolons. Token spelling is retained, including string contents.
func statementKey(text string) string {
	s := scanner.NewScanner()
	s.SetText(text)
	var key strings.Builder
	for token := s.Scan(); token != ast.KindEndOfFile; token = s.Scan() {
		if token == ast.KindSemicolonToken || ast.IsTrivia(token) {
			continue
		}
		fmt.Fprintf(&key, "%d:%q;", token, s.TokenText())
	}
	return key.String()
}

// statementShape retains executable syntax through TypeScript type erasure.
// Exact source spelling alone can match only an untyped lookalike while
// excluding the corresponding typed declaration or asserted assignment.
func statementShape(node *ast.Node) string {
	var key strings.Builder
	var visit ast.Visitor
	visit = func(n *ast.Node) bool {
		if ast.IsTypeNode(n) || n.Kind == ast.KindTypeParameter {
			return false
		}
		switch n.Kind {
		case ast.KindParenthesizedExpression, ast.KindAsExpression, ast.KindTypeAssertionExpression, ast.KindNonNullExpression, ast.KindSatisfiesExpression:
			visit(n.Expression())
			return false
		}
		fmt.Fprintf(&key, "(%d", n.Kind)
		if ast.IsIdentifier(n) || ast.IsPrivateIdentifier(n) || ast.IsLiteralExpression(n) {
			fmt.Fprintf(&key, ":%q", n.Text())
		}
		switch n.Kind {
		case ast.KindVariableDeclarationList:
			fmt.Fprintf(&key, ":%d", n.Flags&ast.NodeFlagsBlockScoped)
		case ast.KindPrefixUnaryExpression:
			fmt.Fprintf(&key, ":%d", n.AsPrefixUnaryExpression().Operator)
		case ast.KindPostfixUnaryExpression:
			fmt.Fprintf(&key, ":%d", n.AsPostfixUnaryExpression().Operator)
		}
		n.ForEachChild(visit)
		key.WriteByte(')')
		return false
	}
	visit(node)
	return key.String()
}

// statementIdentity recognizes named declarations across TypeScript's type
// erasure and VibeLang's initializer lowering. It is used only when unique in
// the source, so a generated statement cannot borrow another scope's binding.
func statementIdentity(n *ast.Node) string {
	switch {
	case ast.IsFunctionDeclaration(n), ast.IsClassDeclaration(n):
		if n.Name() != nil && ast.IsIdentifier(n.Name()) {
			return n.Kind.String() + ":" + n.Name().Text()
		}
	case ast.IsVariableStatement(n):
		var names []string
		for _, declaration := range n.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes {
			if !ast.IsIdentifier(declaration.Name()) {
				return ""
			}
			names = append(names, declaration.Name().Text())
		}
		if len(names) > 0 {
			return "bindings:" + strings.Join(names, ",")
		}
	}
	return ""
}

// checkStatementMappings strengthens the D34/Chapter 28 debugging oracle
// beyond bounds. Every mapped statement at the start of an emitted line must
// point into an original statement. For a statement preserved by emit, the
// mapping must point inside one of its matching source statements or forms.
//
// The spec does not assign every synthetic helper statement to one source
// statement or require a segment for each helper. For those statements the
// weaker stated guarantee is checked: existing mappings name original .vibe
// statement positions; no one-to-one lowering correspondence is invented.
func (oc *OutputChecker) checkStatementMappings(name, generated, source string, sourceIndex int, m SourceMap) {
	// Read source forms before native do statement lifting. The oracle must
	// recognize a do value even when a backend emits it as a return.
	original, forms := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/source/main.vibe", PathKey: "/source/main.vibe", VibeLangDoAsFunction: true}, source)
	emitted := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePath("/emitted/" + name), PathKey: tspath.PathKey("/emitted/" + name)}, generated, core.ScriptKindJS)
	var spans []statementSpan
	byKey := map[string][]statementSpan{}
	var originals []struct {
		span statementSpan
		node *ast.Node
	}
	byIdentity := map[string][]statementSpan{}
	var visit ast.Visitor
	visit = func(n *ast.Node) bool {
		if ast.IsStatement(n) && n.Pos() >= 0 && n.End() > n.Pos() && n.End() <= len(source) {
			start := scanner.GetTokenPosOfNode(n, original, false)
			if start < n.End() {
				span := statementSpan{start, n.End()}
				// Chapter 11, D307: a data declaration supplies both its type and
				// its constructor value. The parser's constructor companion may
				// carry only the keyword's span; its source statement is the full
				// written data form, including the name where emit anchors it.
				for _, form := range forms {
					if form.Kind == parser.VibeSyntaxDeclaration && form.Name == parser.VibeSyntaxData && start >= form.Head.Pos() && n.End() <= form.Head.End() {
						span = statementSpan{form.Range.Pos(), form.Range.End()}
						break
					}
				}
				spans = append(spans, span)
				originals = append(originals, struct {
					span statementSpan
					node *ast.Node
				}{span, n})
				if identity := statementIdentity(n); identity != "" {
					byIdentity[identity] = append(byIdentity[identity], span)
				}
				key := statementKey(source[start:n.End()])
				byKey[key] = append(byKey[key], span)
				// Chapter 13, D187: a do expression returns its last statement's
				// value. Its value statement has no written return keyword, but
				// may lower to the same return as another statement in the file.
				if ast.IsReturnStatement(n) && scanner.ScanTokenAtPosition(original, start) != ast.KindReturnKeyword {
					key = statementKey("return " + source[start:n.End()])
					byKey[key] = append(byKey[key], span)
				}
			}
		}
		n.ForEachChild(visit)
		return false
	}
	original.AsNode().ForEachChild(visit)
	for _, supplemental := range original.SupplementalSourceFiles() {
		supplemental.AsNode().ForEachChild(visit)
	}
	// Chapter 3 (D206) gives each match arm its expression's value. Like a
	// do value, an arm may become a return even though it writes no return.
	for _, form := range forms {
		if form.Kind != parser.VibeSyntaxMatch {
			continue
		}
		for _, arm := range form.Arms {
			if arm.Value.Pos() < 0 || arm.Value.End() > len(source) {
				continue
			}
			key := statementKey("return " + source[arm.Value.Pos():arm.Value.End()])
			// Chapter 28 does not require an arm's synthetic return to use
			// the value token rather than the arm/form anchor. Both identify
			// the corresponding VibeLang form, unlike another statement.
			byKey[key] = append(byKey[key], statementSpan{arm.Head.Pos(), arm.Value.End()}, statementSpan{form.Word.Pos(), form.Word.End()})
		}
	}
	mappings := map[int][]sourcemap.Mapping{}
	decoder := sourcemap.DecodeMappings(m.Mappings)
	for mapping := range decoder.Values() {
		mappings[mapping.GeneratedLine] = append(mappings[mapping.GeneratedLine], *mapping)
	}
	visit = func(n *ast.Node) bool {
		n.ForEachChild(visit)
		if !ast.IsStatement(n) || ast.IsBlock(n) || n.Pos() < 0 || n.End() > len(generated) {
			return false
		}
		start := scanner.GetTokenPosOfNode(n, emitted, false)
		line, column := scanner.GetECMALineAndUTF16CharacterOfPosition(emitted, start)
		lineStart := scanner.GetECMAPositionOfLineAndByteOffset(emitted, line, 0)
		if strings.TrimSpace(generated[lineStart:start]) != "" {
			return false
		}
		var selected *sourcemap.Mapping
		for _, mapping := range mappings[line] {
			if mapping.GeneratedCharacter > column {
				break
			}
			copy := mapping
			selected = &copy
		}
		candidates := byKey[statementKey(generated[start:n.End()])]
		preservedText := len(candidates) > 0
		if len(candidates) == 0 {
			if named := byIdentity[statementIdentity(n)]; len(named) == 1 {
				candidates = named
			}
		}
		// Imports may be intentionally unmapped, and type declarations emit no
		// executable statement. Top-level statements preserved by emit need a
		// location for breakpoints. Nested unmapped lookalikes may be synthetic
		// completion dispatch (for example break); no correspondence is assumed.
		retained := len(candidates) > 0 && !ast.IsImportDeclaration(n) && !ast.IsExportDeclaration(n) && n.Kind != ast.KindEmptyStatement
		if selected == nil || !selected.IsSourceMapping() {
			if retained && preservedText && n.Parent == emitted.AsNode() {
				oc.G.Add("feature:source-map-statement", "D34: %s statement at %d:%d has no original position: %q", name, line, column, excerpt(generated, start))
			}
			return false
		}
		if int(selected.SourceIndex) != sourceIndex {
			if retained {
				oc.G.Add("feature:source-map-statement", "D34: %s preserved statement at %d:%d maps to another source index %d", name, line, column, selected.SourceIndex)
			}
			return false
		}
		pos := scanner.GetECMAPositionOfLineAndUTF16Character(original, selected.SourceLine, selected.SourceCharacter)
		// Chapter 7's concurrent loop may run its body as a callback. A
		// continue in that body can therefore lower to a callback return;
		// the written continue, rather than an unrelated return, is its origin.
		if ast.IsReturnStatement(n) && scanner.ScanTokenAtPosition(original, pos) == ast.KindContinueKeyword {
			retained = false
		}
		inside := func(span statementSpan) bool { return pos >= span.start && pos < span.end }
		// Only a mismatch needs executable-shape comparison. Building keys
		// for every compound statement would repeatedly walk large bodies.
		erasedAt := func() bool {
			shape := statementShape(n)
			for _, original := range originals {
				if inside(original.span) && original.node.Kind == n.Kind && statementShape(original.node) == shape {
					return true
				}
			}
			return false
		}

		if retained {
			if !slices.ContainsFunc(candidates, inside) && !erasedAt() {
				oc.G.Add("feature:source-map-statement", "D34: %s unchanged statement at %d:%d maps to source byte %d outside its statement [%d,%d): %q", name, line, column, pos, candidates[0].start, candidates[0].end, excerpt(generated, start))
			}
		} else {
			found := false
			for _, span := range spans {
				if inside(span) {
					found = true
					break
				}
			}
			if !found {
				oc.G.Add("feature:source-map-statement", "D34: %s mapped statement at %d:%d points to source byte %d outside every original statement", name, line, column, pos)
			}
		}
		return false
	}
	emitted.AsNode().ForEachChild(visit)
}
