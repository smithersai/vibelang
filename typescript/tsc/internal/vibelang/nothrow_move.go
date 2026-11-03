package vibelang

import (
	"context"
	"encoding/json"
	"slices"
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// moveNothrowDeclaration preserves a closed, ordinary TypeScript declaration. It never moves captured cells,
// eager initialization or VibeLang syntax. Those cases keep the diagnostic's manual .ts-file guidance.
func moveNothrowDeclaration(ctx context.Context, fix *ls.CodeFixContext, c *checker.Checker, site *ast.Node) *ls.CodeAction {
	if !ls.ClientSupportsDocumentChanges(ctx) || !slices.Contains(lsproto.GetClientCapabilities(ctx).Workspace.WorkspaceEdit.ResourceOperations, lsproto.ResourceOperationKindCreate) {
		return nil
	}
	file := fix.SourceFile
	declaration := site
	for declaration.Parent != nil && declaration.Parent != file.AsNode() {
		declaration = declaration.Parent
	}
	if declaration.Parent != file.AsNode() {
		return nil
	}
	var variable *ast.Node
	if ast.IsVariableStatement(declaration) {
		list := declaration.AsVariableStatement().DeclarationList
		declarations := list.AsVariableDeclarationList().Declarations.Nodes
		if list.Flags&ast.NodeFlagsConst == 0 || len(declarations) != 1 {
			return nil
		}
		variable = declarations[0]
		if variable.Initializer() == nil || !ast.IsFunctionExpressionOrArrowFunction(ast.SkipParentheses(variable.Initializer())) {
			return nil
		}
	} else if !ast.IsFunctionDeclaration(declaration) && !ast.IsClassDeclaration(declaration) {
		return nil
	}
	nameNode := nothrowDeclarationName(declaration)
	if nameNode == nil || !ast.IsIdentifier(nameNode) {
		return nil
	}
	if ast.IsClassDeclaration(declaration) {
		if len(ast.GetExtendsHeritageClauseElements(declaration)) > 0 {
			return nil
		}
		for _, member := range declaration.Members() {
			if member.Kind == ast.KindClassStaticBlockDeclaration || ast.IsPropertyDeclaration(member) && ast.HasSyntacticModifier(member, ast.ModifierFlagsStatic) && member.Initializer() != nil || member.Name() != nil && ast.IsComputedPropertyName(member.Name()) {
				return nil
			}
		}
		// A class has a TDZ, unlike an imported binding. Keep it at the first executable declaration.
		for _, statement := range file.Statements.Nodes {
			if statement == declaration {
				break
			}
			if !ast.IsImportDeclaration(statement) && !ast.IsInterfaceDeclaration(statement) && !ast.IsTypeAliasDeclaration(statement) {
				return nil
			}
		}
	}
	text := nodeText(file, declaration)
	if ast.HasSyntacticModifier(declaration, ast.ModifierFlagsDefault) {
		for _, modifier := range declaration.Modifiers().Nodes {
			if modifier.Kind == ast.KindDefaultKeyword {
				start := nodeStart(file, modifier) - nodeStart(file, declaration)
				end := modifier.End() - nodeStart(file, declaration)
				if end < len(text) && text[end] == ' ' {
					end++
				}
				text = text[:start] + text[end:]
				break
			}
		}
	}
	if !ast.HasSyntacticModifier(declaration, ast.ModifierFlagsExport) {
		text = "export " + text
	}
	parsed := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/nothrow.ts", PathKey: "/nothrow.ts"}, text, core.ScriptKindTS)
	if len(parsed.Diagnostics()) != 0 {
		return nil
	}
	imports := map[*ast.Node]map[*ast.Node]bool{}
	safe := true
	inside := func(n *ast.Node) bool {
		for ; n != nil; n = n.Parent {
			if n == declaration {
				return true
			}
		}
		return false
	}
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if !safe {
			return true
		}
		if n.Kind == ast.KindDecorator {
			safe = false
			return true
		}
		if n.Kind == ast.KindMetaProperty {
			safe = false
			return true
		}
		if ast.IsIdentifier(n) && n.Parent != nil {
			p := n.Parent
			if ast.IsDeclarationName(n) && p.Kind != ast.KindShorthandPropertyAssignment || ast.IsPropertyAccessExpression(p) && p.Name() == n || p.Kind == ast.KindPropertyAssignment && p.Name() == n {
				return n.ForEachChild(visit)
			}
			if n.Text() == "eval" {
				safe = false
				return true
			}
			symbol := c.GetSymbolAtLocation(n)
			if p.Kind == ast.KindShorthandPropertyAssignment {
				symbol = c.GetShorthandAssignmentValueSymbol(p)
			}
			if symbol == nil {
				safe = false
				return true
			}
			if len(symbol.Declarations()) == 0 {
				if n.Text() != "undefined" && n.Text() != "NaN" && n.Text() != "Infinity" {
					safe = false
				}
				return false
			}
			for _, d := range symbol.Declarations() {
				if inside(d) {
					continue
				}
				source := ast.GetSourceFileOfNode(d)
				if source != nil && fix.Program.IsSourceFileDefaultLibrary(source.PathKey()) {
					continue
				}
				imported := d
				for imported != nil && !ast.IsImportDeclaration(imported) {
					imported = imported.Parent
				}
				if imported == nil || source != file {
					safe = false
					return true
				}
				if imports[imported] == nil {
					imports[imported] = map[*ast.Node]bool{}
				}
				imports[imported][d] = true
			}
		}
		return n.ForEachChild(visit)
	}
	declaration.ForEachChild(visit)
	if !safe || len(imports) > 0 && fix.Program.Options().NoUnusedLocals.IsTrue() {
		return nil // Removing copied import bindings needs a separate unused-import plan.
	}
	// Import bindings cannot replace mutable declaration bindings. Reject writes anywhere, including self-writes.
	binding := c.GetSymbolAtLocation(nameNode)
	if binding == nil || len(binding.Declarations()) != 1 {
		return nil // Moving one overload or merged declaration would leave an incompatible group behind.
	}
	var writes func(*ast.Node) bool
	writes = func(n *ast.Node) bool {
		if ast.IsIdentifier(n) && (!ast.IsDeclarationName(n) || n.Parent.Kind == ast.KindShorthandPropertyAssignment) {
			symbol := c.GetSymbolAtLocation(n)
			if n.Parent != nil && n.Parent.Kind == ast.KindShorthandPropertyAssignment {
				symbol = c.GetShorthandAssignmentValueSymbol(n.Parent)
			}
			if symbol == binding {
				if ast.IsWriteAccess(n) || n.Parent.Kind == ast.KindShorthandPropertyAssignment && ast.IsAssignmentTarget(n.Parent) {
					safe = false
					return true
				}
				if !inside(n) {
					parent := n.Parent
					direct := (ast.IsCallExpression(parent) || ast.IsNewExpression(parent)) && parent.Expression() == n
					if !ast.IsExportSpecifier(parent) && (!direct || inEffectCode(parent)) {
						safe = false
						return true
					}
				}
			}
		}
		return n.ForEachChild(writes)
	}
	file.AsNode().ForEachChild(writes)
	if !safe {
		return nil
	}
	var header strings.Builder
	for _, statement := range file.Statements.Nodes {
		wanted := imports[statement]
		if wanted == nil {
			continue
		}
		imp := statement.AsImportDeclaration()
		if imp.ImportClause == nil || parser.IsVibeLangModuleReference(imp.ModuleSpecifier) {
			return nil
		}
		clause := imp.ImportClause.AsImportClause()
		if clause.PhaseModifier == ast.KindDeferKeyword {
			return nil
		}
		var pieces []string
		if clause.Name() != nil && wanted[imp.ImportClause] {
			pieces = append(pieces, nodeText(file, clause.Name()))
		}
		if named := clause.NamedBindings; named != nil {
			if ast.IsNamespaceImport(named) && wanted[named] {
				pieces = append(pieces, "* as "+nodeText(file, named.Name()))
			}
			if ast.IsNamedImports(named) {
				var names []string
				for _, specifier := range named.AsNamedImports().Elements.Nodes {
					if wanted[specifier] {
						names = append(names, nodeText(file, specifier))
					}
				}
				if len(names) > 0 {
					pieces = append(pieces, "{ "+strings.Join(names, ", ")+" }")
				}
			}
		}
		if len(pieces) == 0 {
			return nil
		}
		header.WriteString("import ")
		if clause.PhaseModifier == ast.KindTypeKeyword {
			header.WriteString("type ")
		}
		header.WriteString(strings.Join(pieces, ", ") + " from " + file.Text()[nodeStart(file, imp.ModuleSpecifier):statement.End()] + "\n")
	}
	for _, doc := range declaration.JSDoc(file) {
		written := file.Text()[doc.Pos():doc.End()]
		if strings.Contains(written, "@throws") || strings.Contains(written, "@rethrows") {
			return nil
		}
		header.WriteString(written + "\n")
	}
	name := nameNode.Text()
	base := moduleFileBase(&ls.RefactorContext{SourceFile: file, Program: fix.Program, LS: fix.LS}, name)
	extension := ".js"
	if fix.Program.Options().RewriteRelativeImportExtensions.IsTrue() || fix.Program.Options().AllowImportingTsExtensions.IsTrue() {
		extension = ".ts"
	}
	specifier := strconv.Quote("./" + base + extension)
	replacement := "import { " + name + " } from " + specifier + "\n"
	exported := nothrowExported(c, file, declaration)
	if variable != nil {
		alias := freshName(file, "$"+name+"$ts")
		replacement = "import { " + name + " as " + alias + " } from " + specifier + "\n"
		if ast.HasSyntacticModifier(declaration, ast.ModifierFlagsExport) {
			replacement += "export "
		}
		replacement += "const " + name + " = " + alias + "\n"
	} else if ast.HasSyntacticModifier(declaration, ast.ModifierFlagsExport) {
		exportedName := name
		if ast.HasSyntacticModifier(declaration, ast.ModifierFlagsDefault) {
			exportedName += " as default"
		}
		replacement += "export { " + exportedName + " }\n"
	}
	title := "Move " + name + " to a .ts file"
	if exported {
		title += " and re-export it"
	}
	return &ls.CodeAction{Description: title, Changes: replaceRange(fix, nodeStart(file, declaration), declaration.End(), replacement), CreatedFiles: []ls.CreatedFile{{FileName: file.FileName().Directory().ResolveFile(base + ".ts"), Text: header.String() + text + "\n"}}}
}

