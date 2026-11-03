package ls_test

import (
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

type retiredModulesHost struct {
	trustedFixHost
	files map[string]string
}

func (h retiredModulesHost) ReadFile(name tspath.RootedFilePath) (string, bool) {
	text, ok := h.files[string(name)]
	return text, ok
}

func (h retiredModulesHost) CaseSensitivity() tspath.CaseSensitivity { return tspath.CaseInsensitive }

// VIP-40 restores editor operations on module declarations and their bodies.
// VIP-40: the editor's retired-module refusals are removed — spec-rule: docs/design/vips/0040-module-declarations.md#db90ea7e2ded1ed7
func TestModuleDeclarationEdits(t *testing.T) {
	for _, tc := range []struct{ name, source, old, replacement, want string }{
		{"module-name", "module text { export const n = 1 }\nimport { n } from text\nimport text\nexport { n } from text\nexport const result = n\n", "text", "fresh", "module fresh { export const n = 1 }\nimport { n } from fresh\nimport fresh\nexport { n } from fresh\nexport const result = n\n"},
		{"escaped-reference", "module text { export const n = 1 }\nimport { n } from \\u0074ext\nexport const result = n\n", "text", "fresh", "module fresh { export const n = 1 }\nimport { n } from fresh\nexport const result = n\n"},
		{"body-export", "module text { export const n = 1 }\nimport { n } from text\nexport const result = n\n", "n =", "count", "module text { export const count = 1 }\nimport { count } from text\nexport const result = count\n"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			service, p, converters := moduleEditorService(t, tc.source)
			file := p.GetSourceFile("/project/main.vibe")
			pos, _ := converters.ToLSPPosition(file, core.TextPos(strings.Index(tc.source, tc.old)))
			uri := lsconv.FileNameToDocumentURI(file.FileName())
			if info := service.GetRenameInfo(t.Context(), tc.replacement, uri, pos); !info.CanRename {
				t.Error("prepareRename blocked")
			}
			response, err := service.ProvideRename(t.Context(), &lsproto.RenameParams{TextDocument: lsproto.TextDocumentIdentifier{Uri: uri}, Position: pos, NewName: tc.replacement}, nil)
			if err != nil {
				t.Fatal(err)
			}
			if response.WorkspaceEdit == nil || response.WorkspaceEdit.Changes == nil {
				t.Fatal("no rename edits")
			}
			changes := *response.WorkspaceEdit.Changes
			if len(changes) != 1 {
				t.Fatalf("rename leaked virtual files: %v", changes)
			}
			if got := applyModuleEdits(tc.source, changes[uri]); got != tc.want {
				t.Errorf("rename = %q, want %q", got, tc.want)
			}
		})
	}
	t.Run("organize", func(t *testing.T) {
		source := "module text { export const n = 1; export const unused = 2 }\nimport { unused, n } from text\nexport const result = n\n"
		service, p, _ := moduleEditorService(t, source)
		edits := service.OrganizeImports(t.Context(), p.GetSourceFile("/project/main.vibe"), p, lsproto.CodeActionKindSourceOrganizeImportsTs)
		if len(edits) != 1 {
			t.Fatalf("organize edits = %v", edits)
		}
		got := applyModuleEdits(source, edits["/project/main.vibe"])
		if !strings.Contains(got, "import { n } from text") || strings.Contains(got, ".vibe.text.js") {
			t.Errorf("organize = %q", got)
		}
		if !strings.HasPrefix(got, strings.Split(source, "\n")[0]) {
			t.Errorf("organize changed body: %q", got)
		}
	})
}

func moduleEditorService(t *testing.T, source string) (*ls.LanguageService, *compiler.Program, *lsconv.Converters) {
	return moduleEditorServiceFiles(t, source, nil)
}

