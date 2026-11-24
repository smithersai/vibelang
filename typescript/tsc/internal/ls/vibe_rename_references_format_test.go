package ls_test

import (
	"context"
	"errors"
	"fmt"
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

// projectService is a language service over files, which holds
// /project/tsconfig.json.
func projectService(t *testing.T, files map[string]string) (*ls.LanguageService, *compiler.Program, *lsconv.Converters) {
	t.Helper()
	fs := bundled.WrapFS(vfstest.FromMap(files, tspath.CaseInsensitive))
	parsed, errs := tsoptions.GetParsedCommandLineOfConfigFile("/project/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
	if len(errs) != 0 {
		t.Fatal(errs)
	}
	p := compiler.NewProgram(compiler.ProgramOptions{Config: parsed, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
	converters := lsconv.NewConverters(lsproto.PositionEncodingKindUTF16, func(name tspath.RootedFilePath) *lsconv.LSPLineMap {
		return lsconv.ComputeLSPLineStarts(files[string(name)])
	})
	return ls.NewLanguageService(nil, p, retiredModulesHost{snapshotTestHost: snapshotTestHost{converters: converters}, files: files}, "/project/doc.vibe"), p, converters
}

// Renaming or moving a .vibe file writes each importer the ending its old
// specifier had, as for the .ts file beside it: ./c.vibe in source is TS5097
// without allowImportingTsExtensions (007-tooling.md). An import that already
// writes the VibeLang suffix keeps it.
func TestFileRenameKeepsWrittenEndingOfVibeImport(t *testing.T) {
	for _, tc := range []struct {
		name, options, vibe, ts string
		from, to                string
		want                    []string
	}{
		{"nodenext/vibe-file", `"module":"nodenext"`, "./lib/b.js", "./lib/t.js", "lib/b.vibe", "lib/c.vibe", []string{"./lib/c.js"}},
		{"nodenext/ts-file", `"module":"nodenext"`, "./lib/b.js", "./lib/t.js", "lib/t.ts", "lib/u.ts", []string{"./lib/u.js"}},
		{"nodenext/directory", `"module":"nodenext"`, "./lib/b.js", "./lib/t.js", "lib", "lib2", []string{"./lib2/b.js", "./lib2/t.js"}},
		{"bundler/vibe-file", `"module":"esnext","moduleResolution":"bundler"`, "./lib/b", "./lib/t", "lib/b.vibe", "lib/c.vibe", []string{"./lib/c"}},
		{"bundler/ts-file", `"module":"esnext","moduleResolution":"bundler"`, "./lib/b", "./lib/t", "lib/t.ts", "lib/u.ts", []string{"./lib/u"}},
		{"bundler/directory", `"module":"esnext","moduleResolution":"bundler"`, "./lib/b", "./lib/t", "lib", "lib2", []string{"./lib2/b", "./lib2/t"}},
		{"bundler/written-vibe", `"module":"esnext","moduleResolution":"bundler","allowImportingTsExtensions":true,"noEmit":true`, "./lib/b.vibe", "./lib/t.ts", "lib/b.vibe", "lib/c.vibe", []string{"./lib/c.vibe"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			files := map[string]string{
				"/project/package.json":  `{"type":"module"}`,
				"/project/tsconfig.json": `{"compilerOptions":{"target":"esnext",` + tc.options + `,"strict":true,"skipLibCheck":true},"files":["doc.vibe","lib/b.vibe","lib/t.ts"]}`,
				"/project/lib/b.vibe":    "export function helper() { return 1 }\n",
				"/project/lib/t.ts":      "export function tsHelper() { return 1 }\n",
				"/project/doc.vibe":      "import { helper } from \"" + tc.vibe + "\"\nimport { tsHelper } from \"" + tc.ts + "\"\nexport const n = helper() + tsHelper()\n",
			}
			service, p, _ := projectService(t, files)
			doc := p.GetSourceFile("/project/doc.vibe")
			if diagnostics := p.GetSemanticDiagnostics(t.Context(), doc); len(diagnostics) != 0 {
				t.Fatalf("fixture: %v", diagnostics[0].String())
			}
			uri := func(name string) lsproto.DocumentUri {
				return lsconv.FileNameToDocumentURI(tspath.RootedFilePath("/project/" + name))
			}
			var got []string
			for _, change := range service.GetEditsForFileRename(t.Context(), uri(tc.from), uri(tc.to)) {
				if change.TextDocumentEdit == nil || change.TextDocumentEdit.TextDocument.Uri != uri("doc.vibe") {
					continue
				}
				for _, edit := range change.TextDocumentEdit.Edits {
					got = append(got, edit.TextEdit.NewText)
				}
			}
			slices.Sort(got)
			if !slices.Equal(got, tc.want) {
				t.Fatalf("specifiers written to doc.vibe = %q, want %q", got, tc.want)
			}
		})
	}
}

// A schema or data declaration gives one written name a value and a type.
// References and document highlights at any occurrence return the set rename
// edits there, as TypeScript returns both meanings of a class or enum name.
func TestSchemaAndDataReferencesCoverBothMeanings(t *testing.T) {
	source := "schema User { id: string }\n" +
		"data Delivery { Waiting; Sent { tracking: string } }\n" +
		"export function show(u: User, d: Delivery): string {\n" +
		"  const e = Delivery.Waiting()\n" +
		"  return match (d) { when { _tag: \"Sent\", let tracking }: tracking + u.id; default: e._tag; }\n" +
		"}\n"
	service, p, converters := projectService(t, map[string]string{
		"/project/tsconfig.json": `{"compilerOptions":{"target":"esnext","module":"esnext","moduleResolution":"bundler","noEmit":true,"strict":true,"skipLibCheck":true},"files":["doc.vibe"]}`,
		"/project/doc.vibe":      source,
	})
	file := p.GetSourceFile("/project/doc.vibe")
	uri := lsconv.FileNameToDocumentURI(file.FileName())
	for _, tc := range []struct {
		name string
		want int
	}{{"User", 2}, {"Delivery", 3}} {
		offsets := moduleOccurrenceOffsets(source, tc.name)
		if len(offsets) != tc.want {
			t.Fatalf("fixture writes %s %d times, want %d", tc.name, len(offsets), tc.want)
		}
		var want []string
		for _, offset := range offsets {
			r, _ := converters.ToLSPRange(file, core.NewTextRange(offset, offset+len(tc.name)))
			want = append(want, fmt.Sprint(r))
		}
		for i, offset := range offsets {
			t.Run(fmt.Sprintf("%s/occurrence-%d", tc.name, i), func(t *testing.T) {
				at, _ := converters.ToLSPPosition(file, core.TextPos(offset))
				document := lsproto.TextDocumentIdentifier{Uri: uri}
				renamed, err := service.ProvideRename(t.Context(), &lsproto.RenameParams{TextDocument: document, Position: at, NewName: "Fresh"}, nil)
				if err != nil {
					t.Fatal(err)
				}
				var edits []string
				if renamed.WorkspaceEdit != nil && renamed.WorkspaceEdit.Changes != nil {
					for _, edit := range (*renamed.WorkspaceEdit.Changes)[uri] {
						edits = append(edits, fmt.Sprint(edit.Range))
					}
				}
				slices.Sort(edits)
				if !slices.Equal(edits, want) {
					t.Fatalf("rename edits %v, want %v", edits, want)
				}
				refs, err := service.ProvideReferences(t.Context(), &lsproto.ReferenceParams{
					TextDocument: document, Position: at,
					Context: &lsproto.ReferenceContext{IncludeDeclaration: true},
				}, nil)
				if err != nil {
					t.Fatal(err)
				}
				var references []string
				if refs.Locations != nil {
					for _, location := range *refs.Locations {
						references = append(references, fmt.Sprint(location.Range))
					}
				}
				slices.Sort(references)
				if !slices.Equal(references, want) {
					t.Errorf("references = %v, want the rename set %v", references, want)
				}
				highlighted, err := service.ProvideDocumentHighlights(t.Context(), uri, at)
				if err != nil {
					t.Fatal(err)
				}
				var highlights []string
				if highlighted.DocumentHighlights != nil {
					for _, highlight := range *highlighted.DocumentHighlights {
						highlights = append(highlights, fmt.Sprint(highlight.Range))
					}
				}
				slices.Sort(highlights)
				if !slices.Equal(highlights, want) {
					t.Errorf("document highlights = %v, want the rename set %v", highlights, want)
				}
			})
		}
	}
}

// A TypeScript const and type alias that share a name are two written names:
// a search from one meaning keeps to it, as in TypeScript.
func TestTypeScriptConstAndAliasKeepSeparateReferences(t *testing.T) {
	source := "const Pair = 1\ntype Pair = string\nexport const p: Pair = String(Pair)\n"
	service, p, converters := projectService(t, map[string]string{
		"/project/tsconfig.json": `{"compilerOptions":{"target":"esnext","module":"esnext","moduleResolution":"bundler","noEmit":true,"strict":true,"skipLibCheck":true},"files":["doc.vibe"]}`,
		"/project/doc.vibe":      source,
	})
	file := p.GetSourceFile("/project/doc.vibe")
	at, _ := converters.ToLSPPosition(file, core.TextPos(strings.Index(source, "Pair")))
	refs, err := service.ProvideReferences(t.Context(), &lsproto.ReferenceParams{
		TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())}, Position: at,
		Context: &lsproto.ReferenceContext{IncludeDeclaration: true},
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if refs.Locations == nil || len(*refs.Locations) != 2 {
		t.Fatalf("value references = %v, want the const and its one value use", refs.Locations)
	}
}

// Range formatting of a VibeLang file changes the selected lines when lines
// outside the selection are unformatted too, and a buffer the formatter
// cannot parse yields no edits rather than an error.
func TestSharedFormatterRangeFormatsSelectedLines(t *testing.T) {
	source := "const a  =  1\nconst b  =  2\nconst c  =  3\n"
	service, _, _ := projectService(t, map[string]string{
		"/project/tsconfig.json": `{"compilerOptions":{"target":"esnext","module":"esnext","moduleResolution":"bundler","noEmit":true,"strict":true,"skipLibCheck":true},"files":["doc.vibe"]}`,
		"/project/doc.vibe":      source,
	})
	uri := lsconv.FileNameToDocumentURI(tspath.RootedFilePath("/project/doc.vibe"))
	formatter := func(context.Context, string, string) (string, error) {
		return "const a = 1\nconst b = 2\nconst c = 3\n", nil
	}
	for _, tc := range []struct {
		name      string
		selection lsproto.Range
		want      string
	}{
		{"line", lsproto.Range{Start: lsproto.Position{Line: 1}, End: lsproto.Position{Line: 1, Character: 13}}, "const a  =  1\nconst b = 2\nconst c  =  3\n"},
		{"line-and-break", lsproto.Range{Start: lsproto.Position{Line: 1}, End: lsproto.Position{Line: 2}}, "const a  =  1\nconst b = 2\nconst c  =  3\n"},
		{"two-lines", lsproto.Range{Start: lsproto.Position{Line: 1}, End: lsproto.Position{Line: 3}}, "const a  =  1\nconst b = 2\nconst c = 3\n"},
		{"formatted-part", lsproto.Range{Start: lsproto.Position{Line: 1}, End: lsproto.Position{Line: 1, Character: 5}}, source},
	} {
		t.Run(tc.name, func(t *testing.T) {
			response, err := service.ProvideFormatDocumentUsing(t.Context(), uri, formatter, &tc.selection)
			if err != nil {
				t.Fatal(err)
			}
			if response.TextEdits == nil {
				t.Fatal("no edit list")
			}
			for _, edit := range *response.TextEdits {
				if lsproto.ComparePositions(edit.Range.Start, tc.selection.Start) < 0 || lsproto.ComparePositions(edit.Range.End, tc.selection.End) > 0 {
					t.Errorf("edit %v lies outside the selection %v", edit.Range, tc.selection)
				}
			}
			if got := applyModuleEdits(source, *response.TextEdits); got != tc.want {
				t.Fatalf("formatted selection = %q, want %q", got, tc.want)
			}
		})
	}
	t.Run("whole-document", func(t *testing.T) {
		response, err := service.ProvideFormatDocumentUsing(t.Context(), uri, formatter, nil)
		if err != nil {
			t.Fatal(err)
		}
		if got := applyModuleEdits(source, *response.TextEdits); got != "const a = 1\nconst b = 2\nconst c = 3\n" {
			t.Fatalf("formatted document = %q", got)
		}
	})
	unparsable := func(context.Context, string, string) (string, error) { return "", errors.New("syntax error") }
	t.Run("unparsable-selection", func(t *testing.T) {
		line := lsproto.Range{Start: lsproto.Position{Line: 1}, End: lsproto.Position{Line: 2}}
		response, err := service.ProvideFormatDocumentUsing(t.Context(), uri, unparsable, &line)
		if err != nil {
			t.Fatalf("a bounded request on an unparsable buffer returned %v", err)
		}
		if response.TextEdits == nil || len(*response.TextEdits) != 0 {
			t.Fatalf("edits = %v, want an empty list", response.TextEdits)
		}
	})
	t.Run("unparsable-document", func(t *testing.T) {
		if _, err := service.ProvideFormatDocumentUsing(t.Context(), uri, unparsable, nil); err == nil {
			t.Fatal("a whole-document request hides the formatter's error")
		}
	})
}
