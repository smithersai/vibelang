package core

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

func TestVibeSidecarExtensionRoundtrip(t *testing.T) {
	for _, ext := range []string{tspath.ExtensionVibe, tspath.ExtensionVibex} {
		for _, directory := range []string{"", "/app/types"} {
			options := &CompilerOptions{ConfigFilePath: "/app/tsconfig.json"}
			if directory != "" {
				options.VibeLang = &VibeLangOptions{SidecarDir: directory}
			}
			source := "/app/src/Stage" + ext
			sidecar, stale := options.VibeSidecarPaths(source, tspath.CaseSensitive)
			want := "/app/src/Stage.d" + ext + ".ts"
			if directory != "" {
				want = directory + "/src/Stage.d" + ext + ".ts"
			}
			if sidecar != want {
				t.Errorf("%s: sidecar %q, want %q", source, sidecar, want)
			}
			if back := options.VibeSidecarSource(sidecar, tspath.CaseSensitive); back != source {
				t.Errorf("%s maps back to %q, want %q", sidecar, back, source)
			}
			if stale == sidecar {
				t.Errorf("stale sidecar must not be the selected output: %q", sidecar)
			}
		}
	}
}
