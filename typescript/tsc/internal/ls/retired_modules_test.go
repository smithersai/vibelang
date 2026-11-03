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
func TestModuleDeclarationEdits(t *testing.T) {
	for _, tc := range []struct{ name, source, old, replacement, want string }{
		{"module-name", "module text { export const n = 1 }\nimport { n } from text\nimport text\nexport { n } from text\nexport const result = n\n", "text", "fresh", "module fresh { export const n = 1 }\nimport { n } from fresh\nimport fresh\nexport { n } from fresh\nexport const result = n\n"},
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
	t.Helper()
	files := map[string]string{
		"/project/main.vibe":     source,
		"/project/tsconfig.json": `{"compilerOptions":{"target":"esnext","module":"esnext","moduleResolution":"bundler","strict":true,"skipLibCheck":true},"files":["main.vibe"]}`,
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

// VIP-40: "renaming parse renames identifier specifiers only".
// Mutate the binding, cursor occurrence and trivia; a quoted package name
// must never join the module's rename transaction.
func FuzzModuleDeclarationRename(f *testing.F) {
	for _, seed := range []string{"text", "Text", "x_1", "long_module_name"} {
		f.Add(seed, uint8(0))
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
		source := "module " + name + " { export const n = 1 }\nimport { n } from /*keep*/ " + name + "\nimport " + name + "\nexport { n } from " + name + "\nexport const quoted = \"" + name + "\"\n"
		want := "module " + replacement + " { export const n = 1 }\nimport { n } from /*keep*/ " + replacement + "\nimport " + replacement + "\nexport { n } from " + replacement + "\nexport const quoted = \"" + name + "\"\n"
		offsets := []int{len("module "), strings.Index(source, "/*keep*/ ") + len("/*keep*/ "), strings.Index(source, "\nimport "+name) + len("\nimport "), strings.Index(source, "\nexport { n } from ") + len("\nexport { n } from ")}
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
		if got := applyModuleEdits(source, changes[uri]); got != want {
			t.Fatalf("rename = %q, want %q", got, want)
		}
	})
}
