package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

func TestEditorAsyncRefactorsPreserveCompletionBoundaries(t *testing.T) {
	for _, test := range []struct {
		name, source string
		offer        bool
	}{
		{"catch", "async function /*cursor*/load(input: Promise<number>) { try { return await input } catch { return 0 } }", false},
		{"finally", "async function /*cursor*/load(input: Promise<number>) { try { return await input } finally { const cleanup = 1 } }", false},
		{"catch-finally-arrow", "const load = async /*cursor*/(input: Promise<number>) => { try { return await input } catch { return 0 } finally { const cleanup = 1 } }", false},
		{"await-using", "async function /*cursor*/load(resource: AsyncDisposable) { await using handle = resource; return 1 }", false},
		{"await-using-method", "class Loader { async /*cursor*/load(resource: AsyncDisposable, input: Promise<number>) { await using handle = resource; return await input } }", false},
		{"using", "async function /*cursor*/load(resource: Disposable, input: Promise<number>) { using handle = resource; return await input }", false},
		{"using-method", "class Loader { async /*cursor*/load(resource: Disposable, input: Promise<number>) { using handle = resource; return await input } }", false},
		{"for-await", "async function /*cursor*/load(input: AsyncIterable<number>) { for await (const item of input) { return item } }", false},
		{"nested-plain-try", "async function /*cursor*/load(input: Promise<number>) { function inner() { try { return 1 } catch { return 0 } }; return await input }", true},
		{"nested-plain-using", "async function /*cursor*/load(input: Promise<number>) { function inner(resource: Disposable) { using handle = resource }; return await input }", true},
		{"nested-async-using", "async function /*cursor*/load(input: Promise<number>) { async function inner(resource: AsyncDisposable) { await using handle = resource }; return await input }", true},
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
