package vibelang

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

const schemaGroupingLabel = "schema grouping"

func init() {
	sourceFileMigrations = append(sourceFileMigrations, groupedSchemaMigrationFixes)
	sourceCodecMigrations = append(sourceCodecMigrations, preserveGroupedSchemaCodec)
}

// A migration targets the old public codec layout, not only decoded values.
// Ordinary compilation always uses transparent grouping. Only the explicit
// migration mode expands source that used grouping into the old Effect calls.
func groupedSchemaMigrationFixes(ctx context.Context, program *compiler.Program, file *ast.SourceFile, refused map[string]bool) proposal {
	result := proposal{file: file}
	if !strings.Contains(file.Text(), "(") || !strings.Contains(file.Text(), "|") {
		return result
	}
	unions := groupedSchemaSourceUnions(file)
	if len(unions) == 0 {
		return result
	}
	c, done := program.GetTypeCheckerForFile(ctx, file)
	defer done()
	converters := lsconv.NewConverters(lsproto.PositionEncodingKindUTF16, func(name tspath.RootedFilePath) *lsconv.LSPLineMap {
		if f := program.GetSourceFile(name); f != nil {
			return lsconv.ComputeLSPLineStarts(f.Text())
		}
		return lsconv.ComputeLSPLineStarts("")
	})
	service := ls.NewLanguageService(nil, program, fixHost{program: program, converters: converters}, file.FileName().AsString())
	sourceEditFromTextEdit := func(file *ast.SourceFile, e *lsproto.TextEdit) sourceEdit {
		span := converters.FromLSPRangeToOriginal(file, e.Range)
		return sourceEdit{span.Pos(), span.End(), e.NewText}
	}
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		var value, class *ast.Node
		if ast.IsVariableDeclaration(node) && node.Initializer() != nil && (isSchemaAlias(node) || isSchemaStruct(node.Initializer())) {
			value = node.Initializer()
		} else if ast.IsClassDeclaration(node) {
			class = node
			var find func(*ast.Node) bool
			find = func(n *ast.Node) bool {
				if isSchemaErrorFields(n) {
					value = n
					return true
				}
				return n.ForEachChild(find)
			}
			for _, h := range node.AsClassDeclaration().HeritageClauses.Nodes {
				h.ForEachChild(find)
			}
		}
		if value == nil {
			return node.ForEachChild(visit)
		}
		start := nodeStart(file, node)
		if class == nil {
			start = nodeStart(file, node.Parent.Parent)
		}
		key := fmt.Sprintf("schema-grouping:%d:%s", start, file.Text()[start:node.End()])
		if refused[key] {
			return false
		}
		fix := &ls.CodeFixContext{SourceFile: file, Program: program, LS: service}
		alias, scope := schemaFlagNamespace(c, fix, node, start)
		clone := (&ast.NodeFactory{}).DeepCloneReparse(value)
		clone, substitutions := preserveGroupedSchemaCodec(file, clone, alias)
		if len(substitutions) == 0 {
			return node.ForEachChild(visit)
		}
		var edits []sourceEdit
		if class == nil {
			statement := node.Parent.Parent
			prefix := ""
			for _, m := range statement.ModifierNodes() {
				if m.Kind != ast.KindExportKeyword {
					return false
				}
				prefix = "export "
			}
			expression := schemaFlagExpressionMode(c, file, clone, alias, start, statement.End(), false)
			text := prefix + "const " + node.Name().Text() + " = " + expression + ";\n" + lineIndent(file.Text(), start) + prefix + "type " + node.Name().Text() + " = typeof " + node.Name().Text() + ".Type;"
			edits = []sourceEdit{{start, statement.End(), text}}
		} else {
			changes := schemaErrorFlagExpansion(c, fix, class, clone)
			for _, e := range changes {
				edits = append(edits, sourceEditFromTextEdit(file, e))
			}
		}
		// The LSP helpers use the same source coordinates. Convert their ranges
		// through the line map, then substitute names absent from the source.
		if class == nil {
			for _, e := range scope {
				edits = append(edits, sourceEditFromTextEdit(file, e))
			}
		}
		for i := range edits {
			for placeholder, text := range substitutions {
				edits[i].text = strings.ReplaceAll(edits[i].text, placeholder, text)
			}
		}
		if len(edits) > 0 {
			result = result.withFixes(proposal{file: file, fixes: []fileFix{{label: schemaGroupingLabel, edits: edits, key: key}}})
		}
		return false
	}
	file.AsNode().ForEachChild(visit)
	return result
}

