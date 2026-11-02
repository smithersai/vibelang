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
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsutil"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
	_ "github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

// trustedFixHost supplies the snapshot conversion used by the real LS action.
// Other Host methods are deliberately absent: a diagnostic quick fix needs no IO.
type trustedFixHost struct {
	ls.Host
	converters *lsconv.Converters
}

func (h trustedFixHost) Converters() *lsconv.Converters { return h.converters }
func (h trustedFixHost) GetPreferences(string) lsutil.UserPreferences {
	return lsutil.UserPreferences{}
}

// trustedActions requests EK4406 fixes through the public language service so
// the test exercises document URIs and WorkspaceEdit conversion, not just plans.
func trustedActions(t *testing.T, files map[string]string) []*lsproto.CodeAction {
	t.Helper()
	fs := bundled.WrapFS(vfstest.FromMap(files, tspath.CaseInsensitive))
	parsed, errors := tsoptions.GetParsedCommandLineOfConfigFile("/Users/x/src/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 {
		t.Fatalf("config: %v", errors)
	}
	p := compiler.NewProgram(compiler.ProgramOptions{Config: parsed, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
	converters := lsconv.NewConverters(lsproto.PositionEncodingKindUTF16, func(name tspath.RootedFilePath) *lsconv.LSPLineMap {
		return lsconv.ComputeLSPLineStarts(files[string(name)])
	})
	service := ls.NewLanguageService(nil, p, trustedFixHost{converters: converters}, "/Users/x/src/main.vibe")
	file := p.GetSourceFile("/Users/x/src/main.vibe")
	for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
		if d.Code() != 4406 {
			continue
		}
		diag := lsconv.DiagnosticToLSPPush(t.Context(), converters, d)
		only := []lsproto.CodeActionKind{lsproto.CodeActionKindQuickFix}
		response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
			TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())},
			Range:        diag.Range,
			Context:      &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{diag}, Only: &only},
		})
		if err != nil {
			t.Fatal(err)
		}
		var actions []*lsproto.CodeAction
		if response.CommandOrCodeActionArray != nil {
			for _, a := range *response.CommandOrCodeActionArray {
				if a.CodeAction != nil {
					actions = append(actions, a.CodeAction)
				}
			}
		}
		return actions
	}
	t.Fatal("fixture has no EK4406 diagnostic")
	return nil
}

// applyTrustedAction applies each URI's edits to its own document, reproducing
// the editor transaction that previously rewrote only the caller successfully.
func applyTrustedAction(t *testing.T, files map[string]string, action *lsproto.CodeAction) {
	t.Helper()
	for uri, edits := range *action.Edit.Changes {
		if !strings.HasPrefix(string(uri), "file:///") {
			t.Fatalf("malformed document URI %q", uri)
		}
		name := string(uri.FileName())
		text, ok := files[name]
		if !ok {
			t.Fatalf("edit targets missing document %q", uri)
		}
		offset := func(pos lsproto.Position) int {
			start := 0
			for range pos.Line {
				i := strings.IndexByte(text[start:], '\n')
				if i < 0 {
					t.Fatal("invalid line")
				}
				start += i + 1
			}
			return start + int(pos.Character)
		}
		edits = slices.Clone(edits)
		slices.SortFunc(edits, func(a, b *lsproto.TextEdit) int { return offset(b.Range.Start) - offset(a.Range.Start) })
		for _, edit := range edits {
			start, end := offset(edit.Range.Start), offset(edit.Range.End)
			text = text[:start] + edit.NewText + text[end:]
		}
		files[name] = text
	}
}

// TestTrustedFixAcrossFiles checks valid file URIs, direct imports, aliases,
// idempotence across two call sites, and conservative refusal of barrel imports.
func TestTrustedFixAcrossFiles(t *testing.T) {
	t.Parallel()
	const helper = `export class Bad extends Error {}
/** @vibelang trusted
 * @throws {Bad}
 */
export function parse(text: string, ...rest: string[]) { return text.length + rest.length }
`
	for _, test := range []struct {
		name, extra, caller string
		barrel              bool
	}{
		{name: "new import"},
		{name: "existing helper alias", extra: `import { trusted as safe } from "vibelang-runtime"` + "\n"},
		{name: "existing caller alias", extra: `import { trusted } from "vibelang-runtime"` + "\n" + `export const parseTrusted = trusted(parse, [Bad])` + "\n", caller: ", parseTrusted as safeParse"},
		{name: "helper collision", extra: "const trusted = 1\n"},
		{name: "barrel", barrel: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			module := "./helpers"
			if test.barrel {
				module = "./index"
			}
			files := map[string]string{
				"/Users/x/src/tsconfig.json":                              `{"compilerOptions":{"strict":true},"include":["*.ts","*.vibe"]}`,
				"/Users/x/src/helpers.ts":                                 test.extra + helper,
				"/Users/x/src/index.ts":                                   `export { parse, Bad } from "./helpers"`,
				"/Users/x/src/main.vibe":                                  "import { parse as read" + test.caller + " } from " + `"` + module + `"` + "\nexport function main() { return [read(\"x\"), read(\"y\")] }\n",
				"/Users/x/src/node_modules/vibelang-runtime/package.json": `{"name":"vibelang-runtime","types":"index.d.ts"}`,
				"/Users/x/src/node_modules/vibelang-runtime/index.d.ts":   `export declare function trusted<A extends unknown[], B>(f: (...args: A) => B, classes: readonly unknown[]): (...args: A) => B`,
			}
			if test.name == "existing caller alias" {
				files["/Users/x/src/helpers.ts"] = "import { trusted } from \"vibelang-runtime\"\n" + helper + "export const parseTrusted = trusted(parse, [Bad])\n"
			}
			for step := range 2 {
				actions := trustedActions(t, files)
				if test.barrel {
					if len(actions) != 0 {
						t.Fatal("barrel received unsafe fix")
					}
					return
				}
				if len(actions) != 1 {
					t.Fatalf("actions=%d", len(actions))
				}
				if step == 0 && test.name != "existing caller alias" {
					if _, ok := (*actions[0].Edit.Changes)["file:///Users/x/src/helpers.ts"]; !ok {
						t.Fatal("missing file:/// helper edit")
					}
				}
				if step == 1 && len(*actions[0].Edit.Changes) != 1 {
					t.Fatal("second fix edits implementation again")
				}
				applyTrustedAction(t, files, actions[0])
			}
			got := files["/Users/x/src/helpers.ts"]
			if strings.Count(got, "export const parseTrusted =") != 1 || strings.Count(got, `from "vibelang-runtime"`) != 1 {
				t.Fatalf("duplicate wrapper/import:\n%s", got)
			}
			if !strings.Contains(got, "export function parse(") {
				t.Fatal("original implementation removed")
			}
			caller := files["/Users/x/src/main.vibe"]
			if strings.Contains(caller, "read(\"") || strings.Count(caller, `from "./helpers"`) != 1 {
				t.Fatalf("caller not migrated once:\n%s", caller)
			}
		})
	}
}
