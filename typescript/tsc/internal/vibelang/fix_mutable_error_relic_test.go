package vibelang

import (
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

func TestFixMutableErrorRelic(t *testing.T) {
	for _, source := range []string{
		"export error Failure { mutable value: number; fixed?: string }",
		"export error Failure { mutable value: number; get label(): number { return this.value } }",
		"export error /* header */ Failure { /* before */ mutable /* field */ value: number }",
		"export error Failure { /** payload */ mutable value: number; /* trailing */ }",
		"export error Failure { mutable value: number; get label(): number { return this.value }; fixed?: string; /* trailing */ }",
		"export error Failure { mutable value: number; readonly?: string }",
		"const $MutableErrorBase = 1; export error Failure { mutable value: number }",
		"export error First { mutable value: number }; export error Second { mutable name: string }",
	} {
		for _, migration := range []bool{false, true} {
			t.Run(source+map[bool]string{false: "/ordinary", true: "/migration"}[migration], func(t *testing.T) {
				p, file, _, _ := editorProgram(t, source)
				opts := FixOptions{MigrationOnly: migration}
				result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), opts)
				fixed := result.Files[file.FileName()]
				if fixed == nil || result.Err != nil || len(result.Refused) != 0 {
					t.Fatalf("no preserving fix: %+v; fixed %+v", result, fixed)
				}
				if !strings.Contains(fixed.Text, "import { TaggedError as ") || !strings.Contains(fixed.Text, "class ") || strings.Contains(fixed.Text, "mutable value:") || strings.Contains(fixed.Text, "mutable name:") {
					t.Fatal(fixed.Text)
				}
				for _, comment := range []string{"/* header */", "/* before */", "/* field */", "/** payload */", "/* trailing */"} {
					if strings.Contains(source, comment) && !strings.Contains(fixed.Text, comment) {
						t.Fatalf("lost comment %s: %s", comment, fixed.Text)
					}
				}
				if strings.Contains(source, "get label") && !strings.Contains(fixed.Text, "get label(): number { return this.value }") {
					t.Fatal(fixed.Text)
				}
				if err := os.WriteFile(file.FileName().AsString(), []byte(fixed.Text), 0600); err != nil {
					t.Fatal(err)
				}
				again := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), opts)
				if len(again.Files) != 0 || again.Err != nil || len(again.Refused) != 0 {
					t.Fatalf("not idempotent: %+v", again)
				}
			})
		}
	}
}
