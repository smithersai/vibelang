package vibelang

import (
	"fmt"
	stdmaps "maps"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

const neverFixRoot = "/workspace/x/src/"

func neverFixFiles(helper, target string) map[string]string {
	files := computedKeyFiles(false)
	files[neverFixRoot+"main.vibe"] = "import { isResolved } from \"./" + strings.TrimSuffix(target, ".ts") + ".js\"\nexport effect function main(news: string | undefined) {\n if (!isResolved(news)) return \"absent\"\n const narrowed: string = news\n return narrowed\n}\n"
	if strings.HasSuffix(target, ".d.ts") {
		files[neverFixRoot+"main.vibe"] = strings.ReplaceAll(files[neverFixRoot+"main.vibe"], ".d.js", ".js")
	}
	files[neverFixRoot+target] = helper
	return files
}

func neverFixTwin(t *testing.T, files map[string]string, want bool) map[string]string {
	t.Helper()
	p := computedKeyProgram(t, files)
	file := p.GetSourceFile(neverFixRoot + "main.vibe")
	var diagnostic *ast.Diagnostic
	for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
		if d.Code() == EK0403.Code {
			diagnostic = d
		}
	}
	if diagnostic == nil {
		t.Fatal("missing EK0403 witness")
	}
	converters := lsconv.NewConverters(lsproto.PositionEncodingKindUTF16, func(name tspath.RootedFilePath) *lsconv.LSPLineMap {
		return lsconv.ComputeLSPLineStarts(files[name.AsString()])
	})
	service := ls.NewLanguageService(nil, p, editorTestHost{converters: converters}, string(file.FileName()))
	actions, err := foreignCallFix.GetCodeActions(t.Context(), &ls.CodeFixContext{SourceFile: file, Span: diagnostic.Loc(), ErrorCode: EK0403.Code, Program: p, LS: service})
	if err != nil {
		t.Fatal(err)
	}
	var annotation *ls.CodeAction
	wrappers := 0
	for _, action := range actions {
		if strings.HasPrefix(action.Description, "Add /** @throws {never} */") {
			annotation = action
		} else {
			wrappers++
		}
	}
	if (annotation != nil) != want {
		t.Fatalf("annotation offered=%v, want %v; actions=%v; files=%v", annotation != nil, want, actions, files)
	}
	if wrappers != 1 {
		t.Fatalf("wrapper actions=%d, want 1", wrappers)
	}
	if !want {
		return files
	}
	after := stdmaps.Clone(files)
	if len(annotation.Changes) != 0 || len(annotation.AdditionalChanges) != 1 {
		t.Fatalf("expected one declaration edit: %+v", annotation)
	}
	change := annotation.AdditionalChanges[0]
	for _, target := range p.SourceFiles() {
		if lsconv.FileNameToDocumentURI(target.FileName()) == change.URI {
			after[target.FileName().AsString()] = applyEditorEdits(t, target, converters, change.Changes)
		}
	}
	if after[neverFixRoot+"main.vibe"] != files[neverFixRoot+"main.vibe"] {
		t.Fatal("call site changed")
	}
	checked := computedKeyProgram(t, after)
	for _, d := range checked.GetSemanticDiagnostics(t.Context(), checked.GetSourceFile(neverFixRoot+"main.vibe")) {
		if d.Category() == diagnostics.CategoryError {
			t.Fatalf("fixed twin loses narrowing or reports an error: %s", d.String())
		}
	}
	return after
}

