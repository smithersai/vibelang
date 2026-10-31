package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"strings"
	"testing"
)

func TestEditorAsyncGeneratorRefactors(t *testing.T) {
	for _, test := range []struct {
		name, source string
		want         int
	}{
		{"declaration-return", "async function* values(input: Promise<number>) { yield await input; return 2 }", 0},
		{"expression-return", "const values = async function* named(input: Promise<number>) { yield await input; return 2 }", 0},
		{"class-return", "class Values { async *read(input: Promise<number>) { yield await input; return 2 } }", 0},
		{"static-return", "class Values { static async *read(input: Promise<number>) { yield await input; return 2 } }", 0},
		{"object-return", "const values = { async *read(input: Promise<number>) { yield await input; return 2 } }", 0},
		{"branch-return", "async function* values(input: Promise<number>) { yield await input; if (true) { return 2 } return }", 0},
		{"generic-return", "async function* values<T extends number>(input: Promise<T>) { yield await input; return 2 }", 0},
		{"promise-yield", "async function* values(input: Promise<number>) { yield input }", 0},
		{"void-generator", "async function* values(input: Promise<number>) { yield await input; return }", 0},
		{"ordinary-declaration", "async function values(input: Promise<number>) { return await input }", 2},
		{"ordinary-expression", "const values = async function named(input: Promise<number>) { return await input }", 2},
		{"ordinary-method", "class Values { async read(input: Promise<number>) { return await input } }", 2},
		{"nested-generator", "async function values(input: Promise<number>) { const local = async function*() { yield 1; return 2 }; return await input }", 2},
	} {
		for _, prefix := range []string{"", "const café = '😀';" + string(rune(10))} {
			t.Run(test.name+prefix, func(t *testing.T) {
				source := prefix + test.source
				pos := strings.Index(source, "async")
				program, file, service, _ := editorProgram(t, source)
				for _, d := range program.GetSyntacticDiagnostics(t.Context(), file) {
					t.Fatalf("invalid source: %v", d)
				}
				count := 0
				for _, action := range vibelangRefactors(t.Context(), &ls.RefactorContext{SourceFile: file, Span: core.NewTextRange(pos, pos), Program: program, LS: service}) {
					if strings.HasPrefix(action.Description, "Convert to a VibeLang function") {
						count++
					}
				}
				if count != test.want {
					t.Fatalf("got %d Promise conversion actions, want %d: %s", count, test.want, source)
				}
			})
		}
	}
}