func nothrowDeclarationName(declaration *ast.Node) *ast.Node {
	if ast.IsVariableStatement(declaration) {
		declarations := declaration.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes
		if len(declarations) == 1 {
			return declarations[0].Name()
		}
		return nil
	}
	if ast.IsFunctionDeclaration(declaration) || ast.IsClassDeclaration(declaration) {
		return declaration.Name()
	}
	return nil
}

func nothrowExported(c *checker.Checker, file *ast.SourceFile, declaration *ast.Node) bool {
	if ast.HasSyntacticModifier(declaration, ast.ModifierFlagsExport) {
		return true
	}
	if file.AsNode().Symbol() == nil || nothrowDeclarationName(declaration) == nil {
		return false
	}
	symbol := c.GetSymbolAtLocation(nothrowDeclarationName(declaration))
	for _, export := range c.GetExportsOfModule(file.AsNode().Symbol()) {
		if export == symbol || export.Flags()&ast.SymbolFlagsAlias != 0 && c.GetAliasedSymbol(export) == symbol {
			return true
		}
	}
	return false
}

func publishedNothrowDeclaration(fix *ls.CodeFixContext, c *checker.Checker, site *ast.Node) bool {
	declaration := site
	for declaration.Parent != nil && declaration.Parent != fix.SourceFile.AsNode() {
		declaration = declaration.Parent
	}
	if !nothrowExported(c, fix.SourceFile, declaration) {
		return false
	}
	for dir := fix.SourceFile.FileName().Directory(); ; {
		if text, ok := fix.Program.Host().FS().ReadFile(dir.ResolveFile("package.json")); ok {
			var pkg struct {
				Name    string `json:"name"`
				Private bool   `json:"private"`
			}
			return json.Unmarshal([]byte(text), &pkg) == nil && pkg.Name != "" && !pkg.Private
		}
		parent := dir.ResolveDirectory("..")
		if parent == dir {
			return false
		}
		dir = parent
	}
}

// The preferred effect edit is automatic only for handlers or unused local declarations. Calls and captured
// function values need an explicit migration plan; error-count gating alone cannot detect an unrun Effect.
func automaticNothrowFix(c *checker.Checker, file *ast.SourceFile, site *ast.Node) bool {
	home := analyzerFor(c).plainHomeOf(site)
	if home == nil {
		return false
	}
	if isCatchHandlerOf(home) {
		return true
	}
	if !ast.IsFunctionDeclaration(home) || home.Name() == nil || nothrowExported(c, file, home) {
		return false
	}
	symbol := c.GetSymbolAtLocation(home.Name())
	used := false
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if ast.IsIdentifier(n) {
			reference := c.GetSymbolAtLocation(n)
			if n.Parent != nil && n.Parent.Kind == ast.KindShorthandPropertyAssignment {
				reference = c.GetShorthandAssignmentValueSymbol(n.Parent)
			}
			if n.Text() == "eval" || n != home.Name() && reference == symbol {
				used = true
				return true
			}
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return !used
}
