package vibelang

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/printer"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

func init() { sourceFileMigrations = append(sourceFileMigrations, schemaExactOptionalMigrationFixes) }

// Explicit compatibility upgrades keep the previous Schema.optional codec.
// Adding undefined preserves decoded values but publishes a different codec
// type (optional<Union<...>>). Write the original codec instead.
func schemaExactOptionalMigrationFixes(ctx context.Context, program *compiler.Program, file *ast.SourceFile, refused map[string]bool) proposal {
	result := proposal{file: file}
	if !program.Options().ExactOptionalPropertyTypes.IsTrue() {
		return result
	}
	var roots []*ast.Node
	seen := map[*ast.Node]bool{}
	for _, ref := range file.VibeLangSchemaOptionals {
		if ref.AllowsUndefined || ast.GetSourceFileOfNode(ref.Expression) != file {
			continue
		}
		var root *ast.Node
		errorFields := false
		for node := ref.Expression; node != nil; node = node.Parent {
			if isSchemaErrorFields(node) {
				errorFields = true
			}
			if ast.IsVariableDeclaration(node) && node.Initializer() != nil && (isSchemaAlias(node) || isSchemaStruct(node.Initializer())) {
				root = node
				break
			}
			if errorFields && ast.IsClassDeclaration(node) {
				root = node
				break
			}
		}
		if root != nil && !seen[root] {
			seen[root] = true
			roots = append(roots, root)
		}
	}
	if len(roots) == 0 {
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
	fix := &ls.CodeFixContext{SourceFile: file, Program: program, LS: service}
	for _, root := range roots {
		if root.Name() == nil {
			continue
		}
		statement := root
		if ast.IsVariableDeclaration(root) {
			statement = root.Parent.Parent
		}
		start, end := nodeStart(file, statement), statement.End()
		key := fmt.Sprintf("schema-exact-optional:%d:%d", start, end)
		if refused[key] {
			continue
		}
		alias, scope := schemaFlagNamespace(c, fix, root, start)
		var text string
		if ast.IsVariableDeclaration(root) {
			prefix := ""
			supported := true
			for _, m := range statement.ModifierNodes() {
				if m.Kind != ast.KindExportKeyword {
					supported = false
					break
				}
				prefix = "export "
			}
			if !supported {
				continue
			}
			value, substitutions := preserveSourceSchemaCodec(file, (&ast.NodeFactory{}).DeepCloneReparse(root.Initializer()), alias)
			expression := schemaFlagExpressionMode(c, file, value, alias, start, end, false)
			for name, replacement := range substitutions {
				expression = strings.ReplaceAll(expression, name, replacement)
			}
			name := root.Name().Text()
			text = prefix + "const " + name + " = " + expression + ";\n" + lineIndent(file.Text(), start) + prefix + "type " + name + " = typeof " + name + ".Type;"
		} else {
			// Print the lowered heritage and generated registration, retaining
			// user members verbatim so effect syntax and comments keep their
			// source meaning. Registration preserves the macro's matcher.
			clone := (&ast.NodeFactory{}).DeepCloneReparse(root)
			var generated []*ast.Node
			var members strings.Builder
			for _, member := range root.AsClassDeclaration().Members.Nodes {
				if member.Flags&ast.NodeFlagsReparsed != 0 {
					generated = append(generated, (&ast.NodeFactory{}).DeepCloneReparse(member))
				} else {
					members.WriteString(file.Text()[member.Pos():member.End()])
					members.WriteByte('\n')
				}
			}
			clone.AsClassDeclaration().Members = &ast.NodeList{Loc: root.AsClassDeclaration().Members.Loc, Nodes: generated}
			helpers := map[string]string{}
			supported := true
			var visit func(*ast.Node) bool
			visit = func(node *ast.Node) bool {
				if ast.IsIdentifier(node) && node.Flags&ast.NodeFlagsVibeLangIntrinsic != 0 && node.Text() != "Schema" {
					name := node.Text()
					switch name {
					case "$schemaErrorMatcher", "$schemaErrorFamily", "$schemaErrorMember":
						replacement := helpers[name]
						if replacement == "" {
							replacement = freshSchemaFlagName(file.Text(), "$optional"+strings.TrimPrefix(name, "$")+strconv.Itoa(start))
							helpers[name] = replacement
						}
						node.AsIdentifier().Text = replacement
						node.Flags &^= ast.NodeFlagsVibeLangIntrinsic
						node.Flags |= ast.NodeFlagsReparserTransformedLiteral
					default:
						supported = false
					}
				}
				return node.ForEachChild(visit)
			}
			visit(clone)
			if !supported {
				continue
			}
			ast.SetParentInChildren(clone)
			clone, substitutions := preserveSourceSchemaCodec(file, clone, alias)
			headerStart, header, ok := errorDeclarationClassPrefix(file.Text(), root)
			if !ok {
				continue
			}
			comments := optionalSchemaFieldComments(file, root)
			text = schemaFlagExpressionPrinter(c, file, clone, alias, start, end, false, func(node *ast.Node, emit *printer.EmitContext) {
				var visit func(*ast.Node) bool
				visit = func(node *ast.Node) bool {
					if isSchemaErrorFields(node) {
						for _, field := range node.AsObjectLiteralExpression().Properties.Nodes {
							if field.Name() == nil {
								continue
							}
							emit.SetCommentRange(field, core.UndefinedTextRange())
							emit.AddEmitFlags(field.Name(), printer.EFNoComments)
							for _, comment := range comments[nodeStart(file, field.Name())] {
								if strings.HasPrefix(comment.text, "*") && !comment.jsdoc {
									// An inline, unattached JSDoc must not become
									// a new published property documentation block.
									emit.AddSyntheticLeadingComment(field.Initializer(), comment.kind, comment.text, false)
								} else {
									emit.AddSyntheticLeadingComment(field, comment.kind, comment.text, true)
								}
							}
						}
						return false
					}
					emit.AddEmitFlags(node, printer.EFNoComments)
					return node.ForEachChild(visit)
				}
				visit(node)
			})
			heritage := strings.Index(text, " extends ")
			if heritage < 0 {
				continue
			}
			classKeyword := strings.Index(text[:heritage], "class ")
			if classKeyword < 0 {
				continue
			}
			text = file.Text()[start:headerStart] + header + text[classKeyword+len("class "):]
			for name, replacement := range substitutions {
				text = strings.ReplaceAll(text, name, replacement)
			}
			close := strings.LastIndex(text, "}")
			if close < 0 {
				continue
			}
			text = text[:close] + members.String() + text[close:]
			if len(helpers) > 0 {
				names := make([]string, 0, len(helpers))
				for name := range helpers {
					names = append(names, name)
				}
				sort.Strings(names)
				imports := make([]string, 0, len(names))
				for _, name := range names {
					imports = append(imports, name+" as "+helpers[name])
				}
				scope = append(scope, schemaFlagHeader(fix, "import { "+strings.Join(imports, ", ")+" } from \"vibelang-runtime\";\n")...)
			}
		}
		changes := append(replaceRange(fix, start, end, text), scope...)
		edits := make([]sourceEdit, 0, len(changes))
		for _, change := range changes {
			span := converters.FromLSPRangeToOriginal(file, change.Range)
			edits = append(edits, sourceEdit{span.Pos(), span.End(), change.NewText})
		}
		result = result.withFixes(proposal{file: file, fixes: []fileFix{{label: "optional schema compatibility", key: key, edits: edits}}})
	}
	return result
}

// The lowered payload's synthetic property range starts after its leading
// comments. Recover those comments from a native parse of the written fields,
// and attach them to the corresponding codec property exactly once.
type optionalSchemaFieldComment struct {
	kind  ast.Kind
	text  string
	jsdoc bool
}

func optionalSchemaFieldComments(file *ast.SourceFile, class *ast.Node) map[int][]optionalSchemaFieldComment {
	start, end := nodeStart(file, class), class.End()
	text := []byte(file.Text()[start:end])
	lex := scanner.NewScanner()
	lex.SetText(file.Text()[start:nodeStart(file, class.Name())])
	for lex.Scan() != ast.KindEndOfFile {
		switch lex.TokenText() {
		case "schema":
			for i := lex.TokenStart(); i < lex.TokenEnd(); i++ {
				text[i] = ' '
			}
		case "error":
			copy(text[lex.TokenStart():lex.TokenEnd()], "class")
		}
	}
	raw := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/optional-fields.ts", PathKey: "/optional-fields.ts"}, string(text), core.ScriptKindTS)
	comments := map[int][]optionalSchemaFieldComment{}
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if (ast.IsPropertyDeclaration(node) || ast.IsPropertySignatureDeclaration(node)) && node.Name() != nil {
			key := nodeStart(raw, node.Name())
			scan := scanner.NewScanner()
			scan.SetSkipTrivia(false)
			scan.SetText(raw.Text()[node.Pos():key])
			for kind := scan.Scan(); kind != ast.KindEndOfFile; kind = scan.Scan() {
				if kind == ast.KindSingleLineCommentTrivia || kind == ast.KindMultiLineCommentTrivia {
					comment := scan.TokenText()[2:]
					if kind == ast.KindMultiLineCommentTrivia {
						comment = strings.TrimSuffix(comment, "*/")
					}
					attached := false
					position := node.Pos() + scan.TokenStart()
					for _, doc := range node.JSDoc(raw) {
						if doc.Pos() <= position && position < doc.End() {
							attached = true
						}
					}
					comments[start+key] = append(comments[start+key], optionalSchemaFieldComment{kind: kind, text: comment, jsdoc: attached})
				}
			}
		}
		return node.ForEachChild(visit)
	}
	raw.AsNode().ForEachChild(visit)
	return comments
}
