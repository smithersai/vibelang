package vibelang

import (
	"context"
	"regexp"
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/printer"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

func init() {
	ls.RegisterCodeFixProvider(schemaFlagExpansionFix)
	vipMigrationFixCodes = append(vipMigrationFixCodes, EK2109.Code)
}

// Expanding the complete codec retains old decoding and declaration types.
// Schema errors retain their macro, constructor contract, methods and matcher;
// lazy field-codec getters retain the macro's evaluation order and lexical scope.
var schemaFlagExpansionFix = &ls.CodeFixProvider{
	Source:     diagnosticSource,
	ErrorCodes: []int32{EK2109.Code},
	GetCodeActions: func(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		if fix.Diagnostic == nil || !(strings.HasPrefix(fix.Diagnostic.Message.AsString(), "A required tuple position") || strings.HasPrefix(fix.Diagnostic.Message.AsString(), "The value schema of this Record")) {
			return nil, nil
		}
		// A generated subclass heritage range can end before its field codecs.
		// Walk source references directly rather than pruning by parent ranges.
		var value *ast.Node
		var find func(*ast.Node) bool
		find = func(node *ast.Node) bool {
			if ast.IsEntityNameExpression(node) && node.Flags&ast.NodeFlagsReparsed == 0 &&
				nodeStart(fix.SourceFile, node) == fix.Span.Pos() && node.End() == fix.Span.End() {
				value = node
				return true
			}
			return node.ForEachChild(find)
		}
		fix.SourceFile.AsNode().ForEachChild(find)
		if value == nil {
			return nil, nil
		}
		c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
		defer done()
		var fields *ast.Node
		for node := value; node != nil; node = node.Parent {
			if isSchemaErrorFields(node) {
				fields = node
			}
			if ast.IsVariableDeclaration(node) && node.Initializer() != nil && (isSchemaAlias(node) || isSchemaStruct(node.Initializer())) {
				statement := node.Parent.Parent
				if !ast.IsVariableStatement(statement) {
					return nil, nil
				}
				prefix := ""
				for _, m := range statement.ModifierNodes() {
					if m.Kind != ast.KindExportKeyword {
						return nil, nil
					}
					prefix = "export "
				}
				start := nodeStart(fix.SourceFile, statement)
				alias, scopeEdits := schemaFlagNamespace(c, fix, node, start)
				expression := schemaFlagExpression(fix.SourceFile, node.Initializer(), alias, start, statement.End())
				indent := lineIndent(fix.SourceFile.Text(), start)
				name := node.Name().Text()
				text := prefix + "const " + name + " = " + expression + ";\n" + indent + prefix + "type " + name + " = typeof " + name + ".Type;"
				edits := replaceRange(fix, start, statement.End(), text)
				edits = append(edits, scopeEdits...)
				return []*ls.CodeAction{{Description: "Write the schema with explicit Effect codecs", Changes: edits}}, nil
			}
			if fields != nil && ast.IsClassDeclaration(node) {
				edits := schemaErrorFlagExpansion(c, fix, node, fields)
				if len(edits) == 0 {
					return nil, nil
				}
				return []*ls.CodeAction{{Description: "Write the schema with explicit Effect codecs", Changes: edits}}, nil
			}
		}
		return nil, nil
	},
}

var schemaFlagIdentifierEscapePattern = regexp.MustCompile(`\\u(?:\{[0-9a-fA-F]+\}|[0-9a-fA-F]{4})`)

func freshSchemaFlagName(text, base string) string {
	// Generated names use ASCII. Decode ASCII Unicode escapes throughout the
	// source so escaped bindings also reserve their names. Looking through
	// strings/comments is conservative and does not depend on template context.
	occupied := schemaFlagIdentifierEscapePattern.ReplaceAllStringFunc(text, func(escape string) string {
		digits := strings.TrimPrefix(escape, "\\u")
		digits = strings.TrimSuffix(strings.TrimPrefix(digits, "{"), "}")
		value, err := strconv.ParseUint(digits, 16, 32)
		if err != nil || value > 127 {
			return escape
		}
		return string(rune(value))
	})
	name := base
	for n := 2; strings.Contains(occupied, name); n++ {
		name = base + "_" + strconv.Itoa(n)
	}
	return name
}

func schemaFlagNamespace(c *checker.Checker, fix *ls.CodeFixContext, at *ast.Node, start int) (string, []*lsproto.TextEdit) {
	file := fix.SourceFile
	isSchema := func(name string, location *ast.Node) bool {
		symbol := c.ResolveName(name, location, ast.SymbolFlagsValue|ast.SymbolFlagsNamespace, false)
		if symbol != nil && symbol.Flags()&ast.SymbolFlagsAlias != 0 {
			symbol = c.GetAliasedSymbol(symbol)
		}
		if symbol != nil {
			for _, declaration := range symbol.Declarations() {
				if ast.IsSourceFile(declaration) && effectModuleOfFile(declaration.AsSourceFile()) == "Schema" {
					return true
				}
			}
		}
		return false
	}
	if isSchema("Schema", at) {
		return "Schema", nil
	}
	// Reuse the original import spelling so declaration emit retains its API.
	var imported string
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsIdentifier(node) && isSchema(node.Text(), at) {
			imported = node.Text()
			return true
		}
		return node.ForEachChild(visit)
	}
	for _, statement := range file.Statements.Nodes {
		if ast.IsImportDeclaration(statement) {
			statement.ForEachChild(visit)
			if imported != "" {
				return imported, nil
			}
		}
	}
	name := freshSchemaFlagName(file.Text(), "$Schema"+strconv.Itoa(start))
	if isSchema("Schema", file.AsNode()) {
		return name, schemaFlagHeader(fix, "const "+name+" = Schema;\n")
	}
	return name, schemaFlagImport(fix, name)
}

