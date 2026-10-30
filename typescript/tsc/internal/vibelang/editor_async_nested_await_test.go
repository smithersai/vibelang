package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

func TestEditorAsyncRefactorsNestedAwaitOperands(t *testing.T) {
	for _, test := range []struct {
		name, source string
		offer        bool
	}{
		{"direct-function", "async function /*cursor*/load(input: Promise<number>) { return await await input }", false},
		{"direct-method", "class Loader { async /*cursor*/load(input: Promise<number>) { return await await input } }", false},
		{"direct-block-arrow", "const load = async /*cursor*/(input: Promise<number>) => { return await await input }", false},
		{"parenthesized", "async function /*cursor*/load(input: Promise<number>) { return await (await input) }", false},
		{"triple", "async function /*cursor*/load(input: Promise<number>) { return await await await input }", false},
		{"single", "async function /*cursor*/load(input: Promise<number>) { return await input }", true},
		{"nested-function", "async function /*cursor*/load(input: Promise<number>) { return await Promise.resolve(async () => await await input) }", true},
	} {
		t.Run(test.name, func(t *testing.T) {
			pos := strings.Index(test.source, "/*cursor*/")
			source := strings.ReplaceAll(test.source, "/*cursor*/", "")
			program, file, service, _ := editorProgram(t, source)
			actions := vibelangRefactors(t.Context(), &ls.RefactorContext{
				SourceFile: file, Span: core.NewTextRange(pos, pos), Program: program, LS: service,
			})
			count := 0
			for _, action := range actions {
				if strings.HasPrefix(action.Description, "Convert to a VibeLang function") {
					count++
				}
			}
			want := 0
			if test.offer {
				want = 2
			}
			if count != want {
				t.Fatalf("offered %d async conversions, want %d: %s", count, want, source)
			}
		})
	}
}
