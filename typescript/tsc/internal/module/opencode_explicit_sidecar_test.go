package module

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

func TestOpencodeExplicitVibeCompatibilitySidecar(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name      string
		specifier string
		suffixes  []string
		files     []string
		want      tspath.RootedFilePath
	}{
		{"plain compatibility declaration", "tool.vibe", nil, []string{"tool.d.vibe.ts"}, "/project/tool.d.vibe.ts"},
		{"migration suffixes", "tool.vibe", []string{"", ".d.vibe"}, []string{"tool.d.vibe.ts"}, "/project/tool.d.vibe.ts"},
		{"source priority", "tool.vibe", []string{"", ".d.vibe"}, []string{"tool.vibe", "tool.d.vibe.ts"}, "/project/tool.vibe"},
		{"explicit module ignores native homonym", "tool.vibe", nil, []string{"tool.ts", "tool.d.vibe.ts"}, "/project/tool.d.vibe.ts"},
		{"specific companion before ordinary declaration", "tool.vibe", nil, []string{"tool.d.ts", "tool.d.vibe.ts"}, "/project/tool.d.vibe.ts"},
		{"ordinary emitted declaration still works", "tool.vibe", nil, []string{"tool.d.ts"}, "/project/tool.d.ts"},
		{"missing stays missing", "tool.vibe", nil, nil, ""},
		{"other arbitrary extension", "tool.css", nil, []string{"tool.d.css.ts"}, "/project/tool.d.css.ts"},
		{"vibex companion control", "tool.vibex", nil, []string{"tool.d.vibex.ts"}, "/project/tool.d.vibex.ts"},
		{"stock platform counterpart", "tool.vibe", []string{".native", ""}, []string{"tool.d.vibe.native.ts", "tool.native.d.vibe.ts", "tool.d.vibe.ts"}, "/project/tool.d.vibe.native.ts"},
		{"explicit native counterpart", "tool.native.vibe", []string{".native", ""}, []string{"tool.native.d.vibe.native.ts", "tool.native.d.vibe.ts"}, "/project/tool.native.d.vibe.native.ts"},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			files := make(map[string]string)
			for _, name := range test.files {
				files["/project/"+name] = "export {};"
			}
			fs := vfstest.FromMap(files, tspath.CaseSensitive)
			state := &resolutionState{
				resolver:        &DefaultResolver{ResolutionData: &ResolutionData{}, fs: fs},
				compilerOptions: &core.CompilerOptions{ModuleSuffixes: test.suffixes},
			}
			got := state.loadModuleFromFile(extensionsTypeScript|extensionsDeclaration, resolveResolutionCandidate("/project", test.specifier))
			if test.want == "" {
				if got != nil && got.isResolved() {
					t.Fatalf("resolved %v; want unresolved", got)
				}
			} else if got == nil || got.path != test.want {
				t.Fatalf("resolved %v; want %s", got, test.want)
			}
		})
	}
}
