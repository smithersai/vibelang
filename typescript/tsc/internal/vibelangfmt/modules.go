package vibelangfmt

import (
	"fmt"
	"slices"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// Module declarations (D283). module text { ... } is TypeScript syntax as
// well, a namespace declaration, so its head passes through the TypeScript
// form as written and dprint indents the body inside its braces. dprint
// formats a namespace's statements as it formats a file's, except that it
// does not sort their imports and exports, so Format first formats each body
// as a .ts file of its own and writes the result between the braces. The
// body is TypeScript and holds no VibeLang forms. An identifier module
// specifier, from text, is written as the string "./$vtext", which dprint
// formats as a string and decodes back to text, without reordering imports.

// moduleBody is the body of a module declaration: the text between its braces.
type moduleBody struct {
	name string
	body core.TextRange
}

// checkModules reports what keeps the module declarations of file, a parse
// of source, from formatting: a syntax error in a body, and a declaration
// whose body has no tree of its own to check the result against, which is
// one below the file's top level or a second one of a name.
func checkModules(file *ast.SourceFile, source string) error {
	bodies := map[*ast.Node]*ast.SourceFile{}
	for _, module := range file.EmbeddedModules() {
		bodies[module.EmbeddedModule().Declaration] = module
	}
	at := func(node *ast.Node, format string, args ...any) error {
		line, column := lineColumn(source, scanner.SkipTrivia(source, node.Pos()))
		return fmt.Errorf("vibelang format: %d:%d: "+format, append([]any{line, column}, args...)...)
	}
	seen := map[string]bool{}
	for _, statement := range file.Statements.Nodes {
		if !parser.IsVibeLangModuleDeclaration(statement) {
			continue
		}
		name := statement.Name().Text()
		if name == "" {
			return at(statement, "a module declaration needs a name")
		}
		suffix := parser.ModuleDeclarationFileSuffix(name)
		if seen[suffix] {
			return at(statement, "module %s is declared twice", name)
		}
		seen[suffix] = true
		body := bodies[statement]
		if body == nil {
			return at(statement, "internal error: module %s has no body file", name)
		}
		if diagnostics := body.Diagnostics(); len(diagnostics) != 0 {
			line, column := lineColumn(source, diagnostics[0].Pos())
			return fmt.Errorf("vibelang format: %d:%d: module %s: %s", line, column, name, diagnostics[0].String())
		}
	}
	var nested *ast.Node
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if parser.IsVibeLangModuleDeclaration(node) && node.Parent.Kind != ast.KindSourceFile {
			nested = node
			return true
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	if nested != nil && nested.Name().Text() == "" {
		return at(nested, "a module declaration needs a name")
	}
	if nested != nil {
		return at(nested, "module %s is not at the file's top level", nested.Name().Text())
	}
	return nil
}

// formatModules formats each module body of source as a .ts file of its own
// and writes the result between the module's braces, one statement per line
// from the line after the open brace; the file's own pass indents it.
func formatModules(source string, modules []moduleBody, formatter TypeScriptFormatter) (string, error) {
	modules = slices.Clone(modules)
	slices.SortFunc(modules, func(a, b moduleBody) int { return a.body.Pos() - b.body.Pos() })
	var out strings.Builder
	cursor := 0
	for _, module := range modules {
		formatted, err := formatter(source[module.body.Pos():module.body.End()])
		if err != nil {
			return "", fmt.Errorf("vibelang format: the TypeScript formatter failed on module %s: %w", module.name, err)
		}
		// The body starts on the line after the open brace, which is written
		// here, so its own leading line breaks go: a formatter that answers
		// "unchanged", as a dprint host without a TypeScript plugin does,
		// returns them as written.
		newline := "\n"
		lineText := formatted
		if !strings.Contains(lineText, "\n") {
			lineText = source
		}
		if first := strings.IndexByte(lineText, '\n'); first > 0 && lineText[first-1] == '\r' {
			newline = "\r\n"
		}
		formatted = strings.TrimLeft(formatted, "\r\n")
		out.WriteString(source[cursor:module.body.Pos()])
		if strings.TrimSpace(formatted) != "" {
			out.WriteString(newline)
			out.WriteString(formatted)
			if !strings.HasSuffix(formatted, "\n") {
				out.WriteString(newline)
			}
		}
		cursor = module.body.End()
	}
	out.WriteString(source[cursor:])
	return out.String(), nil
}

// moduleSpecifierString returns the string that stands for name, an identifier
// module specifier: ./, the placeholder prefix, which no string of the file
// contains, and name as written.
func moduleSpecifierString(sentinel, name string) string { return "\"./" + sentinel + name + "\"" }

// moduleReference decodes the string that stands for an identifier module
// specifier, if node is one.
func (d *decoder) moduleReference(node *ast.Node) error {
	start, end := d.start(node), node.End()
	if end-start < 2 {
		return nil
	}
	raw := d.text[start+1 : end-1]
	prefix := "./" + d.enc.sentinel
	if !strings.HasPrefix(raw, prefix) {
		return nil
	}
	if !isModuleSpecifier(node) {
		return fmt.Errorf("vibelang format: internal error: the module specifier %s lost its place", raw[len(prefix):])
	}
	d.replace(start, end, raw[len(prefix):])
	d.references++
	return nil
}

// isModuleSpecifier reports whether node is the module specifier of an
// import or export declaration or of require.
func isModuleSpecifier(node *ast.Node) bool {
	parent := node.Parent
	switch parent.Kind {
	case ast.KindImportDeclaration:
		return parent.AsImportDeclaration().ModuleSpecifier == node
	case ast.KindExportDeclaration:
		return parent.AsExportDeclaration().ModuleSpecifier == node
	case ast.KindExternalModuleReference:
		return parent.Expression() == node
	}
	return false
}

// sameModules reports how the module bodies of after, a parse of the
// formatted file, differ from those of before.
func (c *comparer) sameModules(before, after *ast.SourceFile) error {
	a, b := before.EmbeddedModules(), after.EmbeddedModules()
	if len(a) != len(b) {
		return fmt.Errorf("%d module bodies became %d", len(a), len(b))
	}
	for i := range a {
		name := a[i].EmbeddedModule().Name
		if diagnostics := b[i].Diagnostics(); len(diagnostics) != 0 && len(a[i].Diagnostics()) == 0 {
			return fmt.Errorf("module %s: %w", name, syntaxError(c.after, diagnostics[0]))
		}
		if err := c.same(a[i].AsNode(), b[i].AsNode()); err != nil {
			return fmt.Errorf("module %s: %w", name, err)
		}
	}
	return nil
}