func preserveGroupedSchemaCodec(file *ast.SourceFile, clone *ast.Node, alias string) (*ast.Node, map[string]string) {
	unions := groupedSchemaSourceUnions(file)
	substitutions := map[string]string{}
	var rewrite *ast.NodeVisitor
	rewrite = ast.NewNodeVisitor(func(n *ast.Node) *ast.Node {
		raw, ok := unions[n.Loc]
		if ok && ast.IsCallExpression(n) && ast.IsPropertyAccessExpression(n.Expression()) {
			callee := n.Expression()
			if ast.IsIdentifier(callee.Expression()) && callee.Expression().Text() == "Schema" && callee.Expression().Flags&ast.NodeFlagsVibeLangIntrinsic != 0 && (callee.Name().Text() == "Union" || callee.Name().Text() == "Literals") {
				text := legacyGroupedSchemaValue(raw.file, raw.node, alias)
				if text != "" {
					placeholder := freshSchemaFlagName(file.Text(), fmt.Sprintf("$groupedSchema%d$", len(substitutions)))
					substitutions[placeholder] = text
					replacement := rewrite.Factory.NewIdentifier(placeholder)
					replacement.Loc = n.Loc
					replacement.Flags |= ast.NodeFlagsReparsed | ast.NodeFlagsReparserTransformedLiteral
					return replacement
				}
			}
		}
		return rewrite.VisitEachChild(n)
	}, &ast.NodeFactory{}, ast.NodeVisitorHooks{})
	clone = rewrite.VisitNode(clone)
	ast.SetParentInChildren(clone)
	return clone, substitutions
}

type groupedSchemaSource struct {
	file *ast.SourceFile
	node *ast.Node
}

// Parse only the original declarations as TS types/classes. Their positions
// remain the source positions, including inside namespaces and error families.
func groupedSchemaSourceUnions(file *ast.SourceFile) map[core.TextRange]groupedSchemaSource {
	result := map[core.TextRange]groupedSchemaSource{}
	_, forms := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/grouping.vibe", PathKey: "/grouping.vibe"}, file.Text())
	for _, form := range forms {
		if form.Kind != parser.VibeSyntaxDeclaration || (form.Name != "schema" && form.Name != parser.VibeSyntaxSchemaAlias && form.Name != "schema error") {
			continue
		}
		start, end := form.Range.Pos(), form.Range.End()
		text := []byte(file.Text()[:end])
		for i := 0; i < start; i++ {
			if text[i] != '\n' && text[i] != '\r' {
				text[i] = ' '
			}
		}
		head := form.Head.Pos()
		if form.Name == parser.VibeSyntaxSchemaAlias {
			copy(text[head:head+6], "type  ")
		} else if form.Name == "schema" {
			copy(text[head:head+6], "class ")
		} else {
			copy(text[head:head+6], "      ")
			errorPos := scanner.SkipTrivia(file.Text(), head+6)
			copy(text[errorPos:errorPos+5], "class")
		}
		raw := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/grouping.vibe", PathKey: "/grouping.vibe"}, string(text), core.ScriptKindTS)
		var visit func(*ast.Node) bool
		visit = func(n *ast.Node) bool {
			if n.Kind == ast.KindUnionType {
				for _, member := range n.AsUnionTypeNode().Types.Nodes {
					if member.Kind == ast.KindParenthesizedType {
						result[n.Loc] = groupedSchemaSource{raw, n}
						break
					}
				}
			}
			return n.ForEachChild(visit)
		}
		raw.AsNode().ForEachChild(visit)
	}
	return result
}

// Only union construction differs. Let the current parser map every other
// schema form, hiding inner unions behind temporary names during that parse.
func legacyGroupedSchemaValue(file *ast.SourceFile, node *ast.Node, alias string) string {
	if node.Kind == ast.KindParenthesizedType {
		return legacyGroupedSchemaValue(file, node.AsParenthesizedTypeNode().Type, alias)
	}
	if node.Kind == ast.KindUnionType {
		members := node.AsUnionTypeNode().Types.Nodes
		literal := true
		for _, member := range members {
			literal = literal && member.Kind == ast.KindLiteralType && member.AsLiteralTypeNode().Literal.Kind != ast.KindNullKeyword
		}
		values := []string{}
		for _, member := range members {
			if literal {
				values = append(values, expressionText(file, member.AsLiteralTypeNode().Literal))
			} else {
				text := legacyGroupedSchemaValue(file, member, alias)
				if text == "" {
					return ""
				}
				values = append(values, text)
			}
		}
		method := "Union"
		if literal {
			method = "Literals"
		}
		return alias + "." + method + "([" + strings.Join(values, ", ") + "])"
	}
	start := nodeStart(file, node)
	edits := []sourceEdit{}
	substitutions := map[string]string{}
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if n.Kind == ast.KindUnionType {
			text := legacyGroupedSchemaValue(file, n, alias)
			if text == "" {
				return false
			}
			placeholder := freshSchemaFlagName(file.Text(), "$groupingValue"+strconv.Itoa(len(substitutions))+"$")
			substitutions[placeholder] = text
			edits = append(edits, sourceEdit{nodeStart(file, n) - start, n.End() - start, placeholder})
			return false
		}
		return n.ForEachChild(visit)
	}
	node.ForEachChild(visit)
	typ := applyEdits(file.Text()[start:node.End()], edits)
	source := "schema $Migration = " + preserveLegacySchemaType(typ)
	raw := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/grouping-value.vibe", PathKey: "/grouping-value.vibe"}, source, core.ScriptKindTS)
	if len(raw.Diagnostics()) > 0 {
		return ""
	}
	var expression *ast.Node
	for _, statement := range raw.Statements.Nodes {
		if ast.IsVariableStatement(statement) {
			expression = statement.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes[0].Initializer()
			break
		}
	}
	if expression == nil {
		return ""
	}
	text := schemaFlagExpressionMode(nil, raw, expression, alias, 0, len(source), false)
	for placeholder, value := range substitutions {
		text = strings.ReplaceAll(text, placeholder, value)
	}
	return text
}
