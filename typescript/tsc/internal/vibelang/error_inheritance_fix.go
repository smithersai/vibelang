package vibelang

import (
	"context"
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/ls/change"
	"github.com/microsoft/TypeScript/tsc/internal/printer"
)

func init() {
	tsFormFixCodes = append(tsFormFixCodes, EK2117.Code)
	vipMigrationFixCodes = append(vipMigrationFixCodes, EK2117.Code)
	provider := *errorMemberClassFix
	provider.ErrorCodes = []int32{EK2117.Code}
	// Other EK2117 sites (reserved tags) have their own repair; this provider
	// only expands the retired inheritance form.
	provider.GetCodeActions = func(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		var class *ast.Node
		var visit func(*ast.Node) bool
		visit = func(node *ast.Node) bool {
			if node.Pos() > fix.Span.Pos() || node.End() < fix.Span.End() {
				return false
			}
			if form, _ := errorFormOf(node); form == errorFormSubclass || form == errorFormSchemaSubclass {
				class = node
			}
			return node.ForEachChild(visit)
		}
		fix.SourceFile.AsNode().ForEachChild(visit)
		if class == nil {
			return nil, nil
		}
		return errorInheritanceClassActions(ctx, fix, class)
	}
	ls.RegisterCodeFixProvider(&provider)
}

