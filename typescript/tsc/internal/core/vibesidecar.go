package core

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// VibeConventionalSidecarDir is the directory vibe.sidecarDir conventionally
// names, relative to the project's config: hidden, so *.ts globs and readdir
// walks of the source folders do not see it (decided detail 268).
const VibeConventionalSidecarDir = ".vibe/declarations"

// VibeSidecarPaths returns where the declaration sidecar of the .vibe file
// source goes, and the other place a sidecar of it is left when the project
// switches modes, or "" (VIP-27, decided detail 268).
//
// By default the sidecar is x.d.vibe.ts beside x.vibe. With vibe.sidecarDir,
// the sidecars mirror the tree under the project's config directory inside
// that directory, so tsconfig rootDirs [".", sidecarDir] lets stock
// TypeScript resolve ./x.vibe to it. A source outside the config directory
// keeps its sidecar beside it, where rootDirs cannot map it. The stale place of a project without the setting is the
// conventional directory's mirror, which a project that turned the setting
// off leaves behind.
func (options *CompilerOptions) VibeSidecarPaths(source string, caseSensitivity tspath.CaseSensitivity) (sidecar string, stale string) {
	beside := strings.TrimSuffix(source, tspath.ExtensionVibe) + ".d" + tspath.ExtensionVibe + ".ts"
	if options == nil || options.ConfigFilePath == "" {
		return beside, ""
	}
	root := options.ConfigFilePath.Directory().AsString()
	mirror := func(directory string) string {
		if !tspath.ContainsPath(root, source, caseSensitivity) {
			return ""
		}
		return tspath.CombinePaths(directory, tspath.GetRelativePathFromDirectory(root, beside, caseSensitivity))
	}
	if options.VibeLang != nil && options.VibeLang.SidecarDir != "" {
		if mirrored := mirror(options.VibeLang.SidecarDir); mirrored != "" && tspath.ComparePaths(mirrored, beside, caseSensitivity) != 0 {
			return mirrored, beside
		}
		return beside, mirror(tspath.CombinePaths(root, VibeConventionalSidecarDir))
	}
	return beside, mirror(tspath.CombinePaths(root, VibeConventionalSidecarDir))
}

// VibeSidecarSource returns the .vibe source whose sidecar is fileName in
// this project, or "" when fileName is no sidecar of the project's layout.
func (options *CompilerOptions) VibeSidecarSource(fileName string, caseSensitivity tspath.CaseSensitivity) string {
	const suffix = ".d" + tspath.ExtensionVibe + ".ts"
	if !strings.HasSuffix(fileName, suffix) {
		return ""
	}
	if options != nil && options.ConfigFilePath != "" && options.VibeLang != nil && options.VibeLang.SidecarDir != "" && tspath.ContainsPath(options.VibeLang.SidecarDir, fileName, caseSensitivity) {
		relative := tspath.GetRelativePathFromDirectory(options.VibeLang.SidecarDir, fileName, caseSensitivity)
		return tspath.CombinePaths(options.ConfigFilePath.Directory().AsString(), strings.TrimSuffix(relative, suffix)+tspath.ExtensionVibe)
	}
	return strings.TrimSuffix(fileName, suffix) + tspath.ExtensionVibe
}
