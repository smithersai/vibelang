package vibelang

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/astnav"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsutil"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

type editorTestHost struct {
	ls.Host
	converters *lsconv.Converters
}

func (h editorTestHost) ReadFile(path tspath.RootedFilePath) (string, bool) {
	text, err := os.ReadFile(string(path))
	return string(text), err == nil
}

func (h editorTestHost) Converters() *lsconv.Converters { return h.converters }
func (h editorTestHost) GetPreferences(string) lsutil.UserPreferences {
	return lsutil.UserPreferences{}
}

func editorProgram(t *testing.T, source string) (*compiler.Program, *ast.SourceFile, *ls.LanguageService, *lsconv.Converters) {
	t.Helper()
	dir := t.TempDir()
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(dir, "node_modules"), 0755); err != nil {
		t.Fatal(err)
	}
	for name, target := range map[string]string{"effect": "packages/runtime/node_modules/effect", "vibelang-runtime": "packages/runtime"} {
		if err := os.Symlink(filepath.Join(root, target), filepath.Join(dir, "node_modules", name)); err != nil {
			t.Fatal(err)
		}
	}
	for name, text := range map[string]string{
		"package.json":  `{"type":"module"}`,
		"tsconfig.json": `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true},"files":["main.vibe"]}`,
		"main.vibe":     source,
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	fs := bundled.WrapFS(osvfs.FS())
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 || len(config.Errors) != 0 {
		t.Fatalf("config: %v %v", errors, config.Errors)
	}
	program := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
	file := program.GetSourceFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "main.vibe"))))
	converters := lsconv.NewConverters(lsproto.PositionEncodingKindUTF16, func(name tspath.RootedFilePath) *lsconv.LSPLineMap {
		text, ok := fs.ReadFile(name)
		if !ok {
			t.Fatalf("missing editor document %s", name)
		}
		return lsconv.ComputeLSPLineStarts(text)
	})
	service := ls.NewLanguageService(nil, program, editorTestHost{converters: converters}, string(file.FileName()))
	return program, file, service, converters
}

func applyEditorEdits(t *testing.T, file *ast.SourceFile, converters *lsconv.Converters, edits []*lsproto.TextEdit) string {
	t.Helper()
	edits = slices.Clone(edits)
	slices.SortFunc(edits, func(a, b *lsproto.TextEdit) int {
		return converters.FromLSPRangeToOriginal(file, b.Range).Pos() - converters.FromLSPRangeToOriginal(file, a.Range).Pos()
	})
	text := file.Text()
	previous := len(text)
	for _, edit := range edits {
		span := converters.FromLSPRangeToOriginal(file, edit.Range)
		if span.Pos() < 0 || span.End() > previous || span.Pos() > span.End() {
			t.Fatalf("invalid or overlapping editor edit: %+v", edit)
		}
		text = text[:span.Pos()] + edit.NewText + text[span.End():]
		previous = span.Pos()
	}
	return text
}

