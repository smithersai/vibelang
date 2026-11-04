package vibelang

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

// Chapter 7 requires repairs to preserve types and declaration output.
func TestOptionMatchUnexportedPayload(t *testing.T) {
	for _, tc := range []struct{ name, declaration, payload, prefix string }{
		{"interface", "interface TextFile { readonly content: string }", "TextFile", ""},
		{"alias", "type TextFile = { readonly content: string }", "TextFile", ""},
		{"generic", "interface TextFile<T> { readonly content: T }", "TextFile<string>", ""},
		{"nested", "interface Metadata { readonly size: number }; interface TextFile { readonly content: string; readonly metadata: Metadata }", "TextFile", ""},
		{"shadowed", "interface TextFile { readonly content: string }", "TextFile", "type TextFile = { unrelated: number }; export type Local = TextFile;\n"},
		{"exported", "export interface TextFile { readonly content: string }", "TextFile", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := "import { file } from \"./foreign.js\"\n" + tc.prefix +
				"export const text = Option.match(file, { onNone: (): string => \"\", onSome: (file): string => file.content })\n"
			_, file, _, _ := editorProgram(t, source)
			dir := filepath.Dir(file.FileName().AsString())
			foreign := "import { Option } from \"effect\"\n" + tc.declaration + "\nexport declare const file: Option.Option<" + tc.payload + ">;\n"
			for name, text := range map[string]string{
				"foreign.ts":    foreign,
				"tsconfig.json": "{\"compilerOptions\":{\"target\":\"ES2022\",\"module\":\"NodeNext\",\"strict\":true,\"skipLibCheck\":true,\"declaration\":true,\"emitDeclarationOnly\":true,\"outDir\":\"out\"},\"files\":[\"main.vibe\"]}",
			} {
				if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0600); err != nil {
					t.Fatal(err)
				}
			}
			before := migrationRuleDeclarations(t, dir, nil)
			if before["main.d.ts"] == "" {
				t.Fatal("missing original declaration")
			}
			result := fixCase(t, dir)
			fixed := result.Files[file.FileName()]
			if result.Err != nil || len(result.Refused) != 0 || fixed == nil || fixed.Counts[EK4839.Code] != 1 || strings.Contains(fixed.Text, "Option.match(") {
				t.Fatalf("payload repair must resolve its generated names: err=%v refused=%+v fixed=%+v", result.Err, result.Refused, fixed)
			}
			if err := os.WriteFile(file.FileName().AsString(), []byte(fixed.Text), 0600); err != nil {
				t.Fatal(err)
			}
			after := migrationRuleDeclarations(t, dir, nil)
			if !reflect.DeepEqual(before, after) {
				t.Fatalf("declarations changed:\nbefore: %v\nafter: %v\n%s", before, after, fixed.Text)
			}
			again := fixCase(t, dir)
			if again.Err != nil || len(again.Files) != 0 || len(again.Refused) != 0 {
				t.Fatalf("repair is not idempotent: %+v", again)
			}
		})
	}
}
