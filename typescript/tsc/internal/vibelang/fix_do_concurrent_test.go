package vibelang

import (
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

func TestFixDoConcurrentEnding(t *testing.T) {
	for _, body := range []string{
		"for concurrent (const n of [1]) { /* keep */ n }",
		"for concurrent(2) (const n of [1]) n;",
		"if (true) for concurrent (const n of [1]) n; else 3;",
		"label: for concurrent (const n of [1]) { n }",
		"{ for concurrent (const n of [1]) { n } }; {};",
	} {
		t.Run(body, func(t *testing.T) {
			source := "export effect function f() { return do { " + body + " } }"
			p, file, _, _ := editorProgram(t, source)
			result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), FixOptions{})
			fixed, ok := result.Files[file.FileName()]
			if !ok || len(result.Refused) != 0 || !strings.Contains(fixed.Text, "void 0 as void;") || strings.Contains(source, "/* keep */") && !strings.Contains(fixed.Text, "/* keep */") {
				t.Fatalf("missing preserving repair: %+v", result)
			}
			if err := os.WriteFile(file.FileName().AsString(), []byte(fixed.Text), 0600); err != nil {
				t.Fatal(err)
			}
			again := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), FixOptions{})
			if len(again.Files) != 0 || len(again.Refused) != 0 {
				t.Fatalf("repair is not stable: %+v", again)
			}
		})
	}
}