// D245 promises usable source rewrites. Compare the complete edited source,
// with real UTF-16 editor coordinates, then check the result with the compiler.
func TestEditorRefactorGoldens(t *testing.T) {
	const helpers = "function f(x: number): number { return x * 2 }\nfunction g(x: number): number { return x + 1 }\n"
	for _, test := range []struct{ name, source, action, want string }{
		{"interface to schema", "export interface /*cursor*/Person { readonly name: string }", "Convert to a schema declaration", "export schema Person { readonly name: string }"},
		{"type to schema", "export type /*cursor*/Person = { name: string }", "Convert to a schema declaration", "export schema Person { name: string }"},
		{"inferred contract", "export function /*cursor*/double(x: number) { return x * 2 }", "Write the inferred contract", "export function double(x: number): number!! { return x * 2 }"},
		{"inferred effect contract", "export function /*cursor*/load() { return Effect.succeed(1) }", "Write the inferred contract", "export function load(): number!! { return Effect.succeed(1) }"},
		{"remove contract", "export function /*cursor*/double(x: number): number!! { return x * 2 }", "Remove the contract", "export function double(x: number) { return x * 2 }"},
		{"nested calls", helpers + "export const value = /*cursor*/f(g(1))", "Convert to a pipe", helpers + "export const value = 1 |> g(%) |> f(%)"},
		{"pipe to calls", helpers + "export const value = 1 /*cursor*/|> g(%) |> f(%)", "Convert the pipe to calls", helpers + "export const value = f(g(1))"},
		{"pipe precedence", "export const value = (1 + 2) /*cursor*/|> % * 3", "Convert the pipe to calls", "export const value = (1 + 2) * 3"},
		{"async shorthand", "export async /*cursor*/later(n: number) { return n }", "Convert to a VibeLang function", "export function later(n: number) { return n }"},
	} {
		t.Run(test.name, func(t *testing.T) {
			const prefix = "const café = '😀'; "
			pos := len(prefix) + strings.Index(test.source, "/*cursor*/")
			source := prefix + strings.ReplaceAll(test.source, "/*cursor*/", "")
			program, file, service, converters := editorProgram(t, source)
			actions := vibelangRefactors(t.Context(), &ls.RefactorContext{SourceFile: file, Span: core.NewTextRange(pos, pos), Program: program, LS: service})
			var chosen *ls.CodeAction
			for _, action := range actions {
				if action.Description == test.action {
					chosen = action
				}
			}
			if chosen == nil {
				t.Fatalf("missing refactor %q: %+v", test.action, actions)
			}
			got := applyEditorEdits(t, file, converters, chosen.Changes)
			if got != prefix+test.want {
				t.Fatalf("edited source differs:\ngot: %s\nwant: %s", got, prefix+test.want)
			}
			checked, edited, _, _ := editorProgram(t, got)
			all := append(checked.GetSyntacticDiagnostics(t.Context(), edited), checked.GetSemanticDiagnostics(t.Context(), edited)...)
			for _, d := range all {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("refactor produced a compiler error: %s", d.String())
				}
			}
		})
	}
}

func TestEditorRefactorsDeclineUnsupportedRewrites(t *testing.T) {
	for _, test := range []struct{ source, action string }{
		{"interface /*cursor*/Box<T> { value: T }", "Convert to a schema declaration"},
		{"interface Base { value: number }; interface /*cursor*/Child extends Base {}", "Convert to a schema declaration"},
		{"const value = 1 /*cursor*/|> % + %", "Convert the pipe to calls"},
		{"function /*cursor*/plain(): number { return 1 }", "Remove the contract"},
		{"async function /*cursor*/nested() { return await Promise.resolve(await Promise.resolve(1)) }", "Convert to a VibeLang function"},
	} {
		pos := strings.Index(test.source, "/*cursor*/")
		source := strings.ReplaceAll(test.source, "/*cursor*/", "")
		program, file, service, _ := editorProgram(t, source)
		for _, action := range vibelangRefactors(t.Context(), &ls.RefactorContext{SourceFile: file, Span: core.NewTextRange(pos, pos), Program: program, LS: service}) {
			if action.Description == test.action {
				t.Errorf("unsupported refactor %q offered for %s", test.action, source)
			}
		}
	}
}

func TestEditorHoverExplainsCallBehavior(t *testing.T) {
	for _, test := range []struct{ name, source, signature, note string }{
		{"plain function", "function double(x: number) { return x * 2 }; function main() { return /*cursor*/double(2) }", "function double(x: number): number", "Plain JavaScript: VibeLang code calls it directly."},
		{"running effect", "function main() { return Effect./*cursor*/succeed(1) }", "", "Runs here and returns `number`."},
		{"deferred effect", "function main() { return Effect.all([Effect./*cursor*/succeed(1)]) }", "", "Passed by name to `Effect.all` as a program:"},
		{"hatch body", "function main() { return sync(() => Effect./*cursor*/succeed(1)) }", "", ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			pos := strings.Index(test.source, "/*cursor*/")
			source := strings.ReplaceAll(test.source, "/*cursor*/", "")
			program, file, _, _ := editorProgram(t, source)
			program.GetSemanticDiagnostics(t.Context(), file)
			c, done := program.GetTypeCheckerForFile(t.Context(), file)
			defer done()
			node := astnav.GetTouchingPropertyName(file, pos)
			signature, note := plainFunctionQuickInfo(c, node)
			_, running := runningCallQuickInfo(c, node)
			note += running
			if signature != test.signature || (test.note == "" && note != "") || !strings.Contains(note, test.note) {
				t.Fatalf("hover: %q / %q; want %q / %q", signature, note, test.signature, test.note)
			}
		})
	}
}

