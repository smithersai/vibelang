package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// Preserve the old type's readonly keys when a refactor introduces a schema.
// TypeScript files have no synthesized readonly modifier, so their writable
// properties retain the ordinary schema spelling.
func schemaRefactorBody(file *ast.SourceFile, declaration *ast.Node, start, end int) string {
	return schemaTypeKeyBody(file, declaration, start, end, true)
}

func schemaTypeKeyBody(file *ast.SourceFile, declaration *ast.Node, start, end int, canonicalMutable bool) string {
	edits := []sourceEdit{}
	_, forms := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/schema-refactor.vibe", PathKey: "/schema-refactor.vibe"}, file.Text())
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if ast.IsPropertySignatureDeclaration(n) && n.Name() != nil {
			written := false
			for _, m := range n.ModifierNodes() {
				written = written || (m.Kind == ast.KindReadonlyKeyword && m.Flags&ast.NodeFlagsReparsed == 0)
			}
			pos := nodeStart(file, n.Name())
			needed := !written && ast.HasSyntacticModifier(n, ast.ModifierFlagsReadonly)
			if !canonicalMutable {
				needed = legacySchemaReadonlyProperty(file, n, forms)
			}
			if needed && pos >= start && pos < end {
				edits = append(edits, sourceEdit{pos - start, pos - start, "readonly "})
			}
		}
		return n.ForEachChild(visit)
	}
	visit(declaration)
	if canonicalMutable {
		for _, form := range forms {
			if form.Kind == parser.VibeSyntaxMutable && form.Word.Pos() >= start && form.Word.End() <= end {
				edits = append(edits, sourceEdit{form.Word.Pos() - start, form.Word.End() - start, ""})
			}
		}
	}
	return applyEdits(file.Text()[start:end], edits)
}

// legacySchemaReadonlyProperty reads the old schema default from written
// modifiers. Native TypeScript type members no longer receive a synthesized
// readonly modifier, so migration must not infer old intent from that flag.
// Only the explicit legacy migration calls this path; ordinary refactors keep
// the native writable type.
func legacySchemaReadonlyProperty(file *ast.SourceFile, node *ast.Node, forms []parser.VibeSyntax) bool {
	if !ast.IsPropertySignatureDeclaration(node) || node.Name() == nil || node.Type() == nil {
		return false
	}
	for _, modifier := range node.ModifierNodes() {
		if modifier.Kind == ast.KindReadonlyKeyword && modifier.Flags&ast.NodeFlagsReparsed == 0 {
			return false
		}
	}
	nameStart := nodeStart(file, node.Name())
	for _, form := range forms {
		if form.Kind == parser.VibeSyntaxMutable && form.Word.Pos() >= node.Pos() && form.Word.End() <= nameStart {
			return false
		}
	}
	return true
}
