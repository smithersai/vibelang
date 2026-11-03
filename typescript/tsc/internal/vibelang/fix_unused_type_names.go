package vibelang

import (
	"slices"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// An Effect.fn fix writes each parameter's checked type in place of its
// annotation (detail 277), so an annotation may have been the last read of a
// type name. Under noUnusedLocals that read an added TS6133 or TS6196, and the
// gate refused the fix, which left the module's EK1002 and the errors of every
// module that reads its type (opencode's ai protocols, ssh controller and
// plugin adapter). The name has nothing left to do, so the gate does not count
// it, and removeUnusedTypeNames removes it when the fixes are done. A value is
// another matter: a fix that leaves one unread may have dropped a use, so that
// error still refuses the fix, unless it is an import binding that only erased
// type positions read before the fixes, such as opencode's SessionSchema in
// SessionSchema.ID: no fix can have dropped a run-time read it never had.

// unusedTypeNameAt returns the statement that declares the type name d reports
// unused, and its import binding if it has one. It answers for a type-only
// import binding, an import binding baseline records as read only in types,
// and a type alias of the module that no export names. The whole-declaration
// form of the error has a nil binding.
func unusedTypeNameAt(d *ast.Diagnostic, baseline errorBaseline) (statement, binding *ast.Node, ok bool) {
	file := d.File()
	if file == nil {
		return nil, nil, false
	}
	typeReads := baseline.typeReads[file.FileName().AsString()]
	all := false
	switch d.Code() {
	case diagnostics.X_0_is_declared_but_its_value_is_never_read.Code(), diagnostics.X_0_is_declared_but_never_used.Code():
	case diagnostics.All_imports_in_import_declaration_are_unused.Code():
		all = true
	default:
		return nil, nil, false
	}
	for _, s := range file.Statements.Nodes {
		if d.Pos() < nodeStart(file, s) || d.Pos() >= s.End() {
			continue
		}
		switch {
		case ast.IsTypeAliasDeclaration(s):
			if s.Name() == nil || nodeStart(file, s.Name()) != d.Pos() || ast.HasSyntacticModifier(s, ast.ModifierFlagsExport) {
				return nil, nil, false
			}
			return s, nil, true
		case ast.IsImportDeclaration(s) && s.ImportClause() != nil:
			for _, b := range importBindingsOf(file) {
				if b.declaration != s || !isTypeOnlyBinding(s, b.node) && !typeReads[b.name] {
					if all && b.declaration == s {
						return nil, nil, false
					}
					continue
				}
				if !all && d.Pos() >= nodeStart(file, b.node) && d.Pos() < b.node.End() {
					return s, b.node, true
				}
			}
			if all {
				return s, nil, true
			}
		}
		return nil, nil, false
	}
	return nil, nil, false
}

// isTypeOnlyBinding reports whether binding, of the import declaration s, can
// only name a type: import type { T } or import { type T }.
func isTypeOnlyBinding(s, binding *ast.Node) bool {
	return s.ImportClause().AsImportClause().IsTypeOnly() ||
		ast.IsImportSpecifier(binding) && binding.AsImportSpecifier().IsTypeOnly
}

// isUnusedTypeName reports whether d is an error addedCounts leaves to
// removeUnusedTypeNames.
func isUnusedTypeName(d *ast.Diagnostic, baseline errorBaseline) bool {
	_, _, ok := unusedTypeNameAt(d, baseline)
	return ok
}

// typeReadImports returns the import bindings of file that something reads
// and that only erased type positions read: a type reference, a qualified
// type name such as SessionSchema.ID, or typeof in a type. Emit drops such a
// binding's reads, so removing the binding drops none. An identifier of the
// same text anywhere else, even one that names something else, counts as a
// run-time read.
func typeReadImports(file *ast.SourceFile) map[string]bool {
	bindings := map[string]bool{}
	for _, b := range importBindingsOf(file) {
		bindings[b.name] = true
	}
	if len(bindings) == 0 {
		return nil
	}
	typeRead, valueRead := map[string]bool{}, map[string]bool{}
	var visit func(node *ast.Node, erased bool) bool
	visit = func(node *ast.Node, erased bool) bool {
		if ast.IsImportDeclaration(node) {
			return false
		}
		erased = erased || node.Kind >= ast.KindFirstTypeNode && node.Kind <= ast.KindLastTypeNode
		if ast.IsIdentifier(node) && bindings[node.Text()] {
			if erased {
				typeRead[node.Text()] = true
			} else {
				valueRead[node.Text()] = true
			}
		}
		return node.ForEachChild(func(child *ast.Node) bool { return visit(child, erased) })
	}
	file.AsNode().ForEachChild(func(child *ast.Node) bool { return visit(child, false) })
	for name := range valueRead {
		delete(typeRead, name)
	}
	return typeRead
}

// removeUnusedTypeNames removes, from the files the fixes changed, the type
// names the fixes left unused, until none is left: removing an alias can leave
// the names only it read unused. A name the baseline already reported unused is
// the author's, and stays. It keeps what it has when a removal adds an error,
// and the name's error then reports the name as any other error does.
func removeUnusedTypeNames(g *fixGate, texts map[tspath.RootedFilePath]string, result *FixResult) {
	for range fixPassLimit {
		program := g.build(texts)
		errors := programErrors(g.ctx, program)
		added := strictAddedCounts(errors, g.baseline)
		found := map[tspath.RootedFilePath][]*ast.Diagnostic{}
		for _, d := range errors {
			if isUnusedTypeName(d, g.baseline) && added[errorKey(d)] > 0 && result.Files[d.File().FileName()] != nil {
				found[d.File().FileName()] = append(found[d.File().FileName()], d)
			}
		}
		if len(found) == 0 {
			return
		}
		cleaned := map[tspath.RootedFilePath]string{}
		for name, reported := range found {
			file := program.GetSourceFile(name)
			c, done := program.GetTypeCheckerForFile(g.ctx, file)
			cleaned[name] = applyEdits(file.Text(), unusedTypeNameEdits(c, file, reported, g.baseline))
			done()
		}
		g.progress.enter("imports", 0, fixesApplied(result), len(result.Refused), "removing unused type names")
		if _, ok := g.passes(texts, cleaned); !ok {
			return
		}
		for name, text := range cleaned {
			result.Files[name].Text = text
			texts[name] = text
		}
	}
}

// unusedTypeNameEdits returns the edits that remove the names reported: whole
// statements for aliases, and bindings for imports. Removing a
// type-only binding changes no module's initialization, except that under
// verbatimModuleSyntax import { type T } alone still loads its module, so that
// declaration stays as a bare import.
func unusedTypeNameEdits(c *checker.Checker, file *ast.SourceFile, reported []*ast.Diagnostic, baseline errorBaseline) []sourceEdit {
	var edits []sourceEdit
	gone := map[*ast.Node][]*ast.Node{}
	var imports []*ast.Node
	for _, d := range reported {
		statement, binding, _ := unusedTypeNameAt(d, baseline)
		if !ast.IsImportDeclaration(statement) {
			edits = append(edits, statementRemoval(file, statement))
			continue
		}
		if !slices.Contains(imports, statement) {
			imports = append(imports, statement)
		}
		for _, b := range importBindingsOf(file) {
			if b.declaration == statement && (binding == nil || b.node == binding) && !slices.Contains(gone[statement], b.node) {
				gone[statement] = append(gone[statement], b.node)
			}
		}
	}
	for _, statement := range imports {
		all := 0
		for _, b := range importBindingsOf(file) {
			if b.declaration == statement {
				all++
			}
		}
		switch {
		case len(gone[statement]) < all:
			edits = append(edits, bindingRemovals(file, statement, gone[statement])...)
		case c.CompilerOptions().VerbatimModuleSyntax.IsTrue() && !statement.ImportClause().AsImportClause().IsTypeOnly():
			module := statement.ModuleSpecifier()
			bare := "import " + expressionText(file, module) + file.Text()[module.End():statement.End()]
			edits = append(edits, sourceEdit{nodeStart(file, statement), statement.End(), bare})
		default:
			edits = append(edits, statementRemoval(file, statement))
		}
	}
	return edits
}

// statementRemoval removes statement and the rest of its line, and the blank
// line after it when one stands before it too. A comment above it stays.
func statementRemoval(file *ast.SourceFile, statement *ast.Node) sourceEdit {
	text := file.Text()
	start, end := nodeStart(file, statement), statement.End()
	newline := strings.IndexByte(text[end:], '\n')
	if newline < 0 || strings.TrimSpace(text[end:end+newline]) != "" {
		return sourceEdit{start, end, ""}
	}
	end += newline + 1
	if strings.HasPrefix(text[end:], "\n") && (start == 0 || strings.HasSuffix(text[:start], "\n\n")) {
		end++
	}
	return sourceEdit{start, end, ""}
}
