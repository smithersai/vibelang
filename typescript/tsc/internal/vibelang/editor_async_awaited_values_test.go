package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

func TestEditorAsyncRefactorsAwaitedValues(t *testing.T) {
	for _, test := range []struct {
		name, source string
		actions      int
	}{
		{"scalar", "async function /*cursor*/load() { return await 1 }", 0},
		{"object", "async function /*cursor*/load() { return await { value: 1 } }", 0},
		{"mixed-union", "async function /*cursor*/load(input: Promise<number> | number) { return await input }", 0},
		{"any", "async function /*cursor*/load(input: any) { return await input }", 0},
		{"unknown", "async function /*cursor*/load(input: unknown) { return await input }", 0},
		{"expression-arrow", "const load = async /*cursor*/() => await 1", 0},
		{"promise", "async function /*cursor*/load(input: Promise<number>) { return await input }", 2},
		{"thenable", "async function /*cursor*/load(input: PromiseLike<number>) { return await input }", 2},
		{"promise-union", "async function /*cursor*/load(input: Promise<number> | Promise<string>) { return await input }", 2},
		{"nested-function", "async function /*cursor*/load(input: Promise<number>) { const inner = async () => await 1; return await input }", 2},
	} {
		t.Run(test.name, func(t *testing.T) {
			pos := strings.Index(test.source, "/*cursor*/")
			source := strings.ReplaceAll(test.source, "/*cursor*/", "")
			program, file, service, _ := editorProgram(t, source)
			count := 0
			for _, action := range vibelangRefactors(t.Context(), &ls.RefactorContext{
				SourceFile: file, Span: core.NewTextRange(pos, pos), Program: program, LS: service,
			}) {
				if strings.HasPrefix(action.Description, "Convert to a VibeLang function") {
					count++
				}
			}
			if count != test.actions {
				t.Fatalf("offered %d async conversions, want %d: %s", count, test.actions, source)
			}
		})
	}
}