// A hover on an argument passed by name, before its call is checked,
// resolves the call first, so the call keeps the signature a full check
// infers: after the hover on the first topic, Effect.timeout's program, the
// second topic is the timed greeting's value, a string, not unknown.
func TestEditorHoverOnByNameArgumentBeforeCheck(t *testing.T) {
	source := "function greeting() { return \"hi\" }\nexport function piped() {\n  return greeting() |> Effect.timeout(%, \"1 second\") |> `${%}!`\n}\n"
	_, file, service, _ := editorProgram(t, source)
	uri := lsconv.FileNameToDocumentURI(file.FileName())
	line := strings.Split(source, "\n")[2]
	first := hoverText(t, service, uri, lsproto.Position{Line: 2, Character: uint32(strings.Index(line, "(%,") + 1)})
	second := hoverText(t, service, uri, lsproto.Position{Line: 2, Character: uint32(strings.Index(line, "${%}") + 2)})
	if !strings.Contains(first, "(topic) %: string!!") || !strings.HasPrefix(second, "(topic) %: string\n\nThe value") {
		t.Fatalf("hovers %q, then %q; want the program string!!, then the value string", first, second)
	}
}

// Chapter 28's editor answers hover at a name a .vibe file declares or
// references, as TypeScript does: the base of an error's extends clause
// hovers as that error.
func TestEditorHoverOnErrorBase(t *testing.T) {
	_, file, service, _ := editorProgram(t, "error A {}\nerror B extends A {}\n")
	hover := hoverText(t, service, lsconv.FileNameToDocumentURI(file.FileName()), lsproto.Position{Line: 1, Character: 16})
	if !strings.Contains(hover, "A") {
		t.Fatalf("hover at the base of error B = %q, want error A", hover)
	}
}

// Chapter 28's editor answers hover at a name a .vibe file references inside
// a desugared form: the subject of `is` and a name in a match arm's guard.
func TestEditorHoverInIsSubjectAndGuard(t *testing.T) {
	for _, test := range []struct{ source, at, want string }{
		{"function f() {\n  const outcome = exit(() => 1)\n  if (outcome is Exit.Failure) return 1\n  return 2\n}\n", "(outcome is", "outcome: "},
		{"function f(input: { a: number }) {\n  return match (input) {\n    when { a: let n } and if (n >= 3): \"x\";\n    default: \"y\";\n  }\n}\n", "(n >=", "n: number"},
	} {
		_, file, service, converters := editorProgram(t, test.source)
		position, _ := converters.ToLSPPosition(file, core.TextPos(strings.Index(test.source, test.at)+1))
		if hover := hoverText(t, service, lsconv.FileNameToDocumentURI(file.FileName()), position); !strings.Contains(hover, test.want) {
			t.Errorf("hover at %q = %q, want %q", test.at, hover, test.want)
		}
	}
}

// LSP 3.17: a document symbol's range starts no later than it ends, even for
// the empty fallback the parser synthesizes for `1 catch` with no operand.
func TestEditorDocumentSymbolsOfMissingCatchFallback(t *testing.T) {
	_, file, service, _ := editorProgram(t, "function f() { return 1 catch }\n")
	response, err := service.ProvideDocumentSymbols(t.Context(), lsconv.FileNameToDocumentURI(file.FileName()))
	if err != nil {
		t.Fatal(err)
	}
	var check func([]*lsproto.DocumentSymbol)
	check = func(symbols []*lsproto.DocumentSymbol) {
		for _, symbol := range symbols {
			if start, end := symbol.Range.Start, symbol.Range.End; start.Line > end.Line || start.Line == end.Line && start.Character > end.Character {
				t.Errorf("symbol %q has the range %v-%v, which ends before it starts", symbol.Name, start, end)
			}
			if symbol.Children != nil {
				check(*symbol.Children)
			}
		}
	}
	if response.DocumentSymbols != nil {
		check(*response.DocumentSymbols)
	}
	if response.SymbolInformations != nil {
		for _, symbol := range *response.SymbolInformations {
			check([]*lsproto.DocumentSymbol{{Name: symbol.Name, Range: symbol.Location.Range}})
		}
	}
}

