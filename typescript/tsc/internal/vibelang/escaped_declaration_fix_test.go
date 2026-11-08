package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFixProjectEscapedDeclarationKeywords(t *testing.T) {
	for _, source := range []string{
		`export er\u0072or Entry { value: number }`,
		`export \u{0073}chema error Entry { value: number }`,
		`export schema \u0065rror Entry { value: number }`,
		`export sc\u0068ema er\u0072or Entry { value: number }`,
		`export \u0073ervice Entry { value: number }`,
		`export da\u0074a Entry { EntryValue { value: number } }`,
		`export sch\u0065ma Entry { value: number }`,
		`export cl\u0061ss Entry { value = 1 }`,
	} {
		t.Run(source, func(t *testing.T) {
			_, file, _, _ := editorProgram(t, source+"\n")
			dir := filepath.Dir(file.FileName().AsString())
			result := fixCase(t, dir)
			fixed := result.Files[file.FileName()]
			if result.Err != nil || len(result.Refused) != 0 || fixed == nil || fixed.Counts[1260] == 0 || strings.Contains(fixed.Text, `\u`) {
				t.Fatalf("fix: %+v; file %+v", result, fixed)
			}
			if err := os.WriteFile(file.FileName().AsString(), []byte(fixed.Text), 0600); err != nil {
				t.Fatal(err)
			}
			if again := fixCase(t, dir); again.Err != nil || len(again.Files) != 0 || len(again.Refused) != 0 {
				t.Fatalf("not idempotent: %+v", again)
			}
		})
	}
}

func TestFixProjectEscapedDeclarationKeywordKeepsNames(t *testing.T) {
	source := `export er\u0072or \u0045ntry { value: number }` + "\n" + `const error = 1; export const value = er\u0072or as number` + "\n"
	_, file, _, _ := editorProgram(t, source)
	result := fixCase(t, filepath.Dir(file.FileName().AsString()))
	fixed := result.Files[file.FileName()]
	if result.Err != nil || len(result.Refused) != 0 || fixed == nil || !strings.Contains(fixed.Text, `error \u0045ntry`) || !strings.Contains(fixed.Text, `er\u0072or as number`) {
		t.Fatalf("name/expression rewritten: %+v, %+v", result, fixed)
	}
}

func TestFixProjectEscapedProvideKeywordKeepsNames(t *testing.T) {
	for _, word := range []string{"\\u0070rovide", "pr\\u006fvide", "\\u{70}rovide"} {
		t.Run(word, func(t *testing.T) {
			source := "const " + word + "=1;export const value=" + word + ";\nexport effect function program(){" + word + " Layer.empty {}}\n"
			_, file, _, _ := editorProgram(t, source)
			dir := filepath.Dir(file.FileName().AsString())
			result := fixCase(t, dir)
			fixed := result.Files[file.FileName()]
			want := "const " + word + "=1;export const value=" + word + ";\nexport effect function program(){provide Layer.empty {}}\n"
			if result.Err != nil || len(result.Refused) != 0 || fixed == nil || fixed.Counts[1260] != 1 || fixed.Text != want {
				t.Fatalf("keyword/name repair: %+v; file %+v; want %q", result, fixed, want)
			}
			if err := os.WriteFile(file.FileName().AsString(), []byte(fixed.Text), 0600); err != nil {
				t.Fatal(err)
			}
			if again := fixCase(t, dir); again.Err != nil || len(again.Files) != 0 || len(again.Refused) != 0 {
				t.Fatalf("not idempotent: %+v", again)
			}
		})
	}
}
