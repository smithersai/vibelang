package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

func TestEditorAsyncRefactorsReturnedPromises(t *testing.T) {
	for _, test := range []struct {
		name, source string
		actions      int
	}{
		{"parameter", "async function /*cursor*/load(input: Promise<number>) { return input }", 0},
		{"call", "async function /*cursor*/load() { return Promise.resolve(1) }", 0},
		{"union", "async function /*cursor*/load(input: Promise<number> | number) { return input }", 0},
		{"branch", "async function /*cursor*/load(input: Promise<number>, flag: boolean) { if (flag) return input; return 1 }", 0},
		{"thenable", "async function /*cursor*/load(input: PromiseLike<number>) { return input }", 0},
		{"expression-arrow", "const load = async /*cursor*/(input: Promise<number>) => input", 0},
		{"awaited", "async function /*cursor*/load(input: Promise<number>) { return await input }", 2},
		{"scalar", "async function /*cursor*/load() { return 1 }", 1},
		{"noncallable-then", "async function /*cursor*/load() { return { then: 7 } }", 1},
		{"nested-function", "async function /*cursor*/load(input: Promise<number>) { function inner() { return input }; return await input }", 2},
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
