package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// moduleRefactorProgram is editorProgram for a source named name, main.vibe
// or main.vibex, compiled with compilerOptions (a JSON object's members).
func moduleRefactorProgram(t *testing.T, name, source, compilerOptions string) (*ast.SourceFile, *ls.LanguageService, *lsconv.Converters) {
	t.Helper()
	dir := t.TempDir()
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(dir, "node_modules"), 0755); err != nil {
		t.Fatal(err)
	}
	for pkg, target := range editorPackages {
		if _, err := os.Stat(filepath.Join(root, target)); err != nil {
			t.Fatalf("editor fixture package %q is unavailable: %v; run sh scripts/setup.sh", pkg, err)
		}
		if err := os.Symlink(filepath.Join(root, target), filepath.Join(dir, "node_modules", pkg)); err != nil {
			t.Fatal(err)
		}
	}
	for file, text := range map[string]string{
		"package.json":  editorPackageJSON,
		"tsconfig.json": `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true` + compilerOptions + `},"files":["` + name + `"]}`,
		name:            source,
	} {
		if err := os.WriteFile(filepath.Join(dir, file), []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	fs := bundled.WrapFS(osvfs.FS())
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 || len(config.Errors) != 0 {
		t.Fatalf("config: %v %v", errors, config.Errors)
	}
	program := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
	file := program.GetSourceFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, name))))
	if file == nil {
		t.Fatalf("no source file %s", name)
	}
	converters := lsconv.NewConverters(lsproto.PositionEncodingKindUTF16, func(name tspath.RootedFilePath) *lsconv.LSPLineMap {
		text, ok := fs.ReadFile(name)
		if !ok {
			t.Fatalf("missing editor document %s", name)
		}
		return lsconv.ComputeLSPLineStarts(text)
	})
	return file, ls.NewLanguageService(nil, program, editorTestHost{converters: converters}, string(file.FileName())), converters
}

