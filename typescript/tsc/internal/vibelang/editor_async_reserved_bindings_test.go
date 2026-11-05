package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

func TestEditorAsyncRefactorsReservedBindings(t *testing.T) {
	for _, tc := range []struct {
		name, source string
		offer        bool
	}{
		{"expression-own-name", "export const load = /*cursor*/async function fork(input: Promise<number>) { return await input }", false},
		{"arrow-parameter", "export const load = /*cursor*/async (fork: Promise<number>) => await fork", false},
		{"function-parameter", "export /*cursor*/async function load(fork: Promise<number>) { return await fork }", false},
		{"local-binding", "export /*cursor*/async function load(input: Promise<number>) { const fork = await input; return fork }", false},
		{"destructuring-binding", "export /*cursor*/async function load({ fork }: { fork: Promise<number> }) { return await fork }", false},
		{"outer-reference", "const fork = (value: number) => value + 1; export /*cursor*/async function load(input: Promise<number>) { return fork(await input) }", false},
		{"label", "export /*cursor*/async function load(input: Promise<number>) { fork: { break fork }; return await input }", false},
		{"nested-declaration", "export /*cursor*/async function load(input: Promise<number>) { function fork(value: number) { return value }; return fork(await input) }", false},
		{"plain-arrow-head", "export /*cursor*/async function load(input: Promise<number>) { const inner = (fork: number) => fork; return inner(await input) }", false},
		{"async-arrow-head", "export /*cursor*/async function load(input: Promise<number>) { const inner = async (fork: number) => fork; return await inner(await input) }", false},
		{"computed-method", "const fork = 'value'; export /*cursor*/async function load(input: Promise<number>) { class Inner { [fork]() { return 1 } }; return (await input) + new Inner().value() }", false},
		{"computed-field", "const fork = 'value'; export /*cursor*/async function load(input: Promise<number>) { class Inner { [fork] = 1 }; return (await input) + new Inner().value }", false},
		{"heritage", "class fork { value = 1 }; export /*cursor*/async function load(input: Promise<number>) { class Inner extends fork {}; return (await input) + new Inner().value }", false},
		{"static-block", "export /*cursor*/async function load(input: Promise<number>) { class Inner { static { const fork = 1; void fork } }; return await input }", false},
		{"shorthand", "const fork = 1; export /*cursor*/async function load(input: Promise<number>) { const holder = { fork }; return (await input) + holder.fork }", false},
		{"default-binding", "export /*cursor*/async function load(input: Promise<number>, fork = 1) { return (await input) + fork }", false},
		{"declaration-name-control", "export /*cursor*/async function fork(input: Promise<number>) { return await input }", true},
		{"method-name-control", "export const holder = { /*cursor*/async fork(input: Promise<number>) { return await input } }", true},
		{"nested-function-head-control", "export /*cursor*/async function load(input: Promise<number>) { function inner(fork: number) { return fork }; return inner(await input) }", true},
		{"nested-expression-name-control", "export /*cursor*/async function load(input: Promise<number>) { const inner = function fork(value: number) { return value }; return inner(await input) }", true},
		{"arrow-body-control", "export /*cursor*/async function load(input: Promise<number>) { const inner = () => { const fork = 1; return fork }; return (await input) + inner() }", true},
		{"field-initializer-control", "export /*cursor*/async function load(input: Promise<number>) { class Inner { value = (() => { const fork = 1; return fork })() }; return (await input) + new Inner().value }", true},
		{"property-key-control", "export /*cursor*/async function load(input: Promise<number>) { const holder = { fork: 1 }; return (await input) + holder.fork }", true},
		{"nested-method-head-control", "export /*cursor*/async function load(input: Promise<number>) { const holder = { inner(fork: number) { return fork } }; return holder.inner(await input) }", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			pos := strings.Index(tc.source, "/*cursor*/")
			source := strings.ReplaceAll(tc.source, "/*cursor*/", "")
			program, file, service, converters := editorProgram(t, source)
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("invalid original: %s", d.String())
				}
			}
			count, bad := 0, 0
			for _, action := range vibelangRefactors(t.Context(), &ls.RefactorContext{SourceFile: file, Span: core.NewTextRange(pos, pos), Program: program, LS: service}) {
				if !strings.HasPrefix(action.Description, "Convert to a VibeLang function") {
					continue
				}
				count++
				got := applyEditorEdits(t, file, converters, action.Changes)
				checked, edited, _, _ := editorProgram(t, got)
				for _, d := range append(checked.GetSyntacticDiagnostics(t.Context(), edited), checked.GetSemanticDiagnostics(t.Context(), edited)...) {
					if d.Category() == diagnostics.CategoryError {
						bad++
						t.Errorf("offered conversion does not check: %s", d.String())
					}
				}
			}
			if tc.offer && count != 2 {
				t.Fatalf("missing safe conversion: got %d actions", count)
			}
			if bad != 0 {
				t.Fatalf("%d type errors from offered conversions", bad)
			}
		})
	}
}
