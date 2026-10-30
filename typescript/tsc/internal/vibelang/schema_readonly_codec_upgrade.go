package vibelang

import (
	"context"
	"fmt"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// A legacy reference may already carry mutable or uncertain key flags.
// In that case a readonly source modifier is not an admitted schema form.
// Keep the old codec itself, including field-codec identity, as SDK code.
func schemaReadonlyCodecUpgrade(ctx context.Context, program *compiler.Program, file *ast.SourceFile, headStart, headEnd int, defaults map[int]bool) ([]sourceEdit, bool) {
	var declaration, value *ast.Node
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		name := n.Name()
		if name != nil && name.Pos() >= headStart && name.End() <= headEnd {
			if ast.IsVariableDeclaration(n) && n.Initializer() != nil && (isSchemaAlias(n) || isSchemaStruct(n.Initializer())) {
				declaration, value = n, n.Initializer()
				return true
			}
			if ast.IsClassDeclaration(n) {
				var fields *ast.Node
				var find func(*ast.Node) bool
				find = func(child *ast.Node) bool {
					if isSchemaErrorFields(child) {
						fields = child
						return true
					}
					return child.ForEachChild(find)
				}
				for _, h := range n.AsClassDeclaration().HeritageClauses.Nodes {
					h.ForEachChild(find)
				}
				if fields != nil {
					declaration, value = n, fields
					return true
				}
			}
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	if value == nil {
		return nil, false
	}
	c, done := program.GetTypeCheckerForFile(ctx, file)
	defer done()
	isAddedMutable := func(n *ast.Node) bool {
		if !ast.IsCallExpression(n) || len(n.Arguments()) != 1 || !defaults[nodeStart(file, n)] {
			return false
		}
		callee := n.Expression()
		return ast.IsPropertyAccessExpression(callee) && callee.Name().Text() == "mutableKey" && ast.IsIdentifier(callee.Expression()) && callee.Expression().Flags&ast.NodeFlagsVibeLangIntrinsic != 0
	}
	bad := false
	var check func(*ast.Node) bool
	check = func(n *ast.Node) bool {
		if isAddedMutable(n) {
			t := c.GetTypeAtLocation(n.Arguments()[0])
			if !isSchemaValue(c, t) {
				return n.ForEachChild(check)
			}
			flags := c.GetTypeOfPropertyOfType(t, "~type.mutability")
			if flags == nil || !flags.IsStringLiteral() || flags.AsLiteralType().Value() != "readonly" {
				bad = true
				return true
			}
		}
		return n.ForEachChild(check)
	}
	check(value)
	if !bad {
		return nil, false
	}
	clone := (&ast.NodeFactory{}).DeepCloneReparse(value)
	var rewrite *ast.NodeVisitor
	rewrite = ast.NewNodeVisitor(func(n *ast.Node) *ast.Node {
		if isAddedMutable(n) {
			return rewrite.VisitNode(n.Arguments()[0])
		}
		return rewrite.VisitEachChild(n)
	}, &ast.NodeFactory{}, ast.NodeVisitorHooks{})
	clone = rewrite.VisitNode(clone)
	ast.SetParentInChildren(clone)
	converters := lsconv.NewConverters(lsproto.PositionEncodingKindUTF16, func(name tspath.RootedFilePath) *lsconv.LSPLineMap {
		if f := program.GetSourceFile(name); f != nil {
			return lsconv.ComputeLSPLineStarts(f.Text())
		}
		return lsconv.ComputeLSPLineStarts("")
	})
	service := ls.NewLanguageService(nil, program, fixHost{program: program, converters: converters}, file.FileName().AsString())
	fix := &ls.CodeFixContext{SourceFile: file, Program: program, LS: service}
	start := nodeStart(file, declaration)
	if ast.IsVariableDeclaration(declaration) {
		start = nodeStart(file, declaration.Parent.Parent)
	}
	alias, scope := schemaFlagNamespace(c, fix, declaration, start)
	clone, substitutions := preserveSourceSchemaCodec(file, clone, alias)
	var changes []*lsproto.TextEdit
	if ast.IsClassDeclaration(declaration) {
		changes = schemaErrorFlagExpansion(c, fix, declaration, clone)
	} else {
		statement := declaration.Parent.Parent
		prefix := ""
		for _, m := range statement.ModifierNodes() {
			if m.Kind != ast.KindExportKeyword {
				return nil, true
			}
			prefix = "export "
		}
		expression := schemaFlagExpression(c, file, clone, alias, start, statement.End())
		name := declaration.Name().Text()
		text := fmt.Sprintf("%sconst %s = %s;\n%s%stype %s = typeof %s.Type;", prefix, name, expression, lineIndent(file.Text(), start), prefix, name, name)
		changes = append(replaceRange(fix, start, statement.End(), text), scope...)
	}
	edits := []sourceEdit{}
	for _, change := range changes {
		span := converters.FromLSPRangeToOriginal(file, change.Range)
		text := change.NewText
		for name, value := range substitutions {
			text = strings.ReplaceAll(text, name, value)
		}
		edits = append(edits, sourceEdit{span.Pos(), span.End(), text})
	}
	return edits, true
}
