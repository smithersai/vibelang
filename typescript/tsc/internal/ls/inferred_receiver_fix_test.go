// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK9101` | suggestion: the native editor offers the checker’s receiver type for a data-method access.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Example: an inferred receiver at `todos.map()`; [editor receiver example](../../../typescript/tsc/internal/ls/inferred_receiver_fix_test.go).
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | 34 | Apply the receiver annotation; the fatal projection identity is EK9006.
package ls_test

import (
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
	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
)

// receiverActions exercises the public LS transaction and records JavaScript
// from the same program so an annotation cannot silently change lowering.
func receiverActions(t *testing.T, files map[string]string) ([]*lsproto.CodeAction, inferredEmit) {
	t.Helper()
	fs := inferredFileSystem(files)
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
	var actions []*lsproto.CodeAction
	// Compiler collections must stay free of the editor-only resolver, even
	// when the editor suggestion is configured as an error.
	for _, d := range append(p.GetSemanticDiagnostics(t.Context(), file), p.GetSuggestionDiagnostics(t.Context(), file)...) {
		if d.Code() == 2345 {
			t.Fatalf("callback form changed: %s", d.MessageText())
		}
		if d.Code() == 9101 {
			t.Fatal("EK9101 ran in the compiler")
		}
	}
	editor, err := service.ProvideDiagnostics(t.Context(), lsconv.FileNameToDocumentURI(file.FileName()))
	if err != nil {
		t.Fatal(err)
	}
	forkChoices := 0
	for _, diag := range editor.FullDocumentDiagnosticReport.Items {
		if diag.Code == nil || diag.Code.Integer == nil || *diag.Code.Integer != 9101 {
			continue
		}
		forkChoices++
		if diag.Message.String != nil && strings.HasPrefix(*diag.Message.String, "The mapper cannot decide this await element") && !strings.Contains(*diag.Message.String, "The fork infers the success type ") {
			t.Fatal("await choice lacks the inferred type")
		}
		if diag.Severity == nil || *diag.Severity != lsproto.DiagnosticSeverityHint {
			t.Fatal("EK9101 is not an editor suggestion")
		}
		only := []lsproto.CodeActionKind{lsproto.CodeActionKindQuickFix}
		response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())}, Range: diag.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{diag}, Only: &only}})
		if err != nil {
			t.Fatal(err)
		}
		if response.CommandOrCodeActionArray != nil {
			for _, a := range *response.CommandOrCodeActionArray {
				if a.CodeAction != nil && a.CodeAction.Title == "Annotate as the fork infers" {
					actions = append(actions, a.CodeAction)
				}
			}
		}
	}
	projectorChoices := 0
	for _, d := range vibelangmapper.Project(file.Text(), vibelangmapper.FileContext{}).Diagnostics {
		if d.Code == vibelangmapper.CodeDataMethod {
			projectorChoices++
		}
	}
	if forkChoices != projectorChoices {
		t.Fatalf("fork choices=%d projector choices=%d", forkChoices, projectorChoices)
	}
	var emitted inferredEmit
	p.Emit(t.Context(), compiler.EmitOptions{WriteFile: func(name tspath.RootedFilePath, text string, _ *compiler.WriteFileData) error {
		if strings.HasSuffix(string(name), "main.js") {
			emitted.JS = text
		}
		if strings.HasSuffix(string(name), "main.d.ts") {
			emitted.DTS = text
		}
		return nil
	}})
	if emitted.JS == "" || emitted.DTS == "" {
		t.Fatal("no JavaScript emitted")
	}
	return actions, emitted
}