// rule-evidence: docs/design/src/001-functions.md#module-declarations | The TypeScript twin and the move refactor use `.ts` for a body in `.vibe` and `.tsx` for one in `.vibex`, preserving its source language variant even when the body has no JSX.
// rule-evidence: docs/design/src/001-functions.md#module-declarations | In that file, add `export {}` if the unchanged body would otherwise be a script under the project's options.
func TestMoveModuleRefactorKeepsSourceVariantAndModuleClassification(t *testing.T) {
	for _, tc := range []struct{ name, file, options, source, want, body, target string }{
		{"vibex body without JSX", "main.vibex", `,"jsx":"react-jsx"`,
			"module /*cursor*/parse { export const n = 1 }\nexport { n } from parse\n",
			"export { n } from \"./parse.js\"\n", "export const n = 1\n", "parse.tsx"},
		{"vibex body with JSX", "main.vibex", `,"jsx":"preserve"`,
			"module /*cursor*/view { export const v = <div /> }\nexport { v } from view\n",
			"export { v } from \"./view.js\"\n", "export const v = <div />\n", "view.tsx"},
		{"vibex under rewriteRelativeImportExtensions", "main.vibex", `,"jsx":"react-jsx","rewriteRelativeImportExtensions":true`,
			"module /*cursor*/parse { export const n = 1 }\nexport { n } from parse\n",
			"export { n } from \"./parse.tsx\"\n", "export const n = 1\n", "parse.tsx"},
		{"vibe body", "main.vibe", "",
			"module /*cursor*/parse { export const n = 1 }\nexport { n } from parse\n",
			"export { n } from \"./parse.js\"\n", "export const n = 1\n", "parse.ts"},
		{"vibe under rewriteRelativeImportExtensions", "main.vibe", `,"rewriteRelativeImportExtensions":true`,
			"module /*cursor*/parse { export const n = 1 }\nexport { n } from parse\n",
			"export { n } from \"./parse.ts\"\n", "export const n = 1\n", "parse.ts"},
		// NodeNext defaults moduleDetection to force, so these copied bodies
		// are modules without a marker. The legacy-mode case needs one.
		{"script body in a file with a side-effect import", "main.vibe", "",
			"import \"./side.js\"\nmodule /*cursor*/parse { const hidden = 1 }\nimport parse\n",
			"import \"./side.js\"\nimport \"./parse.js\"\n", "const hidden = 1\n", "parse.ts"},
		{"script body in vibex", "main.vibex", `,"jsx":"preserve"`,
			"module /*cursor*/parse { const hidden = 1 }\nimport parse\n",
			"import \"./parse.js\"\n", "const hidden = 1\n", "parse.tsx"},
		{"script body under legacy moduleDetection", "main.vibe", `,"moduleDetection":"legacy"`,
			"module /*cursor*/parse { const hidden = 1 }\nimport parse\n",
			"import \"./parse.js\"\n", "const hidden = 1\nexport {}\n", "parse.ts"},
		{"script body under force moduleDetection", "main.vibe", `,"moduleDetection":"force"`,
			"module /*cursor*/parse { const hidden = 1 }\nimport parse\n",
			"import \"./parse.js\"\n", "const hidden = 1\n", "parse.ts"},
		{"script body under auto moduleDetection", "main.vibe", `,"moduleDetection":"auto"`,
			"module /*cursor*/parse { const hidden = 1 }\nimport parse\n",
			"import \"./parse.js\"\n", "const hidden = 1\n", "parse.ts"},
		// A body that is a module by its own syntax gains nothing.
		{"side-effect import body", "main.vibe", "",
			"module /*cursor*/parse {\n  import \"./side.js\"\n  const hidden = 1\n}\nimport parse\n",
			"import \"./parse.js\"\n", "import \"./side.js\"\nconst hidden = 1\n", "parse.ts"},
		{"import type body", "main.vibe", "",
			"module /*cursor*/parse {\n  import type { Thing } from \"./thing.js\"\n  const hidden: Thing | 1 = 1\n}\nimport parse\n",
			"import \"./parse.js\"\n", "import type { Thing } from \"./thing.js\"\nconst hidden: Thing | 1 = 1\n", "parse.ts"},
		{"written export {} body", "main.vibe", "",
			"module /*cursor*/parse {\n  const hidden = 1\n  export {}\n}\nimport parse\n",
			"import \"./parse.js\"\n", "const hidden = 1\nexport {}\n", "parse.ts"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			offset := strings.Index(tc.source, "/*cursor*/")
			source := strings.Replace(tc.source, "/*cursor*/", "", 1)
			file, service, converters := moduleRefactorProgram(t, tc.file, source, tc.options)
			pos, _ := converters.ToLSPPosition(file, core.TextPos(offset))
			uri := lsconv.FileNameToDocumentURI(file.FileName())
			only := []lsproto.CodeActionKind{lsproto.CodeActionKindRefactorRewrite}
			response, err := service.ProvideCodeActions(moveModuleContext(t.Context()), &lsproto.CodeActionParams{
				TextDocument: lsproto.TextDocumentIdentifier{Uri: uri}, Range: lsproto.Range{Start: pos, End: pos},
				Context: &lsproto.CodeActionContext{Only: &only},
			})
			if err != nil {
				t.Fatal(err)
			}
			var chosen *lsproto.CodeAction
			var available []string
			if response.CommandOrCodeActionArray != nil {
				for _, action := range *response.CommandOrCodeActionArray {
					if action.CodeAction != nil {
						available = append(available, action.CodeAction.Title)
					}
					if action.CodeAction != nil && action.CodeAction.Title == moveModuleTitle {
						chosen = action.CodeAction
					}
				}
			}
			if chosen == nil || chosen.Edit == nil || chosen.Edit.DocumentChanges == nil {
				t.Fatalf("missing %q refactor: %+v; available %q", moveModuleTitle, chosen, available)
			}
			created := lsproto.DocumentUri("")
			textByURI := map[lsproto.DocumentUri][]*lsproto.TextEdit{}
			for _, change := range *chosen.Edit.DocumentChanges {
				if change.CreateFile != nil {
					created = change.CreateFile.Uri
				}
				if change.TextDocumentEdit != nil {
					for _, edit := range change.TextDocumentEdit.Edits {
						textByURI[change.TextDocumentEdit.TextDocument.Uri] = append(textByURI[change.TextDocumentEdit.TextDocument.Uri], edit.TextEdit)
					}
				}
			}
			target := lsconv.FileNameToDocumentURI(file.FileName().Directory().ResolveFile(tc.target))
			if created != target {
				t.Fatalf("created %s, want %s", created, target)
			}
			if got := applyEditorEdits(t, file, converters, textByURI[uri]); got != tc.want {
				t.Fatalf("source:\n%s\nwant:\n%s", got, tc.want)
			}
			if edits := textByURI[target]; len(edits) != 1 {
				t.Fatalf("body edits: %d; want one %q", len(edits), tc.body)
			} else if edits[0].NewText != tc.body {
				t.Fatalf("body: %q; want %q", edits[0].NewText, tc.body)
			}
		})
	}
}
