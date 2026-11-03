package vibelang

import (
	"context"
	"fmt"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

const errorPayloadReadonlyLabel = "error nested readonly keys"

func init() {
	sourceFileMigrations = append(sourceFileMigrations, errorPayloadReadonlyMigrationFixes)
}

// Migration-only spells the old implicit type-member modifiers. Normal fixes
// preserve valid writable code under VIP-13/29's shallow readonly contract.
func errorPayloadReadonlyMigrationFixes(_ context.Context, _ *compiler.Program, file *ast.SourceFile, refused map[string]bool) proposal {
	result := proposal{file: file}
	source, forms := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/error-upgrade.vibe", PathKey: "/error-upgrade.vibe"}, file.Text())
	var commas []int
	var separators func(*ast.Node) bool
	separators = func(node *ast.Node) bool {
		if ast.IsSemicolonClassElement(node) && node.Flags&ast.NodeFlagsVibeLang != 0 && node.Flags&ast.NodeFlagsReparsed != 0 && node.Pos() < node.End() {
			at := nodeStart(source, node)
			if at < len(file.Text()) && file.Text()[at] == ',' {
				commas = append(commas, at)
			}
		}
		return node.ForEachChild(separators)
	}
	source.AsNode().ForEachChild(separators)
	seen := map[int]bool{}
	for _, form := range forms {
		if form.Kind != parser.VibeSyntaxDeclaration || (form.Name != "error" && form.Name != "schema error") || form.Open.Len() == 0 || form.Close.Len() == 0 {
			continue
		}
		start, end := form.Open.Pos(), form.Close.End()
		const prefix = "class $Error "
		text := []byte(prefix + file.Text()[start:end])
		// A class wrapper preserves methods and their local/parameter/return types,
		// without synthesizing either error's heritage or its schema codecs.
		for _, at := range commas {
			if at >= start && at < end {
				text[at-start+len(prefix)] = ';'
			}
		}
		// A Field named constructor uses the shared Field grammar, unlike a native
		// class constructor token. Its placeholder has exactly the same byte width.
		for _, name := range form.FieldNames {
			for at := name.Pos(); at < name.End(); at++ {
				text[at-start+len(prefix)] = '$'
			}
		}
		mutable := map[int]bool{}
		for _, syntax := range forms {
			if syntax.Kind == parser.VibeSyntaxMutable && syntax.Word.Pos() >= start && syntax.Word.End() <= end {
				mutable[syntax.Word.Pos()-start+len(prefix)] = true
				for i := syntax.Word.Pos(); i < syntax.Word.End(); i++ {
					text[i-start+len(prefix)] = ' '
				}
			}
		}
		raw, rawForms := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/error-upgrade.vibe", PathKey: "/error-upgrade.vibe"}, string(text))
		if len(raw.Diagnostics()) != 0 || len(raw.Statements.Nodes) != 1 || !ast.IsClassDeclaration(raw.Statements.Nodes[0]) {
			continue
		}
		var nested []core.TextRange
		for _, syntax := range rawForms {
			if syntax.Kind == parser.VibeSyntaxDeclaration {
				nested = append(nested, syntax.Range)
			}
		}
		var visit func(*ast.Node) bool
		visit = func(node *ast.Node) bool {
			// Nested declarations establish their own readonly policy. Nested errors
			// are processed separately by the outer form loop.
			for _, span := range nested {
				if at := nodeStart(raw, node); at >= span.Pos() && at < span.End() {
					return false
				}
			}
			if (ast.IsPropertySignatureDeclaration(node) && node.Name() != nil) || ast.IsIndexSignatureDeclaration(node) {
				written := false
				for _, modifier := range node.ModifierNodes() {
					if modifier.Kind == ast.KindReadonlyKeyword && modifier.Flags&ast.NodeFlagsReparsed == 0 {
						written = true
					}
				}
				pos := nodeStart(raw, node)
				isMutable := false
				for word := range mutable {
					// SkipTrivia advances past a removed contextual modifier to the key.
					if word <= pos && scanner.SkipTrivia(string(text), word) == pos {
						isMutable = true
						break
					}
				}
				if !written && !isMutable {
					anchor := node
					if node.Name() != nil {
						anchor = node.Name()
					}
					at := start + nodeStart(raw, anchor) - len(prefix)
					key := fmt.Sprintf("error-payload-readonly:%d", at)
					if !seen[at] && !refused[key] {
						seen[at] = true
						result.fixes = append(result.fixes, fileFix{label: errorPayloadReadonlyLabel, key: key, edits: []sourceEdit{{at, at, "readonly "}}})
					}
				}
			}
			return node.ForEachChild(visit)
		}
		for _, member := range raw.Statements.Nodes[0].Members() {
			if ast.IsPropertyDeclaration(member) {
				if member.Type() != nil {
					visit(member.Type())
				}
				if member.Initializer() != nil {
					visit(member.Initializer())
				}
			} else {
				visit(member)
			}
		}
	}
	return result
}