// TestInferredReceiverFix checks declaration edits and preserves both executable
// behavior and public types when the receiver came from a call or a parameter.
func TestInferredReceiverFix(t *testing.T) {
	for _, test := range []struct {
		name, source, annotation string
		remaining                int
	}{
		{"imported native field", `import { getTodo } from "./host"; export function run() { const todo = getTodo(); return todo.done }`, `todo: import("./host").Todo`, 0},
		{"optional imported native field", `import { getTodo } from "./host"; export function run() { const todo = getTodo(); return todo?.done }`, `todo: import("./host").Todo`, 0},
		{"direct native field", `import { getTodo } from "./host"; export function run() { return getTodo().done }`, `(getTodo() as import("./host").Todo)`, 0},
		{"direct array call", `import { array } from "./host"; export function run() { return array().map((n: number): number => n + 1) }`, "(array() as number[])", 0},
		{"property", `import { board } from "./host"; export function run() { const value = board(); return value.todos.map((n: number): number => n + 1) }`, "value: { todos: number[]; }", 0},
		{"shadow", `import { array } from "./host"; const todos = 1; export function run() { const todos = array(); return todos.map((n: number): number => n + 1) }`, "const todos: number[] = array()", 0},
		{"array call", `import { array } from "./host"; export function run() { const todos = array(); return todos.map((n: number): number => n + 1) }`, "todos: number[]", 0},
		{"option call", `import { option } from "./host"; export function run() { const maybe = option(); return maybe.map((n: number): number => n + 1) }`, `maybe: import("effect/Option").Option<number>`, 0},
		{"optional", `import { option } from "./host"; export function run() { const maybe = option(); return maybe?.isSome() }`, `maybe: import("effect/Option").Option<number>`, 1},
		{"extracted", `import { option } from "./host"; export function run() { const maybe = option(); return maybe.isSome }`, `maybe: import("effect/Option").Option<number>`, 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			files := map[string]string{
				"/Users/x/src/tsconfig.json":                              `{"compilerOptions":{"strict":true,"target":"ESNext","declaration":true},"files":["main.vibe","host.ts"]}`,
				"/Users/x/src/main.vibe":                                  test.source,
				"/Users/x/src/host.ts":                                    `import type { Option } from "effect/Option"; export interface Todo { readonly done: boolean }; export declare function getTodo(): Todo; export declare function board(): { todos: number[] }; export declare function array(): number[]; export declare function option(): Option<number>`,
				"/Users/x/src/node_modules/vibelang-runtime/package.json": `{"name":"vibelang-runtime","types":"index.d.ts"}`,
				"/Users/x/src/node_modules/vibelang-runtime/index.d.ts":   `export * as Effect from "effect/Effect"; export * as Option from "effect/Option"`,
				"/Users/x/src/node_modules/effect/package.json":           `{"name":"effect","types":"index.d.ts"}`,
				"/Users/x/src/node_modules/effect/index.d.ts":             `export * as Effect from "./Effect"; export * as Option from "./Option"`,
				"/Users/x/src/node_modules/effect/Effect.d.ts":            `export interface Effect<A,E=never,R=never> { readonly "~effect/Effect": { readonly _A: (_:never)=>A; readonly _E: (_:never)=>E; readonly _R: (_:never)=>R } }`,
				"/Users/x/src/node_modules/effect/Option.d.ts":            `export interface Option<A> { readonly "~effect/Option": A }; export declare function map<A,B>(self: Option<A>, f:(a:A)=>B): Option<B>; export declare function isSome<A>(self: Option<A>): boolean`,
			}
			actions, before := receiverActions(t, files)
			if len(actions) != 1 {
				t.Fatalf("actions=%d", len(actions))
			}
			applyTrustedAction(t, files, actions[0])
			if !strings.Contains(files["/Users/x/src/main.vibe"], test.annotation) {
				t.Fatalf("wrong annotation: %s", files["/Users/x/src/main.vibe"])
			}
			remaining := 0
			for _, d := range vibelangmapper.Project(files["/Users/x/src/main.vibe"], vibelangmapper.FileContext{}).Diagnostics {
				if d.Code == vibelangmapper.CodeDataMethod {
					remaining++
				}
			}
			if remaining != test.remaining {
				t.Fatalf("remaining choices=%d want %d", remaining, test.remaining)
			}
			actions, after := receiverActions(t, files)
			if len(actions) != 0 {
				t.Fatal("annotated declaration still has fix")
			}
			if normalizeEffectHelper(before.JS) != normalizeEffectHelper(after.JS) || before.DTS != after.DTS {
				t.Fatalf("emit changed\nbefore: %v\nafter: %v", before, after)
			}
		})
	}
}
