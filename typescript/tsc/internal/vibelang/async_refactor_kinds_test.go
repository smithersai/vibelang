package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

func TestEditorAsyncRefactorKindsAndTrivia(t *testing.T) {
	const prefix = "const café = '😀';\n"
	for _, test := range []struct {
		name, source, want string
		awaits             bool
	}{
		{"declaration", "export /*cursor*/async function load(input: Promise<number>) { return await input }", "export effect function load(input: Promise<number>) { return try Effect.tryPromise(() => input) }", true},
		{"modifier comments", "export /* async comment */ /*cursor*/async /* keep */ function load(input: Promise<number>) { return await input }", "export /* async comment */ effect /* keep */ function load(input: Promise<number>) { return try Effect.tryPromise(() => input) }", true},
		{"expression", "export const load = /*cursor*/async function named(input: Promise<number>) { return await input }", "export const load = effect function named(input: Promise<number>) { return try Effect.tryPromise(() => input) }", true},
		{"block arrow", "export const load = /*cursor*/async (input: Promise<number>) => { return await input }", "export const load = effect (input: Promise<number>) => { return try Effect.tryPromise(() => input) }", true},
		{"expression arrow", "export const load = /*cursor*/async (input: Promise<number>) => await input", "export const load = effect (input: Promise<number>) => try Effect.tryPromise(() => input)", true},
		{"generic typed arrow", "export const load = /*cursor*/async <T extends number>(input: Promise<T>): Promise<T> => await input", "export const load = effect <T extends number>(input: Promise<T>) => try Effect.tryPromise(() => input)", true},
		{"class method", "export class Loader { /*cursor*/async load(input: Promise<number>) { return await input } }", "export class Loader { effect load(input: Promise<number>) { return try Effect.tryPromise(() => input) } }", true},
		{"static method comments", "export class Loader { static /* async comment */ /*cursor*/async /* keep */ load(input: Promise<number>) { return await input } }", "export class Loader { static /* async comment */ effect /* keep */ load(input: Promise<number>) { return try Effect.tryPromise(() => input) } }", true},
		{"object method", "export const loader = { /*cursor*/async load(input: Promise<number>) { return await input } }", "export const loader = { effect load(input: Promise<number>) { return try Effect.tryPromise(() => input) } }", true},
		{"no await", "export const load = /*cursor*/async (input: number) => input", "export const load = effect (input: number) => input", false},
	} {
		titles := []string{"Convert to a VibeLang function"}
		if test.awaits {
			titles = append(titles, "Convert to a VibeLang function with an error per await")
		}
		for _, title := range titles {
			t.Run(test.name+"/"+title, func(t *testing.T) {
				pos := len(prefix) + strings.Index(test.source, "/*cursor*/")
				source := prefix + strings.ReplaceAll(test.source, "/*cursor*/", "")
				program, file, service, converters := editorProgram(t, source)
				var chosen *ls.CodeAction
				for _, action := range vibelangRefactors(t.Context(), &ls.RefactorContext{SourceFile: file, Span: core.NewTextRange(pos, pos), Program: program, LS: service}) {
					if action.Description == title {
						chosen = action
					}
				}
				if chosen == nil {
					t.Fatalf("missing async refactor %q", title)
				}
				want := test.want
				if title != titles[0] {
					want = "error PromiseFailed { cause: unknown }\n" + strings.ReplaceAll(want, "try Effect.tryPromise(() => input)", "try Effect.tryPromise({ try: () => input, catch: (cause) => new PromiseFailed({ cause }) })")
				}
				got := applyEditorEdits(t, file, converters, chosen.Changes)
				if got != prefix+want {
					t.Fatalf("async rewrite differs:\ngot: %s\nwant: %s", got, prefix+want)
				}
				checked, edited, _, _ := editorProgram(t, got)
				all := append(checked.GetSyntacticDiagnostics(t.Context(), edited), checked.GetSemanticDiagnostics(t.Context(), edited)...)
				for _, d := range all {
					if d.Category() == diagnostics.CategoryError {
						t.Errorf("edited function does not check: %s", d.String())
					}
				}
				marked := false
				var visit func(*ast.Node) bool
				visit = func(n *ast.Node) bool {
					if ast.IsFunctionLike(n) && n.Flags&ast.NodeFlagsVibeLangEffect != 0 {
						marked = true
					}
					return n.ForEachChild(visit)
				}
				edited.AsNode().ForEachChild(visit)
				if !marked {
					t.Fatal("rewritten source has no explicit Effect function")
				}
			})
		}
	}
}
