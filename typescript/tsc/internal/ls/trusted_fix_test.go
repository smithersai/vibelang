package ls_test

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
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

var trustedEffectOnce sync.Once
var trustedEffectFiles map[string]string
var trustedEffectError error

func addTrustedEffectDeclarations(t *testing.T, files map[string]string) {
	t.Helper()
	trustedEffectOnce.Do(func() {
		root, err := filepath.Abs("../../../..")
		if err != nil {
			trustedEffectError = err
			return
		}
		modules := os.Getenv("EFFECT_NODE_MODULES")
		if modules == "" {
			modules = filepath.Join(root, "experiments", "node_modules")
		}
		actual, err := filepath.EvalSymlinks(filepath.Join(modules, "effect"))
		if err != nil {
			trustedEffectError = err
			return
		}
		trustedEffectFiles = map[string]string{}
		trustedEffectError = filepath.WalkDir(actual, func(path string, entry fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if entry.IsDir() || !(strings.HasSuffix(path, ".d.ts") || filepath.Base(path) == "package.json") {
				return nil
			}
			body, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			relative, err := filepath.Rel(actual, path)
			if err != nil {
				return err
			}
			trustedEffectFiles[filepath.ToSlash(relative)] = string(body)
			return nil
		})
	})
	if trustedEffectError != nil {
		t.Fatal(trustedEffectError)
	}
	for config := range files {
		if strings.HasSuffix(config, "/tsconfig.json") {
			base := strings.TrimSuffix(config, "tsconfig.json") + "node_modules/effect/"
			for name, text := range trustedEffectFiles {
				files[base+name] = text
			}
			return
		}
	}
	t.Fatal("missing virtual project configuration")
}

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

// A legacy editor client can retain an EK4406 diagnostic after a compiler upgrade.
// Request its action through the public language service at the current
// synchronous-call boundary, preserving document URIs and WorkspaceEdit conversion.
func trustedActions(t *testing.T, files map[string]string, callee string) []*lsproto.CodeAction {
	t.Helper()
	addTrustedEffectDeclarations(t, files)
	fs := bundled.WrapFS(vfstest.FromMap(files, tspath.CaseInsensitive))
	parsed, errors := tsoptions.GetParsedCommandLineOfConfigFile("/home/src/src/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 {
		t.Fatalf("config: %v", errors)
	}
	p := compiler.NewProgram(compiler.ProgramOptions{Config: parsed, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
	converters := lsconv.NewConverters(lsproto.PositionEncodingKindUTF16, func(name tspath.RootedFilePath) *lsconv.LSPLineMap {
		return lsconv.ComputeLSPLineStarts(files[string(name)])
	})
	service := ls.NewLanguageService(nil, p, trustedFixHost{converters: converters}, "/home/src/src/main.vibe")
	file := p.GetSourceFile("/home/src/src/main.vibe")
	var observed []int32
	for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
		observed = append(observed, d.Code())
		if d.Code() == 4406 {
			t.Fatal("VIP-4 synchronous contracts must report the current boundary diagnostic")
		}
		if d.Code() != 403 || !strings.HasPrefix(file.Text()[d.Pos():], callee+"(") {
			continue
		}
		diag := lsconv.DiagnosticToLSPPush(t.Context(), converters, d)
		// Preserve the exact range while replaying the legacy client diagnostic.
		*diag.Code.Integer = 4406
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
	t.Fatalf("fixture has no current synchronous-call boundary; observed codes: %v", observed)
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
func TestTrustedFixAcrossFiles(t *testing.T) { t.Parallel(); runTrustedFixAcrossFiles(t, 0) }

func runTrustedFixAcrossFiles(t *testing.T, variation uint8) {
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
			reader := "read"
			if variation != 0 {
				reader = fmt.Sprintf("%s%d", []string{"read", "_read", "$read", "read$"}[variation%4], variation/4)
			}
			module := "./helpers"
			if test.barrel {
				module = "./index"
			}
			files := map[string]string{
				"/home/src/src/tsconfig.json":                              `{"compilerOptions":{"strict":true,"lib":["esnext"],"module":"esnext","moduleResolution":"bundler","skipLibCheck":true},"include":["*.ts","*.vibe"]}`,
				"/home/src/src/helpers.ts":                                 test.extra + helper,
				"/home/src/src/index.ts":                                   `export { parse, Bad } from "./helpers"`,
				"/home/src/src/main.vibe":                                  "import { parse as read" + test.caller + " } from " + `"` + module + `"` + "\nexport effect function main() { return [read(\"x\"), read(\"y\")] }\n",
				"/home/src/src/node_modules/vibelang-runtime/package.json": `{"name":"vibelang-runtime","types":"index.d.ts"}`,
				"/home/src/src/node_modules/vibelang-runtime/index.d.ts":   `export declare function trusted<A extends unknown[], B>(f: (...args: A) => B, classes: readonly unknown[]): (...args: A) => B`,
			}
			if test.name == "existing caller alias" {
				files["/home/src/src/helpers.ts"] = "import { trusted } from \"vibelang-runtime\"\n" + helper + "export const parseTrusted = trusted(parse, [Bad])\n"
			}
			for name, text := range files {
				if strings.HasSuffix(name, "/main.vibe") {
					files[name] = strings.ReplaceAll(text, "read", reader)
					if variation&1 != 0 {
						files[name] = "// keep legacy range café 😀\n" + files[name]
					}
				}
			}
			for step := range 2 {
				actions := trustedActions(t, files, reader)
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
					if _, ok := (*actions[0].Edit.Changes)["file:///home/src/src/helpers.ts"]; !ok {
						t.Fatal("missing file:/// helper edit")
					}
				}
				if step == 1 && len(*actions[0].Edit.Changes) != 1 {
					t.Fatal("second fix edits implementation again")
				}
				applyTrustedAction(t, files, actions[0])
			}
			got := files["/home/src/src/helpers.ts"]
			if strings.Count(got, "export const parseTrusted =") != 1 || strings.Count(got, `from "vibelang-runtime"`) != 1 {
				t.Fatalf("duplicate wrapper/import:\n%s", got)
			}
			if !strings.Contains(got, "export function parse(") {
				t.Fatal("original implementation removed")
			}
			caller := files["/home/src/src/main.vibe"]
			caller = strings.ReplaceAll(caller, reader, "read")
			if variation&1 != 0 && !strings.Contains(caller, "// keep legacy range café 😀") {
				t.Fatal("client action lost authored comment")
			}
			if strings.Contains(caller, "read(\"") || strings.Count(caller, `from "./helpers"`) != 1 {
				t.Fatalf("caller not migrated once:\n%s", caller)
			}
		})
	}
}

func TestTrustedLegacyClientActionsQuoted(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	text, err := os.ReadFile(filepath.Join(root, "docs", "design", "src", "003-failures.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), "Effect code calls a function whose thrown type is `never` directly.") {
		t.Fatal("foreign call boundary authority changed")
	}
}

func FuzzTrustedLegacyClientActions(f *testing.F) {
	for value := uint8(0); value < 16; value++ {
		f.Add(value)
	}
	f.Fuzz(func(t *testing.T, value uint8) {
		TestTrustedLegacyClientActionsQuoted(t)
		runTrustedFixAcrossFiles(t, value%16)
	})
}
