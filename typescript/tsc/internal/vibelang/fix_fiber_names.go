package vibelang

import (
	"context"
	"slices"
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// fork and join are reserved words under [+Effect] (VIP-17, amended; Appendix
// A), so effect code never calls a binding of those names: fork(x) there is a
// fiber operation. The parser reports a binding of either name in effect code
// as EK1702. vibelang --fix renames, before it rewrites anything else:
//
//   - a binding EK1702 reports, with the uses in its scope, which the parser
//     read as operations. They meant the binding, as the .ts twin reads them.
//   - a binding an Effect.gen or Effect.fn program reads or declares. Its
//     rewrite to effect code would otherwise turn fork(x) into the operation
//     with no error to show for it, so planEffectGen refuses until the rename
//     has landed.
//
// A rename keeps every name a reader outside the binding sees: an object key
// stays ({ fork: fork2 }), an import keeps its source name, and an exported
// binding keeps its exported name through export { fork2 as fork }.

// fiberNameRenameLabel is the rewrite kind --fix reports for the renames.
const fiberNameRenameLabel = "fork and join binding renames"

// reservedFiberName is EK1702 as the parser reports it for a binding in effect
// code (VIP-17, amended). The parser does not report a function expression's
// own name.
var reservedFiberName = message(parser.ReservedFiberNameDiagnosticCode, errorCategory, parser.ReservedFiberNameDiagnosticText)

func init() {
	registry[reservedFiberName.Code] = reservedFiberName
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{Source: diagnosticSource, ErrorCodes: []int32{reservedFiberName.Code}, GetCodeActions: fiberNameActions})
}

// A fiberRename is the rename of one binding named fork or join and its uses.
type fiberRename struct {
	name    *ast.Node    // the identifier that selected the binding
	newName string       // the name the rename writes
	edits   []sourceEdit // empty when why says it cannot be renamed
	why     string       // why the binding keeps its name, or ""
}

func isFiberWord(text string) bool { return text == "fork" || text == "join" }

