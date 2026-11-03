package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"strings"
	"testing"
)

func TestDeclarationsOfParallel(t *testing.T) {
	for _, count := range []int{2, 16, 64} {
		t.Run(fmt.Sprint(count), func(t *testing.T) {
			t.Parallel()
			files := computedKeyFiles(false)
			var listed []string
			var names []tspath.RootedFilePath
			for i := range count {
				base := fmt.Sprintf("parallel%d.vibe", i)
				name := "/workspace/x/src/" + base
				listed = append(listed, fmt.Sprintf("%q", base))
				names = append(names, tspath.RootedFilePathFromAbsolute(name))
				files[name] = fmt.Sprintf("export const value%d = %d\n", i, i)
			}
			files["/workspace/x/src/tsconfig.json"] = `{"compilerOptions":{"strict":true,"target":"ESNext","module":"NodeNext","declaration":true,"noEmit":true},"files":[` + strings.Join(listed, ",") + "]}"
			for range 4 {
				program := computedKeyProgram(t, files)
				got := declarationsOf(t.Context(), program, names)
				if len(got) != count {
					t.Fatalf("collected %d declarations, want %d", len(got), count)
				}
				for i, name := range names {
					if !strings.Contains(got[name], fmt.Sprintf("value%d", i)) {
						t.Fatalf("missing or mismatched declaration for %s: %q", name, got[name])
					}
				}
			}
		})
	}
}
func TestDeclarationsOfMissingTargets(t *testing.T) {
	program := computedKeyProgram(t, computedKeyFiles(false))
	if got := declarationsOf(t.Context(), program, []tspath.RootedFilePath{tspath.RootedFilePathFromAbsolute("/workspace/x/src/missing.vibe")}); len(got) != 0 {
		t.Fatalf("unexpected declarations: %v", got)
	}
}