// The quick fix of EK9101, "Annotate as the fork infers", offers nothing
// where an annotation cannot keep the program (Chapter 28, Rewrites keep
// meaning, D372): super takes no assertion; `(this as T).x = …` hides a
// constructor's assignment from definite assignment (TS2564); and the binding
// of a for-of loop (TS2483) or of `finally (exit)` has no place for a type.
func TestEditorReceiverFixDeclines(t *testing.T) {
	for _, test := range []struct{ name, source string }{
		{"super", "class Shape {\n  sizeValue = 1\n  get size() { return this.sizeValue }\n  set size(value: number) { this.sizeValue = value }\n}\nclass Square extends Shape {\n  grow() { super.size = 2 }\n}\n"},
		{"this assignment", "class M {\n  size: number\n  constructor() { this.size = 1 }\n}\n"},
		{"for-of binding", "export function f(entries: ReadonlyArray<{ request: { code: string } }>) {\n  for (const entry of entries) Console.log(entry.request.code)\n}\n"},
		{"finally binding", "function f() {\n  try { return 1 } finally (exit) { Console.log(exit.cause.reasons.map((reason) => reason._tag)) }\n}\n"},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, file, service, _ := editorProgram(t, test.source)
			uri := lsconv.FileNameToDocumentURI(file.FileName())
			report, err := service.ProvideDiagnostics(t.Context(), uri)
			if err != nil {
				t.Fatal(err)
			}
			choices := 0
			for _, d := range report.FullDocumentDiagnosticReport.Items {
				if d.Code == nil || d.Code.Integer == nil || *d.Code.Integer != 9101 {
					continue
				}
				choices++
				response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{TextDocument: lsproto.TextDocumentIdentifier{Uri: uri}, Range: d.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{d}}})
				if err != nil {
					t.Fatal(err)
				}
				if response.CommandOrCodeActionArray != nil {
					for _, action := range *response.CommandOrCodeActionArray {
						if action.CodeAction != nil && action.CodeAction.Title == "Annotate as the fork infers" {
							t.Errorf("offered %q at line %d", action.CodeAction.Title, d.Range.Start.Line)
						}
					}
				}
			}
			if choices == 0 {
				t.Fatal("no EK9101, so this case tests nothing")
			}
		})
	}
}

// A name in a later test of a match arm's pattern is a reference, as it is
// in the arm's only test: renaming NotFound renames it in
// `when NotFound and { _tag }` (Chapter 28, D372).
func TestEditorReferencesInMatchAndPattern(t *testing.T) {
	source := "error NotFound {}\nfunction d(e: NotFound) {\n  return match (e) {\n    when NotFound and { _tag }: 1;\n  }\n}\n"
	_, file, service, _ := editorProgram(t, source)
	uri := lsconv.FileNameToDocumentURI(file.FileName())
	response, err := service.ProvideReferences(t.Context(), &lsproto.ReferenceParams{TextDocument: lsproto.TextDocumentIdentifier{Uri: uri}, Position: lsproto.Position{Line: 0, Character: 7}, Context: &lsproto.ReferenceContext{IncludeDeclaration: true}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	var lines []uint32
	if response.Locations != nil {
		for _, location := range *response.Locations {
			lines = append(lines, location.Range.Start.Line)
		}
	}
	if !slices.Equal(lines, []uint32{0, 1, 3}) {
		t.Fatalf("references of NotFound on lines %v, want 0, 1 and 3", lines)
	}
}

func TestEditorDirectiveCompletions(t *testing.T) {
	for _, source := range []string{"// @vibe", "// @vibelang-diagnostics ", "// @vibelang-diagnostics-next-line EK9204:off EK44"} {
		program, file, _, _ := editorProgram(t, source)
		c, done := program.GetTypeCheckerForFile(t.Context(), file)
		items := vibelangTextCompletions(c, file, len(source))
		done()
		labels := map[string]bool{}
		for _, item := range items {
			labels[item.Label] = true
			if item.Start < 0 || item.Start > len(source) || (item.End != 0 && item.End < item.Start) {
				t.Fatalf("invalid completion replacement: %+v", item)
			}
		}
		if source == "// @vibe" {
			if len(items) != 2 || !labels["@vibelang-diagnostics"] || !labels["@vibelang-diagnostics-next-line"] {
				t.Fatalf("missing directive completions: %+v", items)
			}
			continue
		}
		for _, code := range core.VibeLangAdjustableCodes {
			for _, category := range []string{"error", "warning", "off"} {
				if !labels[code+":"+category] {
					t.Errorf("missing completion %s:%s", code, category)
				}
			}
		}
		if !labels["*:off"] || labels["EK9201:off"] || labels["EK4813:off"] {
			t.Fatalf("completions must preserve fixed diagnostic categories: %v", labels)
		}
	}
}