// fiberNameIdentifiers returns file's identifiers spelled fork or join, without
// the nodes the parser wrote for other forms, and every identifier's text.
func fiberNameIdentifiers(file *ast.SourceFile) (found []*ast.Node, taken map[string]bool) {
	taken = map[string]bool{}
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsIdentifier(node) && node.Flags&ast.NodeFlagsReparsed == 0 {
			taken[node.Text()] = true
			if isFiberWord(node.Text()) {
				found = append(found, node)
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return found, taken
}

// isFiberMemberName reports whether id names a member or a key, which no
// reservation reaches and no rename touches.
func isFiberMemberName(id *ast.Node) bool {
	parent := id.Parent
	if parent == nil {
		return true
	}
	switch parent.Kind {
	case ast.KindPropertyAccessExpression, ast.KindQualifiedName, ast.KindPropertyAssignment, ast.KindMethodDeclaration, ast.KindPropertyDeclaration,
		ast.KindPropertySignature, ast.KindMethodSignature, ast.KindGetAccessor, ast.KindSetAccessor, ast.KindEnumMember, ast.KindNamedTupleMember,
		ast.KindJsxAttribute:
		return parent.Name() == id
	case ast.KindBindingElement:
		return parent.AsBindingElement().PropertyName == id
	case ast.KindImportSpecifier:
		return parent.AsImportSpecifier().PropertyName == id
	}
	return false
}

// fiberNameSymbol returns the binding id refers to or declares, or nil. A
// callee the parser read as the operation has no symbol of its own, so it asks
// what the name means in lexical scope: the binding the writer called.
func fiberNameSymbol(c *checker.Checker, id *ast.Node) *ast.Symbol {
	parent := id.Parent
	switch {
	case id.Flags&ast.NodeFlagsVibeLangIntrinsic != 0:
		return c.ResolveName(id.Text(), parent, ast.SymbolFlagsValue|ast.SymbolFlagsAlias, true /*excludeGlobals*/)
	case ast.IsShorthandPropertyAssignment(parent):
		return c.GetShorthandAssignmentValueSymbol(parent)
	case ast.IsExportSpecifier(parent):
		return c.GetExportSpecifierLocalTargetSymbol(parent)
	}
	return c.GetSymbolAtLocation(id)
}

// isPreludeFiberName reports whether symbol is the runtime's fork or join: the
// operation's own name, which a rewrite to effect code keeps meaning.
func isPreludeFiberName(c *checker.Checker, symbol *ast.Symbol, name string) bool {
	return isRuntimeSymbol(c, symbol, name)
}

// generatorRegionFiberNames returns the identifiers spelled fork or join that
// would stand in effect code once call, an Effect.gen or Effect.fn, is rewritten
// and that name a program's own binding: the generator's parameters and body,
// and the parameters of a function whose body is only that call.
func generatorRegionFiberNames(c *checker.Checker, call *ast.Node) []*ast.Node {
	var found []*ast.Node
	g, why := readGeneratorCall(c, ast.GetSourceFileOfNode(call), call)
	if g == nil || why != "" {
		return nil
	}
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		switch {
		case ast.IsIdentifier(node):
			if isFiberWord(node.Text()) && node.Flags&ast.NodeFlagsReparsed == 0 && !isFiberMemberName(node) {
				if symbol := fiberNameSymbol(c, node); symbol != nil && !isPreludeFiberName(c, symbol, node.Text()) {
					found = append(found, node)
				}
			}
			return false
		case ast.IsFunctionLike(node) && !isMarkedEffect(node):
			// A plain arrow's head inherits the reservation; its body and any
			// other plain callable do not (Appendix A).
			if ast.IsArrowFunction(node) {
				for _, parameter := range node.Parameters() {
					visit(parameter)
				}
			}
			return false
		case node.Kind == ast.KindPropertyDeclaration || node.Kind == ast.KindEnumMember:
			if name := node.Name(); name != nil && name.Kind == ast.KindComputedPropertyName {
				visit(name)
			}
			return false // a field or enum initializer resets to [~Effect]
		}
		return node.ForEachChild(visit)
	}
	for _, parameter := range g.generator.Parameters() {
		visit(parameter)
	}
	visit(g.generator.Body())
	outer := call
	for ast.IsParenthesizedExpression(outer.Parent) {
		outer = outer.Parent
	}
	parent := outer.Parent
	if ast.IsReturnStatement(parent) && ast.IsBlock(parent.Parent) && len(parent.Parent.Statements()) == 1 {
		parent = parent.Parent.Parent
	}
	if ast.IsFunctionLike(parent) && !g.isFn {
		for _, parameter := range parent.Parameters() {
			visit(parameter)
		}
	}
	return found
}

// fiberNameRenames returns, in source order, the rename of each binding named
// fork or join that EK1702 reports or that a generator's rewrite would reach.
func fiberNameRenames(c *checker.Checker, file *ast.SourceFile) []fiberRename {
	text := file.Text()
	if !file.FileName().IsVibeLangSource() || !strings.Contains(text, "fork") && !strings.Contains(text, "join") {
		return nil
	}
	identifiers, taken := fiberNameIdentifiers(file)
	fresh := func(name string) string {
		for n := 2; ; n++ {
			if candidate := name + strconv.Itoa(n); !taken[candidate] {
				return candidate
			}
		}
	}
	var renames []fiberRename
	seen := map[*ast.Symbol]bool{}
	add := func(id *ast.Node) {
		symbol := fiberNameSymbol(c, id)
		if symbol == nil || seen[symbol] {
			return
		}
		seen[symbol] = true
		r := fiberRename{name: id, newName: fresh(id.Text())}
		r.edits, r.why = fiberRenameEdits(c, file, identifiers, symbol, id.Text(), r.newName)
		renames = append(renames, r)
	}
	for _, d := range file.Diagnostics() {
		if d.Code() != reservedFiberName.Code {
			continue
		}
		at := slices.IndexFunc(identifiers, func(id *ast.Node) bool { return nodeStart(file, id) == d.Loc().Pos() })
		if at < 0 {
			continue
		}
		id := identifiers[at]
		if ast.IsLabeledStatement(id.Parent) {
			renames = append(renames, fiberLabelRename(file, id, fresh(id.Text())))
			continue
		}
		add(id)
	}
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsCallExpression(node) {
			for _, id := range generatorRegionFiberNames(c, node) {
				add(id)
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	slices.SortStableFunc(renames, func(a, b fiberRename) int { return nodeStart(file, a.name) - nodeStart(file, b.name) })
	return renames
}

// fiberRenameEdits writes the rename of symbol to newName at each identifier
// that refers to it, or says why the binding cannot move.
func fiberRenameEdits(c *checker.Checker, file *ast.SourceFile, identifiers []*ast.Node, symbol *ast.Symbol, name, newName string) ([]sourceEdit, string) {
	text := file.Text()
	var edits []sourceEdit
	exportedEnd := -1
	for _, id := range identifiers {
		if id.Text() != name || isFiberMemberName(id) || fiberNameSymbol(c, id) != symbol {
			continue
		}
		start, end := nodeStart(file, id), id.End()
		parent := id.Parent
		replacement := newName
		switch {
		case id.Flags&ast.NodeFlagsVibeLangIntrinsic != 0:
			// The parser read every use in the binding's scope as the operation.
			// fork job could only have meant a call; any other spelling, such as
			// fork(job), fork + 1 or return fork, reads the binding once renamed.
			next := scanner.SkipTrivia(text, end)
			switch {
			case next < len(text) && text[next] == '{':
				return nil, "a fork { ... } block stands in the scope of a binding named " + name + ": write its call by hand"
			case next < len(text) && next > end && isIdentifierByte(text[next]):
				edits = append(edits, sourceEdit{start, next, newName + "("}, sourceEdit{parent.End(), parent.End(), ")"})
				continue
			}
		case ast.IsShorthandPropertyAssignment(parent):
			replacement = name + ": " + newName
		case ast.IsBindingElement(parent) && parent.AsBindingElement().PropertyName == nil && parent.Parent.Kind == ast.KindObjectBindingPattern:
			replacement = name + ": " + newName
		case ast.IsImportSpecifier(parent) && parent.AsImportSpecifier().PropertyName == nil:
			replacement = name + " as " + newName
		case ast.IsExportSpecifier(parent):
			spec := parent.AsExportSpecifier()
			if spec.PropertyName == nil {
				replacement = newName + " as " + name
			} else if spec.PropertyName != id {
				continue // export { x as fork } names the export
			}
		default:
			exported, statementEnd, removal, why := fiberExportedDeclaration(file, id)
			if why != "" {
				return nil, why
			}
			if exported {
				edits = append(edits, removal)
				exportedEnd = max(exportedEnd, statementEnd)
			}
		}
		edits = append(edits, sourceEdit{start, end, replacement})
	}
	if exportedEnd >= 0 {
		edits = append(edits, sourceEdit{exportedEnd, exportedEnd, "\nexport { " + newName + " as " + name + " }"})
	}
	slices.SortStableFunc(edits, func(a, b sourceEdit) int { return a.start - b.start })
	return edits, ""
}

// fiberExportedDeclaration reports whether id declares a binding its statement
// exports by that name, and returns the edit that drops the export modifier.
func fiberExportedDeclaration(file *ast.SourceFile, id *ast.Node) (exported bool, statementEnd int, removal sourceEdit, why string) {
	parent := id.Parent
	var statement *ast.Node
	switch {
	case (ast.IsFunctionDeclaration(parent) || ast.IsClassDeclaration(parent)) && parent.Name() == id:
		statement = parent
	case ast.IsVariableDeclaration(parent) && parent.Name() == id:
		statement = parent.Parent.Parent
		if statement == nil || !ast.IsVariableStatement(statement) {
			return false, 0, sourceEdit{}, ""
		}
		if ast.HasSyntacticModifier(statement, ast.ModifierFlagsExport) && len(parent.Parent.AsVariableDeclarationList().Declarations.Nodes) != 1 {
			return false, 0, sourceEdit{}, "an exported declaration list holds " + id.Text() + " beside other names: split the list, then run --fix again"
		}
	case ast.IsBindingElement(parent) && parent.Name() == id:
		holder := parent
		for holder != nil && !ast.IsVariableDeclaration(holder) {
			holder = holder.Parent
		}
		if holder != nil && holder.Parent != nil && holder.Parent.Parent != nil && ast.HasSyntacticModifier(holder.Parent.Parent, ast.ModifierFlagsExport) {
			return false, 0, sourceEdit{}, "an exported destructuring declares " + id.Text() + ": write the export by hand"
		}
		return false, 0, sourceEdit{}, ""
	default:
		return false, 0, sourceEdit{}, ""
	}
	if !ast.HasSyntacticModifier(statement, ast.ModifierFlagsExport) || ast.HasSyntacticModifier(statement, ast.ModifierFlagsDefault) {
		return false, 0, sourceEdit{}, ""
	}
	if statement.Parent == nil || !ast.IsSourceFile(statement.Parent) || ast.HasSyntacticModifier(statement, ast.ModifierFlagsAmbient) {
		return false, 0, sourceEdit{}, "an ambient or namespace export declares " + id.Text() + ", and its exported name has to stay"
	}
	for _, modifier := range statement.Modifiers().Nodes {
		if modifier.Kind == ast.KindExportKeyword {
			start := nodeStart(file, modifier)
			removal = sourceEdit{start, scanner.SkipTrivia(file.Text(), modifier.End()), ""}
			return true, statement.End(), removal, ""
		}
	}
	return false, 0, sourceEdit{}, ""
}

// fiberLabelRename renames a label and the jumps that name it.
func fiberLabelRename(file *ast.SourceFile, label *ast.Node, newName string) fiberRename {
	edits := []sourceEdit{{nodeStart(file, label), label.End(), newName}}
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsFunctionLike(node) {
			return false
		}
		if ast.IsBreakOrContinueStatement(node) {
			if jump := node.Label(); jump != nil && jump.Text() == label.Text() {
				edits = append(edits, sourceEdit{nodeStart(file, jump), jump.End(), newName})
			}
		}
		return node.ForEachChild(visit)
	}
	label.Parent.AsLabeledStatement().Statement.ForEachChild(visit)
	return fiberRename{name: label, newName: newName, edits: edits}
}

// generatorFiberNameRefusal says why call's rewrite must wait for a rename, or
// returns "".
func generatorFiberNameRefusal(c *checker.Checker, call *ast.Node) string {
	names := generatorRegionFiberNames(c, call)
	if len(names) == 0 {
		return ""
	}
	return names[0].Text() + " is reserved in effect code, and this generator reaches a binding of that name; vibelang --fix renames it first"
}

// fiberNameMigrationFixes proposes each rename. One whose edits overlap a
// rename taken waits for a round that rechecks the edited source.
func fiberNameMigrationFixes(ctx context.Context, program *compiler.Program, file *ast.SourceFile, refused map[string]bool) proposal {
	p := proposal{file: file}
	if !file.FileName().IsVibeLangSource() {
		return p
	}
	c, done := program.GetTypeCheckerForFile(ctx, file)
	defer done()
	var taken []sourceEdit
	for _, r := range fiberNameRenames(c, file) {
		line, _ := scannerLineOf(file, nodeStart(file, r.name))
		key := "fiberNameRename:" + r.name.Text() + ":" + strconv.Itoa(line+1)
		if len(r.edits) == 0 || refused[key] || slices.ContainsFunc(r.edits, func(e sourceEdit) bool { return overlapsAny(e, taken) }) {
			continue
		}
		p.fixes = append(p.fixes, fileFix{code: reservedFiberName.Code, edits: r.edits, key: key, label: fiberNameRenameLabel})
		taken = append(taken, r.edits...)
	}
	return p
}

// fiberNameActions is EK1702's quick fix.
func fiberNameActions(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
	c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
	defer done()
	for _, r := range fiberNameRenames(c, fix.SourceFile) {
		if nodeStart(fix.SourceFile, r.name) != fix.Span.Pos() || len(r.edits) == 0 {
			continue
		}
		var changes []*lsproto.TextEdit
		for _, e := range r.edits {
			changes = append(changes, replaceRange(fix, e.start, e.end, e.text)...)
		}
		return []*ls.CodeAction{{Description: "Rename " + r.name.Text() + " and its uses to " + r.newName, Changes: changes}}, nil
	}
	return nil, nil
}
