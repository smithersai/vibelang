package vibelang

import (
	"context"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// The current spelling of services, controls, and layers (D223, D221).
//
//	service Users { find(id: string): User!NotFound }
//	control Approval { approve(request: string): boolean!! }
//	const UsersLive = Layer.effect(Users, effect { const seen = new Set<string>(); return { find(id) { ... } } })
//
// Retired service class and layer declarations report errors naming --fix.
// Control class retains its existing warning. Legacy lowering remains available
// so --fix can preserve declaration APIs and execution before removing syntax.

var (
	EK0909 = message(909, errorCategory, "service class declarations are retired: run vibelang --fix to write service without class.")
	// EK2120: the existing control class warning. {0} is the word.
	EK2120 = message(2120, warningCategory, "{0} class is the older spelling: write {0} without class.")
	// EK2121: a retired layer declaration. Its repair retains setup timing.
	EK2121 = message(2121, errorCategory, "layer declarations are retired: run vibelang --fix to write Layer.effect(Service, effect { ... }) or Layer.succeed(Service, { ... }).")
)

func init() {
	registry[EK0909.Code] = EK0909
	tsFormFixCodes = append(tsFormFixCodes, EK0909.Code)
	vipMigrationFixCodes = append(vipMigrationFixCodes, EK0909.Code)
	registry[EK2120.Code] = EK2120
	registry[EK2121.Code] = EK2121
	vipMigrationFixCodes = append(vipMigrationFixCodes, EK2121.Code)
	fileChecks = append(fileChecks, checkDeclarationSpelling)
	ls.RegisterCodeFixProvider(serviceClassFix)
	ls.RegisterCodeFixProvider(layerDeclarationFix)
}

// declarationWordRange returns the range of the word service or control that
// declared class, from the abstract modifier the parser anchored on it, and
// false when class was not declared with that word.
func declarationWordRange(class *ast.Node) (core.TextRange, bool) {
	for _, modifier := range class.ModifierNodes() {
		if modifier.Kind == ast.KindAbstractKeyword && modifier.Flags&ast.NodeFlagsReparsed != 0 {
			return modifier.Loc, true
		}
	}
	return core.TextRange{}, false
}

// layerDeclarationCall returns the Layer.effect or Layer.succeed call the
// parser wrote for statement when statement is a layer declaration, and nil
// otherwise. The parser anchors the synthesized Layer on the word layer.
func layerDeclarationCall(statement *ast.Node) *ast.Node {
	if !ast.IsVariableStatement(statement) {
		return nil
	}
	declarations := statement.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes
	if len(declarations) != 1 || declarations[0].Initializer() == nil || !ast.IsCallExpression(declarations[0].Initializer()) {
		return nil
	}
	call := declarations[0].Initializer()
	callee := call.Expression()
	if callee.Flags&ast.NodeFlagsReparsed == 0 || !ast.IsPropertyAccessExpression(callee) {
		return nil
	}
	if name := callee.Name().Text(); name != "effect" && name != "succeed" {
		return nil
	}
	if layer := callee.Expression(); !ast.IsIdentifier(layer) || layer.Text() != "Layer" {
		return nil
	}
	return call
}

// classKeywordAfter returns the end of the class keyword that follows the
// word service or control ending at end, and false when no class follows.
func classKeywordAfter(text string, end int) (int, bool) {
	after := scanner.SkipTrivia(text, end)
	if !strings.HasPrefix(text[after:], "class") {
		return 0, false
	}
	stop := after + len("class")
	if stop < len(text) {
		if ch := text[stop]; ch == '_' || ch == '$' || ch >= '0' && ch <= '9' || ch >= 'a' && ch <= 'z' || ch >= 'A' && ch <= 'Z' || ch >= 0x80 {
			return 0, false
		}
	}
	return stop, true
}

// checkDeclarationSpelling reports EK2120 over service class or control class,
// and EK2121 at a layer declaration.
func checkDeclarationSpelling(c *checker.Checker, file *ast.SourceFile) {
	text := file.Text()
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		if ast.IsClassDeclaration(n) {
			if word, ok := declarationWordRange(n); ok {
				if stop, ok := classKeywordAfter(text, word.End()); ok {
					if text[word.Pos():word.End()] == "service" {
						reportAt(c, file, core.NewTextRange(word.Pos(), stop), EK0909)
					} else {
						reportAt(c, file, core.NewTextRange(word.Pos(), stop), EK2120, "control")
					}
				}
			}
		}
		if call := layerDeclarationCall(n); call != nil {
			d := reportAt(c, file, call.Expression().Expression().Loc, EK2121)
			note(d, "The automatic rewrite requires Layer to be Effect's value namespace; a shadowed or type-only binding needs an explicit library constructor.")
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// serviceClassFix is EK2120's quick fix: it replaces service class or control
// class, which the diagnostic spans, with the word alone.
var serviceClassFix = &ls.CodeFixProvider{
	Source:     diagnosticSource,
	ErrorCodes: []int32{EK2120.Code, EK0909.Code},
	GetCodeActions: func(_ context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		text := fix.SourceFile.Text()
		if fix.Diagnostic == nil || fix.Span.End() > len(text) {
			return nil, nil
		}
		span := text[fix.Span.Pos():fix.Span.End()]
		lex := scanner.NewScanner()
		lex.SetText(span)
		lex.Scan()
		word := lex.TokenText()
		if word != "service" && word != "control" {
			return nil, nil
		}
		if lex.Scan() != ast.KindClassKeyword {
			return nil, nil
		}
		classStart := lex.TokenStart()
		if lex.Scan() != ast.KindEndOfFile {
			return nil, nil
		}
		// The diagnostic covers both keywords. Retain the trivia between
		// them, including comments, and remove only the class token.
		replacement := strings.TrimSpace(span[:classStart])
		return []*ls.CodeAction{{
			Description: "Write " + word + " without class",
			Changes:     []*lsproto.TextEdit{{Range: fix.Diagnostic.Range, NewText: replacement}},
		}}, nil
	},
}

// layerDeclarationFix is EK2121's quick fix: it rewrites the layer declaration
// whose word layer the diagnostic marks into the call it abbreviates.
var layerDeclarationFix = &ls.CodeFixProvider{
	Source:     diagnosticSource,
	ErrorCodes: []int32{EK2121.Code},
	GetCodeActions: func(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		file := fix.SourceFile
		var statement *ast.Node
		var find func(n *ast.Node) bool
		find = func(n *ast.Node) bool {
			if call := layerDeclarationCall(n); call != nil && call.Expression().Expression().Pos() == fix.Span.Pos() {
				statement = n
				return true
			}
			return n.ForEachChild(find)
		}
		file.AsNode().ForEachChild(find)
		if statement == nil {
			return nil, nil
		}
		// The parser's Layer is intrinsic. Source text must resolve to the
		// same namespace, or the rewrite would capture a user's local Layer.
		c, done := fix.Program.GetTypeCheckerForFile(ctx, file)
		defer done()
		c.GetDiagnostics(ctx, file)
		visible := c.ResolveName("Layer", statement, ast.SymbolFlagsValue|ast.SymbolFlagsNamespace|ast.SymbolFlagsAlias, false)
		expected := preludeSymbol(c, preludeStateOf(c), file, "Layer")
		if visible == nil || expected == nil || c.GetTypeOnlyAliasDeclaration(visible) != nil {
			return nil, nil
		}
		if visible.Flags()&ast.SymbolFlagsAlias != 0 {
			visible = c.GetAliasedSymbol(visible)
		}
		if expected.Flags()&ast.SymbolFlagsAlias != 0 {
			expected = c.GetAliasedSymbol(expected)
		}
		if visible != expected {
			return nil, nil
		}
		replacement, ok := layerDeclarationText(file, statement)
		if !ok {
			return nil, nil
		}
		start := scanner.SkipTrivia(file.Text(), statement.Pos())
		return []*ls.CodeAction{{
			Description: "Rewrite the layer declaration as a Layer call",
			Changes: []*lsproto.TextEdit{{
				Range:   lsproto.Range{Start: lspPosition(file, start), End: lspPosition(file, statement.End())},
				NewText: replacement,
			}},
		}}, nil
	},
}

// lspPosition converts an offset in file to an LSP position.
func lspPosition(file *ast.SourceFile, pos int) lsproto.Position {
	line, character := scanner.GetECMALineAndUTF16CharacterOfPosition(file, pos)
	return lsproto.Position{Line: uint32(line), Character: uint32(character)}
}

// layerDeclarationText writes statement, a layer declaration, as the call it
// abbreviates:
//
//	export const UsersLive = Layer.effect(Users, effect {
//	  const seen = new Set<string>()
//	  return {
//	    find(id) { ... },
//	    region: "eu"
//	  }
//	})
//
// or, without setup statements, export const DirectoryLive = Layer.succeed(Directory, { ... }).
func layerDeclarationText(file *ast.SourceFile, statement *ast.Node) (string, bool) {
	text := file.Text()
	call := layerDeclarationCall(statement)
	args := call.Arguments()
	if len(args) != 2 {
		return "", false
	}
	start := scanner.SkipTrivia(text, statement.Pos())
	word := call.Expression().Expression().Loc
	prefix := text[start:word.Pos()] // modifiers such as export, with their spacing
	indent := lineIndent(text, start)
	declaration := statement.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes[0]
	name := sourceText(file, declaration.Name())
	service := sourceText(file, args[0])

	var statements []*ast.Node
	object := args[1]
	if ast.IsArrowFunction(args[1]) {
		body := args[1].Body().AsBlock().Statements.Nodes
		if len(body) == 0 || !ast.IsReturnStatement(body[len(body)-1]) || body[len(body)-1].Expression() == nil {
			return "", false
		}
		statements = body[:len(body)-1]
		object = body[len(body)-1].Expression()
	}
	if !ast.IsObjectLiteralExpression(object) {
		return "", false
	}
	var members []string
	for _, member := range object.AsObjectLiteralExpression().Properties.Nodes {
		switch {
		case ast.IsPropertyAssignment(member):
			members = append(members, sourceText(file, member.Name())+": "+sourceText(file, member.Initializer()))
		default:
			members = append(members, sourceText(file, member))
		}
	}

	var b strings.Builder
	b.WriteString(prefix)
	b.WriteString("const " + name + " = ")
	if len(statements) == 0 {
		b.WriteString("Layer.succeed(" + service + ", {\n")
		writeMembers(&b, members, indent+"  ", "")
		b.WriteString(indent + "})")
		return b.String(), true
	}
	b.WriteString("Layer.effect(" + service + ", effect {\n")
	for _, s := range statements {
		b.WriteString(indent + "  " + sourceText(file, s) + "\n")
	}
	b.WriteString(indent + "  return {\n")
	writeMembers(&b, members, indent+"    ", "  ")
	b.WriteString(indent + "  }\n")
	b.WriteString(indent + "})")
	return b.String(), true
}

// writeMembers writes members, one per line at indent and separated by
// commas, adding extra to the indentation of their continuation lines.
func writeMembers(b *strings.Builder, members []string, indent string, extra string) {
	for i, member := range members {
		member = strings.ReplaceAll(member, "\n", "\n"+extra)
		b.WriteString(indent + member)
		if i < len(members)-1 {
			b.WriteString(",")
		}
		b.WriteString("\n")
	}
}

// sourceText returns node's text in file, without leading trivia.
func sourceText(file *ast.SourceFile, node *ast.Node) string {
	return scanner.GetSourceTextOfNodeFromSourceFile(file, node, false /*includeTrivia*/)
}

// lineIndent returns the whitespace that starts the line holding pos.
func lineIndent(text string, pos int) string {
	lineStart := strings.LastIndexByte(text[:pos], '\n') + 1
	end := lineStart
	for end < len(text) && (text[end] == ' ' || text[end] == '\t') {
		end++
	}
	return text[lineStart:end]
}
