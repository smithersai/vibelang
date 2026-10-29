package vfsmatch

import (
	"slices"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

func TestIncludeFileInRootDirectory(t *testing.T) {
	for _, root := range []tspath.RootedDirectoryPath{"/", "C:/"} {
		t.Run(root.AsString(), func(t *testing.T) {
			got := getBasePaths(root, []string{"index.ts"}, tspath.CaseSensitive)
			if !slices.Equal(got, []tspath.RootedDirectoryPath{root}) {
				t.Fatalf("got %v, want [%s]", got, root)
			}
		})
	}
}