func moduleEditorServiceFiles(t *testing.T, source string, extra map[string]string) (*ls.LanguageService, *compiler.Program, *lsconv.Converters) {
	t.Helper()
	files := map[string]string{
		"/project/main.vibe":     source,
		"/project/tsconfig.json": `{"compilerOptions":{"target":"esnext","module":"esnext","moduleResolution":"bundler","strict":true,"skipLibCheck":true},"files":["main.vibe"]}`,
	}
	for name, text := range extra {
		files[name] = text
	}
	fs := bundled.WrapFS(vfstest.FromMap(files, tspath.CaseInsensitive))
	parsed, errors := tsoptions.GetParsedCommandLineOfConfigFile("/project/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 {
		t.Fatal(errors)
	}
	p := compiler.NewProgram(compiler.ProgramOptions{Config: parsed, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
	converters := lsconv.NewConverters(lsproto.PositionEncodingKindUTF16, func(name tspath.RootedFilePath) *lsconv.LSPLineMap {
		return lsconv.ComputeLSPLineStarts(files[string(name)])
	})
	return ls.NewLanguageService(nil, p, retiredModulesHost{trustedFixHost: trustedFixHost{converters: converters}, files: files}, "/project/main.vibe"), p, converters
}

// These fixtures are ASCII, so LSP UTF-16 columns equal byte columns.
func applyModuleEdits(source string, edits []*lsproto.TextEdit) string {
	offset := func(pos lsproto.Position) int {
		n := 0
		lines := strings.Split(source, "\n")
		for i := 0; i < int(pos.Line); i++ {
			n += len(lines[i]) + 1
		}
		return n + int(pos.Character)
	}
	edits = slices.Clone(edits)
	slices.SortFunc(edits, func(a, b *lsproto.TextEdit) int { return offset(b.Range.Start) - offset(a.Range.Start) })
	out := source
	for _, edit := range edits {
		out = out[:offset(edit.Range.Start)] + edit.NewText + out[offset(edit.Range.End):]
	}
	return out
}

// Ordinary TypeScript namespaces retain their editor operations.
func TestOrdinaryModuleEdits(t *testing.T) {
	source := "import { unused } from \"./dep\";\nnamespace text { export const n = 1 }\nexport const result = text.n;\n"
	files := map[string]string{
		"/project/main.ts":       source,
		"/project/dep.ts":        "export const unused = 0;\n",
		"/project/tsconfig.json": `{"compilerOptions":{"target":"esnext"},"files":["main.ts","dep.ts"]}`,
	}
	fs := bundled.WrapFS(vfstest.FromMap(files, tspath.CaseInsensitive))
	parsed, errors := tsoptions.GetParsedCommandLineOfConfigFile("/project/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 {
		t.Fatal(errors)
	}
	p := compiler.NewProgram(compiler.ProgramOptions{Config: parsed, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
	converters := lsconv.NewConverters(lsproto.PositionEncodingKindUTF16, func(name tspath.RootedFilePath) *lsconv.LSPLineMap {
		return lsconv.ComputeLSPLineStarts(files[string(name)])
	})
	service := ls.NewLanguageService(nil, p, retiredModulesHost{trustedFixHost: trustedFixHost{converters: converters}, files: files}, "/project/main.ts")
	file := p.GetSourceFile("/project/main.ts")
	if edits := service.OrganizeImports(t.Context(), file, p, lsproto.CodeActionKindSourceOrganizeImportsTs); len(edits) == 0 {
		t.Error("ordinary organize imports was blocked")
	}
	pos, _ := converters.ToLSPPosition(file, core.TextPos(strings.Index(source, "text")))
	uri := lsconv.FileNameToDocumentURI(file.FileName())
	if info := service.GetRenameInfo(t.Context(), "fresh", uri, pos); !info.CanRename {
		t.Error("ordinary namespace rename was blocked")
	}
	response, err := service.ProvideRename(t.Context(), &lsproto.RenameParams{TextDocument: lsproto.TextDocumentIdentifier{Uri: uri}, Position: pos, NewName: "fresh"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if response.WorkspaceEdit == nil || response.WorkspaceEdit.Changes == nil || len(*response.WorkspaceEdit.Changes) == 0 {
		t.Error("ordinary namespace rename has no edits")
	}
}

// VIP-40: "renaming `parse` renames identifier specifiers only".
// Mutate the binding, cursor occurrence and trivia; a quoted string
// must never join the module's rename transaction.
func FuzzModuleDeclarationRename(f *testing.F) {
	// The final byte seed normalizes to the contextual identifier module.
	for _, seed := range []string{"text", "Text", "x_1", "long_module_name", "\x0e\x03\x14\x0b\x04"} {
		for _, cursor := range []uint8{0, 5, 10, 15} {
			f.Add(seed, cursor)
		}
	}
	f.Fuzz(func(t *testing.T, raw string, cursor uint8) {
		if len(raw) > 32 {
			return
		}
		name := "m"
		for _, ch := range []byte(raw) {
			name += string("abcdefghijklmnopqrstuvwxyz_"[int(ch)%27])
		}
		replacement := "fresh_" + name
		declaration, reference := name, name
		if cursor&4 != 0 {
			reference = "\\u006d" + name[1:]
		}
		if cursor&8 != 0 {
			declaration = "\\u006d" + name[1:]
		}

		source := "module " + declaration + " { export const n = 1 }\nimport { n } from /*keep*/ " + reference + "\nimport " + reference + "\nexport { n } from " + reference + "\nexport const quoted = \"" + name + "\"\n"
		want := "module " + replacement + " { export const n = 1 }\nimport { n } from /*keep*/ " + replacement + "\nimport " + replacement + "\nexport { n } from " + replacement + "\nexport const quoted = \"" + name + "\"\n"
		offsets := []int{len("module "), strings.Index(source, "/*keep*/ ") + len("/*keep*/ "), strings.Index(source, "\nimport "+reference) + len("\nimport "), strings.Index(source, "\nexport { n } from ") + len("\nexport { n } from ")}
		service, p, converters := moduleEditorService(t, source)
		file := p.GetSourceFile("/project/main.vibe")
		pos, _ := converters.ToLSPPosition(file, core.TextPos(offsets[int(cursor)%4]))
		uri := lsconv.FileNameToDocumentURI(file.FileName())
		response, err := service.ProvideRename(t.Context(), &lsproto.RenameParams{TextDocument: lsproto.TextDocumentIdentifier{Uri: uri}, Position: pos, NewName: replacement}, nil)
		if err != nil {
			t.Fatal(err)
		}
		if response.WorkspaceEdit == nil || response.WorkspaceEdit.Changes == nil {
			t.Fatal("no rename edits")
		}
		changes := *response.WorkspaceEdit.Changes
		if len(changes) != 1 {
			t.Fatalf("rename leaked virtual paths: %v", changes)
		}
		for _, include := range []bool{false, true} {
			refs, err := service.ProvideReferences(t.Context(), &lsproto.ReferenceParams{TextDocument: lsproto.TextDocumentIdentifier{Uri: uri}, Position: pos, Context: &lsproto.ReferenceContext{IncludeDeclaration: include}}, nil)
			if err != nil || refs.Locations == nil {
				t.Fatalf("references: %v, %v", refs, err)
			}
			wantCount := len(changes[uri])
			if !include {
				wantCount--
			}
			if len(*refs.Locations) != wantCount {
				t.Fatalf("references includeDeclaration=%v: got %v, want %d", include, *refs.Locations, wantCount)
			}
			for _, loc := range *refs.Locations {
				if loc.Uri != uri || !slices.ContainsFunc(changes[uri], func(edit *lsproto.TextEdit) bool { return edit.Range == loc.Range }) {
					t.Fatalf("reference is not a rename occurrence: %v", loc)
				}
			}
		}
		if got := applyModuleEdits(source, changes[uri]); got != want {
			t.Fatalf("rename = %q, want %q", got, want)
		}
	})
}

// VIP-40: "The name is a lexical binding of the file." A type-only import
// with the same spelling remains a separate TypeScript type binding.
func TestTypeOnlyImportModuleRename(t *testing.T) {
	for _, name := range []string{"M", "Text", "shape"} {
		t.Run(name, func(t *testing.T) { checkTypeOnlyImportModuleRename(t, name) })
	}
}

func FuzzTypeOnlyImportModuleRename(f *testing.F) {
	for _, raw := range []string{"M", "Text", "shape", "long_name"} {
		f.Add(raw)
	}
	f.Fuzz(func(t *testing.T, raw string) {
		if len(raw) > 24 {
			return
		}
		name := "M"
		for _, ch := range []byte(raw) {
			name += string("abcdefghijklmnopqrstuvwxyz_"[int(ch)%27])
		}
		checkTypeOnlyImportModuleRename(t, name)
	})
}

func checkTypeOnlyImportModuleRename(t *testing.T, name string) {
	t.Helper()
	source := "import type { " + name + " } from \"./other.ts\"\nmodule " + name + " { export const n = 0 }\nimport { n } from " + name + "\nexport type Shape = " + name + "\nexport const result = n\n"
	service, p, converters := moduleEditorServiceFiles(t, source, map[string]string{"/project/other.ts": "export interface " + name + " {}\n"})
	file := p.GetSourceFile("/project/main.vibe")
	pos, _ := converters.ToLSPPosition(file, core.TextPos(strings.Index(source, "{ "+name)+2))
	uri := lsconv.FileNameToDocumentURI(file.FileName())
	replacement := "Fresh" + name
	refs, err := service.ProvideReferences(t.Context(), &lsproto.ReferenceParams{TextDocument: lsproto.TextDocumentIdentifier{Uri: uri}, Position: pos, Context: &lsproto.ReferenceContext{IncludeDeclaration: true}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	modulePos, _ := converters.ToLSPPosition(file, core.TextPos(strings.Index(source, "module ")+len("module ")))
    if refs.Locations == nil || !slices.ContainsFunc(*refs.Locations, func(loc lsproto.Location) bool { return loc.Uri == uri && loc.Range.Start == modulePos }) {
        t.Error("merged type references lost the module declaration")
    }

	highlights, err := service.ProvideDocumentHighlights(t.Context(), uri, pos)
	if err != nil {
		t.Fatal(err)
	}
	if highlights.DocumentHighlights != nil {
		for _, h := range *highlights.DocumentHighlights {
			if h.Range.Start == modulePos {
				t.Error("type highlight includes independent module declaration")
			}
		}
	}
	moduleRefs, err := service.ProvideReferences(t.Context(), &lsproto.ReferenceParams{TextDocument: lsproto.TextDocumentIdentifier{Uri: uri}, Position: modulePos, Context: &lsproto.ReferenceContext{IncludeDeclaration: true}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	moduleHighlights, err := service.ProvideDocumentHighlights(t.Context(), uri, modulePos)
	if err != nil {
		t.Fatal(err)
	}
	if moduleRefs.Locations == nil || moduleHighlights.DocumentHighlights == nil || len(*moduleRefs.Locations) != len(*moduleHighlights.DocumentHighlights) {
		t.Errorf("module highlights do not match module references: %v, %v", moduleRefs, moduleHighlights)
	} else {
		for _, h := range *moduleHighlights.DocumentHighlights {
			if !slices.ContainsFunc(*moduleRefs.Locations, func(loc lsproto.Location) bool { return loc.Uri == uri && loc.Range == h.Range }) {
				t.Errorf("module highlight crossed type binding: %v", h)
			}
		}
	}
	response, err := service.ProvideRename(t.Context(), &lsproto.RenameParams{TextDocument: lsproto.TextDocumentIdentifier{Uri: uri}, Position: pos, NewName: replacement}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if response.WorkspaceEdit == nil || response.WorkspaceEdit.Changes == nil {
		t.Fatal("no type import rename edits")
	}
	changes := *response.WorkspaceEdit.Changes
	got := applyModuleEdits(source, changes[uri])
	if !strings.Contains(got, "module "+replacement+" {") || !strings.Contains(got, "from "+replacement+"\n") {
		t.Errorf("merged type rename left a dangling module specifier: %q", got)
	}
	if !strings.Contains(got, "export type Shape = "+replacement+"\n") {
		t.Errorf("type use was not renamed: %q", got)
	}
	if len(changes) != 1 {
		t.Errorf("local type rename changed other files: %v", changes)
	}
}