func TestForeignThrowsNeverFixTwins(t *testing.T) {
	for _, tc := range []struct {
		name, helper, target string
		want                 bool
	}{
		{"predicate", "/** Keep café 😀 and its documentation. */\nexport const isResolved = <T>(v: T | undefined): v is T => v !== undefined\n", "helper.ts", true},
		{"throw", "export function isResolved<T>(v: T | undefined): v is T { if (!v) throw v; return true }", "helper.ts", false},
		{"parse", "export function isResolved<T>(v: T | undefined): v is T { JSON.parse(\"{}\"); return true }", "helper.ts", false},
		{"declaration", "export declare function isResolved<T>(v: T | undefined): v is T", "helper.d.ts", false},
		{"recursive pair", "function a(n: number): boolean { return n <= 0 || b(n-1) }\nfunction b(n: number): boolean { return n <= 0 || a(n-1) }\nexport function isResolved<T>(v: T | undefined): v is T { return a(2) && v !== undefined }", "helper.ts", true},
		{"throw after cycle", "function a(n: number): boolean { if (n > 0) b(n-1); throw n }\nfunction b(n: number): boolean { return n <= 0 || a(n-1) }\nexport function isResolved<T>(v: T | undefined): v is T { return b(2) && v !== undefined }", "helper.ts", false},
		{"overload", "export function isResolved(v: undefined): v is never;\nexport function isResolved<T>(v: T | undefined): v is T;\nexport function isResolved(v: unknown) { return v !== undefined }", "helper.ts", false},
		{"default initializer", "export function isResolved<T>(v: T | undefined, n = JSON.parse(\"{}\")): v is T { return v !== undefined }", "helper.ts", false},
		{"unknown callback", "export function isResolved<T>(v: T | undefined): v is T { const f: () => void = () => {}; f(); return v !== undefined }", "helper.ts", false},
		{"never contract", "/** @throws {never} */\nfunction safe() { return 1 }\nexport function isResolved<T>(v: T | undefined): v is T { return safe() > 0 && v !== undefined }", "helper.ts", true},
		{"rethrows unknown callback", "/** @throws {never} @rethrows f */\nfunction invoke(f: () => void) { f() }\ndeclare const unknownCallback: () => void;\nexport function isResolved<T>(v: T | undefined): v is T { invoke(unknownCallback); return v !== undefined }", "helper.ts", false},
		{"tagged rethrows unknown", "/** @throws {never} @rethrows callback */\ndeclare function tag(strings: TemplateStringsArray, callback: () => void): boolean;\ndeclare const unknownCallback: () => void;\nexport function isResolved<T>(v: T | undefined): v is T { return tag`x ${unknownCallback}` && v !== undefined }", "helper.ts", false},
		{"rethrows pure callback", "/** @throws {never} @rethrows callback */\nfunction invoke(callback: () => number) { return callback() }\nfunction safe() { return 1 }\nexport function isResolved<T>(v: T | undefined): v is T { return invoke(safe) > 0 && v !== undefined }", "helper.ts", true},
		{"overload throwing sibling", "/** @throws {Error} */\nfunction overloaded(n: string): number;\n/** @throws {never} */\nfunction overloaded(n: number): number;\nfunction overloaded(n: unknown) { return 1 }\nexport function isResolved<T>(v: T | undefined): v is T { return overloaded(1) > 0 && v !== undefined }", "helper.ts", false},
		{"node modules", "export const isResolved = <T>(v: T | undefined): v is T => v !== undefined", "node_modules/helper.ts", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			files := neverFixFiles(tc.helper, tc.target)
			after := neverFixTwin(t, files, tc.want)
			if tc.want && !strings.Contains(after[neverFixRoot+tc.target], "@throws {never}") {
				t.Fatal("tag missing")
			}
			if strings.Contains(tc.helper, "Keep café") && !strings.Contains(after[neverFixRoot+tc.target], "Keep café 😀 and its documentation.") {
				t.Fatal("comment lost")
			}
		})
	}
	t.Run("different project", func(t *testing.T) {
		files := neverFixFiles("export const isResolved = <T>(v: T | undefined): v is T => v !== undefined", "nested/helper.ts")
		files[neverFixRoot+"nested/tsconfig.json"] = "{}"
		neverFixTwin(t, files, false)
	})
}

// The generator describes its own proof language: leaves are literal returns,
// a shipped never call, a throw, or JSON.parse; edges call a same-project
// helper or form a recursive pair. A throwing leaf anywhere rejects the graph.
func FuzzForeignThrowsNeverFix(f *testing.F) {
	for shape := uint8(0); shape < 16; shape++ {
		f.Add(shape, uint8(3))
	}
	f.Fuzz(func(t *testing.T, shape, count uint8) {
		n := int(count%5) + 1
		unsafe := shape & 3
		leaf := "return n >= 0"
		if unsafe == 1 {
			leaf = "throw n"
		}
		if unsafe == 2 {
			leaf = "return JSON.parse(\"true\")"
		}
		if unsafe == 3 {
			leaf = "return Math.abs(n) >= 0"
		}
		var helper strings.Builder
		for i := 0; i < n; i++ {
			body := leaf
			if i+1 < n {
				body = fmt.Sprintf("return f%d(n)", i+1)
			}
			if shape&4 != 0 && i == n-1 {
				body = "if (n > 0) f0(n-1); " + body
			}
			fmt.Fprintf(&helper, "function f%d(n: number): boolean { %s }\n", i, body)
		}
		helper.WriteString("export const isResolved = <T>(v: T | undefined): v is T => f0(0) && v !== undefined\n")
		files := neverFixFiles(helper.String(), "helper.ts")
		neverFixTwin(t, files, unsafe == 0 || unsafe == 3)
	})
}

func TestForeignThrowsNeverCLITwin(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	cases := filepath.Join(root, "typescript/vibelang/cases")
	dir := copyCompilerFixture(t, filepath.Join(cases, "ek0403-throws-never.fail"), root)
	result := fixCase(t, dir)
	if result.Err != nil {
		t.Fatal(result.Err)
	}
	if len(result.Refused) != 0 {
		t.Fatalf("refused: %+v", result.Refused)
	}
	if len(result.Files) != 1 {
		t.Fatalf("want only the helper changed: %v", result.Order)
	}
	for name, fixed := range result.Files {
		if filepath.Base(name.AsString()) != "helpers.ts" || fixed.Counts[EK0403.Code] != 1 {
			t.Fatalf("unexpected fix: %s %+v", name, fixed)
		}
		want, err := os.ReadFile(filepath.Join(cases, "ek0403-throws-never-fixed-output/helpers.ts"))
		if err != nil {
			t.Fatal(err)
		}
		if fixed.Text != string(want) {
			t.Fatalf("fixed helper:\n%s\nwant:\n%s", fixed.Text, want)
		}
		if err := os.WriteFile(name.AsString(), []byte(fixed.Text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if again := fixCase(t, dir); again.Err != nil || len(again.Files) != 0 || len(again.Refused) != 0 {
		t.Fatalf("second fix differs: %+v", again)
	}
}
