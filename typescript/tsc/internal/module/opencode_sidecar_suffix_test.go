package module

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

func TestOpencodeSidecarModuleSuffixSourcePriority(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name       string
		importName string
		suffixes   []string
		files      []string
		want       tspath.RootedFilePath
	}{
		{"extensionless source", "runtime", []string{"", ".d.vibe"}, []string{"runtime.vibe", "runtime.d.vibe.ts"}, "/project/runtime.vibe"},
		{"emitted js source", "runtime.js", []string{"", ".d.vibe"}, []string{"runtime.vibe", "runtime.d.vibe.ts"}, "/project/runtime.vibe"},
		{"typescript still wins", "runtime", []string{"", ".d.vibe"}, []string{"runtime.ts", "runtime.vibe", "runtime.d.vibe.ts"}, "/project/runtime.ts"},
		{"tsx still wins", "runtime", []string{"", ".d.vibe"}, []string{"runtime.tsx", "runtime.vibe", "runtime.d.vibe.ts"}, "/project/runtime.tsx"},
		{"declaration fallback", "runtime", []string{"", ".d.vibe"}, []string{"runtime.d.vibe.ts"}, "/project/runtime.d.vibe.ts"},
		{"native source", "runtime", []string{".native", "", ".native.d.vibe", ".d.vibe"}, []string{"runtime.native.vibe", "runtime.native.d.vibe.ts", "runtime.vibe", "runtime.d.vibe.ts"}, "/project/runtime.native.vibe"},
		{"plain ts before native vibe", "runtime", []string{".native", "", ".native.d.vibe", ".d.vibe"}, []string{"runtime.ts", "runtime.native.vibe", "runtime.native.d.vibe.ts"}, "/project/runtime.ts"},
		{"native tsx before plain vibe", "runtime", []string{".native", "", ".native.d.vibe", ".d.vibe"}, []string{"runtime.native.tsx", "runtime.vibe", "runtime.d.vibe.ts"}, "/project/runtime.native.tsx"},
		{"native declaration fallback", "runtime", []string{".native", ".native.d.vibe"}, []string{"runtime.native.d.vibe.ts"}, "/project/runtime.native.d.vibe.ts"},
		{"declaration first keeps explicit preference", "runtime", []string{".d.vibe", ""}, []string{"runtime.vibe", "runtime.d.vibe.ts"}, "/project/runtime.d.vibe.ts"},
		{"explicit sidecar stays explicit", "runtime.d.vibe.ts", []string{"", ".d.vibe"}, []string{"runtime.vibe", "runtime.d.vibe.ts"}, "/project/runtime.d.vibe.ts"},
		{"unpaired suffix keeps meaning", "runtime", []string{".d.vibe"}, []string{"runtime.vibe", "runtime.d.vibe.ts"}, "/project/runtime.d.vibe.ts"},
		{"other suffix keeps meaning", "runtime", []string{"", ".d.other"}, []string{"runtime.vibe", "runtime.d.other.ts"}, "/project/runtime.d.other.ts"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			files := make(map[string]string, len(test.files))
			for _, name := range test.files {
				files["/project/"+name] = "export {};"
			}
			fs := vfstest.FromMap(files, tspath.CaseSensitive)
			state := &resolutionState{
				resolver:        &DefaultResolver{ResolutionData: &ResolutionData{}, fs: fs},
				compilerOptions: &core.CompilerOptions{ModuleSuffixes: test.suffixes},
			}
			result := state.loadModuleFromFile(
				extensionsTypeScript|extensionsDeclaration,
				resolveResolutionCandidate("/project", test.importName),
			)
			if result == nil || result.path != test.want {
				t.Fatalf("resolved %v, want %s", result, test.want)
			}
		})
	}
}
