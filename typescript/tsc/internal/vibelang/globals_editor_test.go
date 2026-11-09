package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/astnav"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// definitionURIs returns the documents that go to definition at position
// opens.
func definitionURIs(t *testing.T, service *ls.LanguageService, uri lsproto.DocumentUri, position lsproto.Position) []string {
	t.Helper()
	response, err := service.ProvideDefinition(t.Context(), uri, position)
	if err != nil {
		t.Fatal(err)
	}
	var uris []string
	switch {
	case response.Location != nil:
		uris = append(uris, string(response.Location.Uri))
	case response.Locations != nil:
		for _, location := range *response.Locations {
			uris = append(uris, string(location.Uri))
		}
	case response.DefinitionLinks != nil:
		for _, link := range *response.DefinitionLinks {
			uris = append(uris, string(link.TargetUri))
		}
	}
	return uris
}

// positionOf returns the editor position of the first occurrence of text in
// source, plus offset characters.
func positionOf(source, text string, offset int) lsproto.Position {
	at := strings.Index(source, text) + offset
	line := strings.Count(source[:at], "\n")
	return lsproto.Position{Line: uint32(line), Character: uint32(at - strings.LastIndex(source[:at], "\n") - 1)}
}

// D310: a subpath module is in scope without an import. Completions offer
// the modules of every package the program loads, and hover and go to
// definition reach the module's declarations.
func TestEditorSubpathModules(t *testing.T) {
	source := "export function hex(bytes: Uint8Array) {\n  return Hex.encode(bytes)\n}\n"
	program, file, _, converters := editorProgram(t, source)
	// The definition of a library name follows its declaration source maps,
	// which reads files through the host.
	service := ls.NewLanguageService(nil, program, programEditorHost{program: program, converters: converters}, file.FileName().AsString())
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Category() == diagnostics.CategoryError {
			t.Fatalf("source: %s", d.String())
		}
	}
	c, done := program.GetTypeCheckerForFile(t.Context(), file)
	names := map[string]bool{}
	for _, symbol := range preludeCompletions(c, astnav.GetTouchingToken(file, strings.Index(source, "return")), ast.SymbolFlagsValue) {
		names[symbol.Name()] = true
	}
	done()
	for _, name := range []string{"Hex", "Base64", "Yaml", "Console"} {
		if !names[name] {
			t.Errorf("completions lack %s", name)
		}
	}
	uri := lsconv.FileNameToDocumentURI(file.FileName())
	if text := hoverText(t, service, uri, positionOf(source, "Hex.", 1)); !strings.Contains(text, "Hex") {
		t.Errorf("hover on Hex = %q", text)
	}
	uris := definitionURIs(t, service, uri, positionOf(source, "Hex.", 1))
	if len(uris) == 0 || !strings.HasSuffix(uris[0], "/encoding/Hex.d.ts") {
		t.Errorf("definition of Hex = %v, want effect's encoding/Hex.d.ts", uris)
	}
	uris = definitionURIs(t, service, uri, positionOf(source, "encode", 1))
	if len(uris) == 0 || !strings.HasSuffix(uris[0], "/encoding/Hex.d.ts") {
		t.Errorf("definition of Hex.encode = %v, want effect's encoding/Hex.d.ts", uris)
	}
}
