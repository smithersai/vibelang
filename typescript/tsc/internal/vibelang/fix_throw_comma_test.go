package vibelang

import (
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

func TestFixThrowComma(t *testing.T) {
	const source = "export effect function f(e: string, ok: boolean) {\n" +
		" const object = { value: ok ? 1 : throw e, tail: 2 };\n" +
		" const array = [ok ? 1 : throw (e), 2];\n" +
		" const call = first(ok ? 1 : throw /* reason */ e, 2);\n" +
		" const sequence = (ok ? 1 : throw e, 2);\n" +
		" return [object.value, array[0], call, sequence];\n}\n" +
		"function first(a: number, b: number) { return a; }\n"
	want := strings.ReplaceAll(source, "throw e,", "(throw e),")
	want = strings.ReplaceAll(want, "throw (e),", "(throw (e)),")
	want = strings.ReplaceAll(want, "throw /* reason */ e,", "(throw /* reason */ e),")
	for name, options := range map[string]FixOptions{
		"ordinary": {}, "migration-only": {MigrationOnly: true}, "vip-only": {VIPOnly: true},
	} {
		t.Run(name, func(t *testing.T) {
			p, file, _, _ := editorProgram(t, source)
			fs := bundled.WrapFS(osvfs.FS())
			result := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), p.CommandLine(), options)
			fixed := result.Files[file.FileName()]
			if result.Err != nil || len(result.Refused) != 0 || fixed == nil {
				t.Fatalf("throw-comma migration missing: err=%v refused=%v files=%v", result.Err, result.Refused, result.Files)
			}
			if fixed.Text != want || fixed.Counts[EK1010.Code] != 4 {
				t.Fatalf("got %q counts=%v; want %q and four EK1010 repairs", fixed.Text, fixed.Counts, want)
			}
			if err := os.WriteFile(file.FileName().AsString(), []byte(fixed.Text), 0600); err != nil {
				t.Fatal(err)
			}
			again := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), p.CommandLine(), options)
			if again.Err != nil || len(again.Files) != 0 || len(again.Refused) != 0 {
				t.Fatalf("not idempotent: %+v", again)
			}
		})
	}
}

func TestFixThrowCommaKeepsOtherBoundaries(t *testing.T) {
	for _, expression := range []string{"throw e + 1", "throw e ? 1 : 2", "[(throw e), 1]", "[throw (e, 1)]"} {
		t.Run(expression, func(t *testing.T) {
			source := "export effect function f(e: any) { return " + expression + "; }\n"
			p, file, _, _ := editorProgram(t, source)
			result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), FixOptions{VIPOnly: true})
			if fixed := result.Files[file.FileName()]; fixed != nil && fixed.Counts[EK1010.Code] != 0 {
				t.Fatalf("changed another boundary: %s", fixed.Text)
			}
		})
	}
}
