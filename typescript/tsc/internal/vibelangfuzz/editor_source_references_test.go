package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

// FuzzEditor's declared-reference probes select authored reads. TypeScript returns
// no completion list at a class declaration's name, but answers a real new
// expression using that class. Lowered error/schema declarations can clone
// their source name into generated reads; those are still one declaration
// token in the authored source, not additional editor reference probes.
func TestToolsDeclaredReferencesExcludeDeclarationClones(t *testing.T) {
	w := NewWorkspace(t)
	for _, shape := range []struct{ name, file, declaration, argument string }{
		{"native-ts", "main.ts", "export class %s { constructor(readonly reason: string) {} }", "\"x\""},
		{"native-vibe", "main.vibe", "export class %s { constructor(readonly reason: string) {} }", "\"x\""},
		{"error", "main.vibe", "export error %s { reason: string }", "{ reason: \"x\" }"},
		{"schema-error", "main.vibe", "import * as Schema from \"effect/Schema\"\nexport schema error %s { reason: Schema.String }", "{ reason: \"x\" }"},
	} {
		for i, name := range []string{"Fault", "Issue_1", "Échec", "Σφάλμα"} {
			t.Run(shape.name+"/"+name, func(t *testing.T) {
				prefix := []string{"", "// before\n", "/* Ω */\n", "\n\n// 😀\n"}[i]
				text := prefix + fmt.Sprintf(shape.declaration, name) + "\n" +
					fmt.Sprintf("export const first = new %s(%s)\nexport const second = new %s(%s)\n", name, shape.argument, name, shape.argument)
				files := map[string]string{shape.file: text}
				r := toolsCompile(t, w, "FuzzEditor", files)
				defer r.Remove()
				e := &toolsEditor{t: t, ctx: t.Context(), r: r, main: shape.file, files: files}
				var got []int
				for _, offset := range e.declaredReferences() {
					if offset >= 0 && offset+len(name) <= len(text) && text[offset:offset+len(name)] == name {
						got = append(got, offset)
					}
				}
				want := []int{strings.Index(text, "new "+name) + 4, strings.LastIndex(text, "new "+name) + 4}
				slices.Sort(got)
				if !slices.Equal(got, want) {
					t.Fatalf("source reference offsets = %v, want %v; declaration at %d must not reappear through a clone\n%s", got, want, strings.Index(text, name), text)
				}
			})
		}
	}
}
