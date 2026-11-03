package vibelang

import (
	"context"
	"slices"
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// Move module to a .ts file (VIP-40) turns
//
//	module text {
//	  export function clean(value: string): string { return value.trim() }
//	}
//	import { clean } from text
//
// in main.vibe into text.ts, holding the body, and
//
//	import { clean } from "./text.js"
//
// The body is already a TypeScript module of its own, so the move is a copy.
// The file is name.ts, or main.name.ts when anything named name exists beside
// the .vibe file, in any case and with any extension. The specifier ends in the
// file's extension where the project imports .ts files by their names
// (rewriteRelativeImportExtensions or allowImportingTsExtensions), and in .js
// otherwise. It is only ever a requested edit; --fix never moves a body.

const moveModuleTitle = "Move module to a .ts file"

func init() {
	ls.RegisterRefactorProvider(moveModuleRefactor)
}

// moveModuleRefactor offers the move anywhere in a top-level module declaration.
// The edit creates a file, so a client that cannot create one is offered nothing.
func moveModuleRefactor(ctx context.Context, r *ls.RefactorContext) []*ls.CodeAction {
	file := r.SourceFile
	if !isVibeLangFile(file) || !ls.ClientSupportsDocumentChanges(ctx) ||
		!slices.Contains(lsproto.GetClientCapabilities(ctx).Workspace.WorkspaceEdit.ResourceOperations, lsproto.ResourceOperationKindCreate) {
		return nil
	}
	declaration := selectedModuleDeclaration(file, r.Span)
	if declaration == nil {
		return nil
	}
	var body *ast.SourceFile
	for _, candidate := range file.EmbeddedModules() {
		if candidate.EmbeddedModule().Declaration == declaration {
			body = candidate
		}
	}
	if body == nil {
		return nil
	}
	options := r.Program.Options()
	extension := tspath.ExtensionJs
	bodyExtension := body.FileName().AnyExtension(nil, tspath.CaseSensitive)
	if options.RewriteRelativeImportExtensions.IsTrue() || options.AllowImportingTsExtensions.IsTrue() {
		extension = bodyExtension
	}
	base := moduleFileBase(r, declaration.Name().Text())
	specifier := strconv.Quote("./" + base + extension)

	text := file.Text()
	keyword := scanner.SkipTrivia(text, declaration.Pos())
	start := strings.LastIndexByte(text[:keyword], '\n') + 1
	if strings.TrimSpace(text[start:keyword]) != "" {
		start = keyword
	}
	end := declaration.End()
	if end < len(text) && text[end] == '\r' {
		end++
	}
	if end < len(text) && text[end] == '\n' {
		end++
	}
	edits := []*lsproto.TextEdit{{Range: r.LS.ToLSPRange(file, core.NewTextRange(start, end))}}
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if parser.IsVibeLangModuleReference(node) {
			if node.Text() == body.EmbeddedModule().Specifier {
				edits = append(edits, &lsproto.TextEdit{Range: r.LS.ToLSPRange(file, core.NewTextRange(scanner.SkipTrivia(text, node.Pos()), node.End())), NewText: specifier})
			}
			return false
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return []*ls.CodeAction{{
		Description: moveModuleTitle,
		Changes:     edits,
		CreatedFiles: []ls.CreatedFile{{
			FileName: file.FileName().Directory().ResolveFile(base + bodyExtension),
			Text:     moduleFileText(file, declaration, body),
		}},
	}}
}

// selectedModuleDeclaration returns the top-level module declaration that holds
// span, or nil when there is none or when the file has the declaration's name
// twice or its closing brace is missing, which the compiler reports instead.
func selectedModuleDeclaration(file *ast.SourceFile, span core.TextRange) *ast.Node {
	var selected *ast.Node
	for _, statement := range file.Statements.Nodes {
		if parser.IsVibeLangModuleDeclaration(statement) && scanner.SkipTrivia(file.Text(), statement.Pos()) <= span.Pos() && span.End() <= statement.End() {
			selected = statement
		}
	}
	if selected == nil || selected.Name().Text() == "" || selected.Modifiers() != nil && len(selected.Modifiers().Nodes) != 0 || selected.Body().Flags&ast.NodeFlagsThisNodeHasError != 0 {
		return nil
	}
	for _, statement := range file.Statements.Nodes {
		if statement != selected && parser.IsVibeLangModuleDeclaration(statement) && statement.Name().Text() == selected.Name().Text() {
			return nil
		}
	}
	return selected
}

// moduleFileBase returns the new file's name without its extension: one that
// names nothing beside the .vibe file, on a case-insensitive file system too.
func moduleFileBase(r *ls.RefactorContext, name string) string {
	entries := r.Program.Host().FS().GetAccessibleEntries(r.SourceFile.FileName().Directory())
	taken := func(base string) bool {
		for _, entry := range slices.Concat(entries.Files, entries.Directories) {
			if strings.EqualFold(tspath.RemoveFileExtension(entry), base) {
				return true
			}
		}
		return false
	}
	if !taken(name) {
		return name
	}
	source := r.SourceFile.FileName().BaseName()
	prefix := strings.TrimSuffix(source, tspath.VibeLangSourceExtension(source)) + "." + name
	base := prefix
	for k := 2; taken(base); k++ {
		base = prefix + strconv.Itoa(k)
	}
	return base
}

// moduleFileText returns the text of the file that holds a module body: the
// body without its surrounding blank lines and, unless a string or template
// spans lines, without the indentation its lines share. A body with no import
// or export gains export {}, so that its declarations keep module scope.
func moduleFileText(file *ast.SourceFile, declaration *ast.Node, body *ast.SourceFile) string {
	span := parser.ModuleDeclarationBody(file, declaration)
	lines := strings.Split(strings.ReplaceAll(file.Text()[span.Pos():span.End()], "\r\n", "\n"), "\n")
	for len(lines) > 0 && strings.TrimSpace(lines[0]) == "" {
		lines = lines[1:]
	}
	for len(lines) > 0 && strings.TrimSpace(lines[len(lines)-1]) == "" {
		lines = lines[:len(lines)-1]
	}
	if len(lines) > 0 {
		lines[len(lines)-1] = strings.TrimRight(lines[len(lines)-1], " \t")
	}
	if !hasMultilineLiteral(body) {
		indent := -1
		for _, line := range lines {
			if n := len(line) - len(strings.TrimLeft(line, " \t")); strings.TrimSpace(line) != "" && (indent < 0 || n < indent) {
				indent = n
			}
		}
		for i, line := range lines {
			lines[i] = line[min(indent, len(line)-len(strings.TrimLeft(line, " \t"))):]
		}
	}
	if !core.Some(body.Statements.Nodes, ast.IsExternalModuleIndicator) {
		lines = append(lines, "export {}")
	}
	return strings.Join(lines, "\n") + "\n"
}

// hasMultilineLiteral reports whether a string or template in body spans lines,
// whose text is the literal's value, so its indentation must stay.
func hasMultilineLiteral(body *ast.SourceFile) bool {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		switch node.Kind {
		case ast.KindStringLiteral, ast.KindNoSubstitutionTemplateLiteral, ast.KindTemplateHead, ast.KindTemplateMiddle, ast.KindTemplateTail:
			if strings.ContainsAny(body.Text()[scanner.SkipTrivia(body.Text(), node.Pos()):node.End()], "\r\n") {
				return true
			}
		}
		return node.ForEachChild(visit)
	}
	return body.AsNode().ForEachChild(visit)
}