func schemaFlagImport(fix *ls.CodeFixContext, name string) []*lsproto.TextEdit {
	return schemaFlagHeader(fix, "import * as "+name+" from \"effect/Schema\";\n")
}

func schemaFlagHeader(fix *ls.CodeFixContext, statement string) []*lsproto.TextEdit {
	pos := 0
	text := fix.SourceFile.Text()
	if strings.HasPrefix(text, "\ufeff") {
		pos = 3
	}
	if strings.HasPrefix(text[pos:], "#!") {
		if i := strings.IndexByte(text[pos:], '\n'); i >= 0 {
			pos += i + 1
		}
	}
	// Directives must remain a contiguous prefix, before imports or bindings.
	// In particular, moving "use client" changes framework module semantics.
	for _, node := range fix.SourceFile.Statements.Nodes {
		if !ast.IsPrologueDirective(node) {
			break
		}
		pos = node.End()
	}
	if pos > 0 && text[pos-1] != '\n' && text[pos-1] != '\r' {
		statement = "\n" + statement
	}
	return replaceRange(fix, pos, pos, statement)
}

func schemaFlagExpression(file *ast.SourceFile, value *ast.Node, name string, start, end int) string {
	f := &ast.NodeFactory{}
	clone := f.DeepCloneReparse(value)
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if ast.IsIdentifier(n) && n.Flags&ast.NodeFlagsVibeLangIntrinsic != 0 && n.Text() == "Schema" {
			n.AsIdentifier().Text = name
			n.Flags &^= ast.NodeFlagsVibeLangIntrinsic
			n.Flags |= ast.NodeFlagsReparserTransformedLiteral
		}
		return n.ForEachChild(visit)
	}
	visit(clone)
	// Lowered synthetic containers may reach the following source trivia.
	// Keep comments inside this declaration, without copying its neighbours.
	text := []byte(file.Text())
	for i := range text {
		if (i < start || i >= end) && text[i] != '\n' && text[i] != '\r' {
			text[i] = ' '
		}
	}
	bounded := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/schema-flag-print.ts", PathKey: "/schema-flag-print.ts"}, string(text), core.ScriptKindTS)
	return printer.NewPrinter(printer.PrinterOptions{NewLine: core.NewLineKindLF}, printer.PrintHandlers{}, nil).Emit(clone, bounded)
}