// Print the existing lowering, including generated declarations/constructors and
// schema-family registration. Removing "extends" or replacing the base with
// TaggedError would silently change instanceof, constructors and public types.
func errorInheritanceClassActions(ctx context.Context, fix *ls.CodeFixContext, class *ast.Node) ([]*ls.CodeAction, error) {
	text := fix.SourceFile.Text()
	start, prefix, ok := errorDeclarationClassPrefix(text, class)
	if !ok {
		return nil, nil
	}
	c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
	defer done()
	c.GetDiagnostics(ctx, fix.SourceFile)
	// A narrow incompatible parent was already invalid under the old family
	// rules. Printing that lowering would expose TS2416 instead of repairing it.
	form, base := errorFormOf(class)
	statics := c.GetTypeAtLocation(base)
	schemaBase := statics != nil && c.GetPropertyOfType(c.GetApparentType(statics), schemaTypeID) != nil
	// A mismatched data/schema base was already invalid. Its expansion can
	// expose the missing .extend member or silently change schema behavior.
	if (form == errorFormSchemaSubclass) != schemaBase {
		return nil, nil
	}
	baseTag := errorBaseTag(c, statics)
	tag := errorDeclaredTag(c, class, form, nil)
	if baseTag == nil || tag == nil || !c.IsTypeAssignableTo(tag, baseTag) {
		return nil, nil
	}
	aliases := map[string]string{}
	// Keep an existing Schema import's spelling: changing its namespace
	// changes the bytes of inferred exported schema declarations.
	isSchema := func(name string) bool {
		symbol := c.ResolveName(name, class, ast.SymbolFlagsValue|ast.SymbolFlagsNamespace|ast.SymbolFlagsAlias, false)
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
	if isSchema("Schema") {
		aliases["Schema"] = "Schema"
	} else {
		var imported func(*ast.Node) bool
		imported = func(node *ast.Node) bool {
			if ast.IsIdentifier(node) && isSchema(node.Text()) {
				aliases["Schema"] = node.Text()
				return true
			}
			return node.ForEachChild(imported)
		}
		for _, statement := range fix.SourceFile.Statements.Nodes {
			if ast.IsImportDeclaration(statement) && statement.ForEachChild(imported) {
				break
			}
		}
	}
	var imports []string
	quote := "\""
	if sourceQuote(fix.SourceFile)&ast.TokenFlagsSingleQuote != 0 {
		quote = "'"
	}
	quotedModule := func(module string) string { return quote + module + quote }
	emit := printer.NewEmitContext()
	var visitor *ast.NodeVisitor
	visitor = emit.NewNodeVisitor(func(node *ast.Node) *ast.Node {
		if ast.IsIdentifier(node) && node.Flags&ast.NodeFlagsReparsed != 0 {
			module := ""
			switch node.Text() {
			case "$errorSubclass", "$ErrorArgs", "$schemaErrorMember", "$schemaErrorFamily":
				module = "vibelang-runtime"
			case "Schema":
				// A synthesized typeof Schema.Base or a class Self named
				// Schema is a source binding, not the decoder intrinsic.
				if node.Parent == nil || !ast.IsPropertyAccessExpression(node.Parent) || node.Parent.Expression() != node {
					return node
				}
				module = "effect/Schema"
			}
			if module != "" {
				alias, exists := aliases[node.Text()]
				if !exists {
					alias = node.Text()
					visible := c.ResolveName(alias, class, ast.SymbolFlagsAll, false)
					original := preludeSymbol(c, preludeStateOf(c), fix.SourceFile, alias)
					resolved := visible
					if resolved != nil && resolved.Flags()&ast.SymbolFlagsAlias != 0 {
						resolved = c.GetAliasedSymbol(resolved)
					}
					if original != nil && original.Flags()&ast.SymbolFlagsAlias != 0 {
						original = c.GetAliasedSymbol(original)
					}
					if resolved != nil && resolved == original {
						for _, declaration := range visible.Declarations() {
							if ast.IsImportSpecifier(declaration) {
								aliases[node.Text()] = alias
								return emit.Factory.NewIdentifier(alias)
							}
						}
					}
					if resolved != nil && resolved != original {
						alias = "$LegacyError" + strings.TrimPrefix(node.Text(), "$")
					}
					for i := 2; alias != node.Text() && c.ResolveName(alias, class, ast.SymbolFlagsAll, false) != nil; i++ {
						alias = "$LegacyError" + strings.TrimPrefix(node.Text(), "$") + strconv.Itoa(i)
					}
					aliases[node.Text()] = alias
					if node.Text() == "Schema" {
						specifier := "Schema"
						if alias != "Schema" {
							specifier += " as " + alias
						}
						imports = append(imports, "import { "+specifier+" } from "+quotedModule("effect")+"\n")
					} else {
						specifier := node.Text()
						if alias != node.Text() {
							specifier += " as " + alias
						}
						imports = append(imports, "import { "+specifier+" } from "+quotedModule(module)+"\n")
					}
				}
				return emit.Factory.NewIdentifier(alias)
			}
		}
		return visitor.VisitEachChild(node)
	})
	p := printer.NewPrinter(printer.PrinterOptions{NewLine: core.NewLineKindLF}, printer.PrintHandlers{}, emit)
	print := func(node *ast.Node) string { return strings.TrimSpace(p.Emit(visitor.VisitNode(node), fix.SourceFile)) }
	head := prefix + class.Name().Text()
	if params := class.ClassLikeData().TypeParameters; params != nil {
		var parts []string
		for _, param := range params.Nodes {
			parts = append(parts, print(param))
		}
		head += "<" + strings.Join(parts, ", ") + ">"
	}
	var heritage []string
	for _, clause := range class.ClassLikeData().HeritageClauses.Nodes {
		heritage = append(heritage, print(clause))
	}
	var members []string
	fieldless := fieldlessGeneratedErrorBase(c, base)
	for _, member := range class.Members() {
		if fieldless && ast.IsConstructorDeclaration(member) && member.Flags&ast.NodeFlagsReparsed != 0 {
			member = lowerFieldlessErrorConstructor(emit.Factory, member)
		}
		if member.Flags&ast.NodeFlagsReparsed != 0 || ast.IsPropertyDeclaration(member) && member.Flags&ast.NodeFlagsAmbient != 0 {
			members = append(members, print(member))
		} else {
			members = append(members, text[member.Pos():member.End()])
		}
	}
	replacement := head + " " + strings.Join(heritage, " ") + " {\n" + strings.Join(members, "\n") + "\n}"
	added := strings.Join(imports, "")
	at := change.GetInsertionPositionAtSourceFileTop(fix.SourceFile)
	if at == 0 && strings.HasPrefix(text, "\ufeff") {
		at = len("\ufeff")
	}
	if at > 0 {
		added = "\n" + added
	}
	changes := replaceRange(fix, start, class.End(), replacement)
	if at == start {
		changes = replaceRange(fix, start, class.End(), added+replacement)
	} else if added != "" {
		changes = append(changes, replaceRange(fix, at, at, added)...)
	}
	return []*ls.CodeAction{{Description: "Write " + class.Name().Text() + " as its equivalent TypeScript class", Changes: changes}}, nil
}
