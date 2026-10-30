package vibelang

import (
	"context"
	"strconv"
	"strings"
	"unicode"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/ls/change"
	"github.com/microsoft/TypeScript/tsc/internal/printer"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

func init() {
	tsFormFixCodes = append(tsFormFixCodes, EK1302.Code)
	vipMigrationFixCodes = append(vipMigrationFixCodes, EK1302.Code)
	ls.RegisterCodeFixProvider(errorMemberClassFix)
}

// Retain user-written members, including nested VibeLang syntax, as source.
var errorMemberClassFix = &ls.CodeFixProvider{
	Source:     diagnosticSource,
	ErrorCodes: []int32{1302},
	GetCodeActions: func(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		var class *ast.Node
		var visit func(*ast.Node) bool
		visit = func(node *ast.Node) bool {
			if node.Pos() > fix.Span.Pos() || node.End() < fix.Span.End() {
				return false
			}
			if errorDeclarationBase(node) {
				class = node
			}
			return node.ForEachChild(visit)
		}
		fix.SourceFile.AsNode().ForEachChild(visit)
		if class == nil {
			return nil, nil
		}
		text := fix.SourceFile.Text()
		name := class.Name()
		start, declarationPrefix, ok := errorDeclarationClassPrefix(text, class)
		if !ok {
			return nil, nil
		}

		baseNode := ast.GetClassExtendsHeritageElement(class)
		module := "Data"
		if !isSynthesizedName(baseNode.Expression().Expression(), "TaggedError") {
			module = "Schema"
		}
		qualifier, addedImport := module, ""
		c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
		defer done()
		c.GetDiagnostics(ctx, fix.SourceFile)
		visible := c.ResolveName(module, class, ast.SymbolFlagsValue|ast.SymbolFlagsNamespace|ast.SymbolFlagsAlias, false)
		if visible == nil || visible != preludeSymbol(c, preludeStateOf(c), fix.SourceFile, module) {
			qualifier = "$Error" + module
			for i := 2; c.ResolveName(qualifier, class, ast.SymbolFlagsAll, false) != nil; i++ {
				qualifier = "$Error" + module + strconv.Itoa(i)
			}
			addedImport = "import * as " + qualifier + " from \"effect/" + module + "\"\n"
		}
		emit := printer.NewEmitContext()
		if module == "Schema" && qualifier != module {
			var visitor *ast.NodeVisitor
			visitor = emit.NewNodeVisitor(func(node *ast.Node) *ast.Node {
				if isSynthesizedName(node, "Schema") && node.Parent != nil && ast.IsPropertyAccessExpression(node.Parent) && node.Parent.Expression() == node {
					return emit.Factory.NewIdentifier(qualifier)
				}
				return visitor.VisitEachChild(node)
			})
			baseNode = visitor.VisitNode(baseNode)
		}
		p := printer.NewPrinter(printer.PrinterOptions{NewLine: core.NewLineKindLF}, printer.PrintHandlers{}, emit)
		head := declarationPrefix + name.Text()
		if params := class.ClassLikeData().TypeParameters; params != nil {
			var parts []string
			for _, param := range params.Nodes {
				parts = append(parts, p.Emit(param, fix.SourceFile))
			}
			head += "<" + strings.Join(parts, ", ") + ">"
		}
		base := p.Emit(baseNode, fix.SourceFile)
		if module == "Data" {
			base = strings.Replace(base, "TaggedError(", qualifier+".TaggedError(", 1)
		}
		if clauses := class.ClassLikeData().HeritageClauses; clauses != nil {
			for _, clause := range clauses.Nodes {
				if clause.AsHeritageClause().Token == ast.KindImplementsKeyword {
					base += " " + p.Emit(clause, fix.SourceFile)
				}
			}
		}
		var members []string
		for _, member := range class.Members() {
			if member.Flags&ast.NodeFlagsReparsed == 0 {
				members = append(members, text[member.Pos():member.End()])
			}
		}
		replacement := head + " extends " + base + " {" + strings.Join(members, "\n") + "\n}"
		changes := replaceRange(fix, start, class.End(), replacement)
		if addedImport != "" {
			at := change.GetInsertionPositionAtSourceFileTop(fix.SourceFile)
			if at == 0 && strings.HasPrefix(text, "\ufeff") {
				at = len("\ufeff")
			}
			if at > 0 {
				addedImport = "\n" + addedImport
			}
			if at == start {
				changes = replaceRange(fix, start, class.End(), addedImport+replacement)
			} else {
				changes = append(changes, replaceRange(fix, at, at, addedImport)...)
			}
		}
		return []*ls.CodeAction{{Description: "Write " + name.Text() + " as its Effect TypeScript class", Changes: changes}}, nil
	},
}

// Keep comments between contextual keywords and the name. Scan the header so
// every ECMAScript whitespace spelling works, including non-ASCII spaces.
func errorDeclarationClassPrefix(text string, class *ast.Node) (int, string, bool) {
	nameStart := scanner.SkipTrivia(text, class.Name().Pos())
	if class.Pos() < 0 || nameStart <= class.Pos() || nameStart > len(text) {
		return 0, "", false
	}
	lex := scanner.NewScanner()
	lex.SetText(text[class.Pos():nameStart])
	previous := ""
	previousStart, previousEnd := 0, 0
	errorStart, errorEnd := -1, -1
	schemaStart, schemaEnd := -1, -1
	for lex.Scan() != ast.KindEndOfFile {
		if lex.TokenText() == "error" {
			errorStart = class.Pos() + lex.TokenStart()
			errorEnd = class.Pos() + lex.TokenEnd()
			schemaStart, schemaEnd = -1, -1
			if previous == "schema" {
				schemaStart, schemaEnd = previousStart, previousEnd
			}
		}
		previous = lex.TokenText()
		previousStart = class.Pos() + lex.TokenStart()
		previousEnd = class.Pos() + lex.TokenEnd()
	}
	if errorStart < 0 || errorEnd > nameStart {
		return 0, "", false
	}
	start := errorStart
	trivia := text[errorEnd:nameStart]
	base := ast.GetClassExtendsHeritageElement(class)
	if !isSynthesizedName(base.Expression().Expression(), "TaggedError") {
		if schemaStart < 0 || schemaEnd > errorStart {
			return 0, "", false
		}
		start = schemaStart
		trivia = text[schemaEnd:errorStart] + trivia
	}
	return start, "class " + strings.TrimLeftFunc(trivia, unicode.IsSpace), true
}