func schemaErrorFlagExpansion(c *checker.Checker, fix *ls.CodeFixContext, class, fields *ast.Node) []*lsproto.TextEdit {
	file := fix.SourceFile
	start := nodeStart(file, class)
	original := file.Text()[start:class.End()]
	_, forms := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/schema-flag-fix.vibe", PathKey: "/schema-flag-fix.vibe"}, original)
	head := -1
	for _, form := range forms {
		if form.Kind == parser.VibeSyntaxDeclaration && form.Name == "schema error" && form.Range.End() == len(original) {
			head = form.Head.Pos()
			break
		}
	}
	if head < 0 {
		return nil
	}
	errorPos := scanner.SkipTrivia(original, head+len("schema"))
	if errorPos+5 > len(original) || original[errorPos:errorPos+5] != "error" {
		return nil
	}
	rawText := original[:head] + strings.Repeat(" ", 6) + original[head+6:errorPos] + "class" + original[errorPos+5:]
	raw := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/schema-flag-fix.vibe", PathKey: "/schema-flag-fix.vibe"}, rawText, core.ScriptKindTS)
	var rawClass *ast.Node
	for _, statement := range raw.Statements.Nodes {
		if ast.IsClassDeclaration(statement) {
			rawClass = statement
			break
		}
	}
	if rawClass == nil || len(raw.Diagnostics()) != 0 {
		return nil
	}
	alias, scopeEdits := schemaFlagNamespace(c, fix, class, start)
	var bindings, factories, values []string
	holder := freshSchemaFlagName(file.Text(), "$codecs"+strconv.Itoa(start))
	var edits []*lsproto.TextEdit
	for i, property := range fields.AsObjectLiteralExpression().Properties.Nodes {
		key := property.Name()
		if key == nil || key.Flags&ast.NodeFlagsReparsed != 0 {
			continue
		}
		var member *ast.Node
		for _, candidate := range rawClass.AsClassDeclaration().Members.Nodes {
			if ast.IsPropertyDeclaration(candidate) && candidate.Type() != nil && candidate.Name() != nil &&
				start+nodeStart(raw, candidate.Name()) == nodeStart(file, key) {
				member = candidate
				break
			}
		}
		if member == nil {
			return nil
		}
		value := property.Initializer()
		for ast.IsCallExpression(value) && value.Expression().Flags&ast.NodeFlagsReparsed != 0 && len(value.Arguments()) == 1 &&
			(isSchemaCall(c, value, "optional", 1) || isSchemaCall(c, value, "mutableKey", 1)) {
			value = value.Arguments()[0]
		}
		name := freshSchemaFlagName(file.Text(), "$codec"+strconv.Itoa(start)+"_"+strconv.Itoa(i))
		bindings = append(bindings, name)
		factory := freshSchemaFlagName(file.Text(), "$makeCodec"+strconv.Itoa(start)+"_"+strconv.Itoa(i))
		factories = append(factories, factory+" = (): infer _ => "+schemaFlagExpression(file, value, alias, start+nodeStart(raw, member.Type()), start+member.Type().End()))
		values = append(values, "get "+name+"() { return "+factory+"(); }")
		edits = append(edits, replaceRange(fix, start+nodeStart(raw, member.Type()), start+member.Type().End(), holder+"."+name)...)
	}
	if len(bindings) == 0 {
		return nil
	}
	indent := lineIndent(file.Text(), start)
	text := "\n" + indent + "const " + strings.Join(factories, ", ") + ";\n" + indent + "const " + holder + " = { " + strings.Join(values, ", ") + " };\n" + indent
	edits = append(edits, replaceRange(fix, class.Pos(), class.Pos(), text)...)
	edits = append(edits, scopeEdits...)
	return edits
}
