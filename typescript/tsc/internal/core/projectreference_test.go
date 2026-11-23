package core_test

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"gotest.tools/v3/assert"
)

func TestResolveConfigFileNameOfProjectReferenceInDirectory(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name     string
		path     string
		existing []string
		expected string
	}{
		{"vibe.config.json first", "/p/lib", []string{"/p/lib/jsconfig.json", "/p/lib/tsconfig.json", "/p/lib/vibe.config.json"}, "/p/lib/vibe.config.json"},
		{"tsconfig.json before jsconfig.json", "/p/lib", []string{"/p/lib/jsconfig.json", "/p/lib/tsconfig.json"}, "/p/lib/tsconfig.json"},
		{"jsconfig.json alone", "/p/lib", []string{"/p/lib/jsconfig.json"}, "/p/lib/jsconfig.json"},
		{"no config names tsconfig.json", "/p/lib", nil, "/p/lib/tsconfig.json"},
		{"a named file is that file", "/p/lib/tsconfig.build.json", []string{"/p/lib/vibe.config.json"}, "/p/lib/tsconfig.build.json"},
		{"a named tsconfig.json is not replaced", "/p/lib/tsconfig.json", []string{"/p/lib/vibe.config.json"}, "/p/lib/tsconfig.json"},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			exists := func(file tspath.RootedFilePath) bool {
				for _, name := range test.existing {
					if name == file.AsString() {
						return true
					}
				}
				return false
			}
			assert.Equal(t, core.ResolveConfigFileNameOfProjectReferenceInDirectory(tspath.RootedPath(test.path), exists).AsString(), test.expected)
		})
	}
}
