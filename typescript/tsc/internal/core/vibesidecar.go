package core

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// VibeConventionalSidecarDir is the directory vibe.sidecarDir conventionally
// names, relative to the project's config: hidden, so *.ts globs and readdir
// walks of the source folders do not see it (decided detail 268).
const VibeConventionalSidecarDir = ".vibe/declarations"

// VibeSidecarRoot follows TypeScript 5.9 declaration root inference. Callers
// supply the non-declaration sources they know; the program supplies its full
// graph, while config discovery supplies the selected root files.
func (options *CompilerOptions) VibeSidecarRoot(files []tspath.RootedFilePath, caseSensitivity tspath.CaseSensitivity) string {
	if options.RootDir != "" {
		return options.RootDir.AsString()
	}
	if options.Composite.IsTrue() && options.ConfigFilePath != "" {
		return options.ConfigFilePath.Directory().AsString()
	}
	var sources []tspath.RootedFilePath
	for _, file := range files {
		if !tspath.IsDeclarationFileName(file.AsString()) {
			sources = append(sources, file)
		}
	}
	if len(sources) != 0 {
		return caseSensitivity.CommonDirectoryOfFiles(sources).AsString()
	}
	if options.ConfigFilePath != "" {
		return options.ConfigFilePath.Directory().AsString()
	}
	return ""
}

// VibeSidecarPaths returns where the declaration sidecar of the .vibe file
// source goes, and the other place a sidecar of it is left when the project
// switches modes, or "" (VIP-27, decided detail 268).
//
// By default the sidecar is x.d.vibe.ts beside x.vibe. With vibe.sidecarDir,
// the program supplies the declaration source root, including imported files
// outside the config directory. Without it, config-only callers use rootDir
// or the config directory. The stale place of a project without the setting is the
// conventional directory's mirror, which a project that turned the setting
// off leaves behind.
func (options *CompilerOptions) VibeSidecarPaths(source string, caseSensitivity tspath.CaseSensitivity, sourceRoots ...string) (sidecar string, stale string) {
	extension := tspath.VibeLangSourceExtension(source)
	beside := strings.TrimSuffix(source, extension) + ".d" + extension + ".ts"
	if options == nil || options.ConfigFilePath == "" {
		return beside, ""
	}
	root := options.ConfigFilePath.Directory().AsString()
	if options.RootDir != "" {
		root = options.RootDir.AsString()
	}
	if len(sourceRoots) != 0 && sourceRoots[0] != "" {
		root = sourceRoots[0]
	}
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
		return beside, mirror(tspath.CombinePaths(options.ConfigFilePath.Directory().AsString(), VibeConventionalSidecarDir))
	}
	return beside, mirror(tspath.CombinePaths(options.ConfigFilePath.Directory().AsString(), VibeConventionalSidecarDir))
}

// VibeSidecarSource returns the .vibe or .vibex source whose sidecar is fileName in
// this project, or "" when fileName is no sidecar of the project's layout.
func (options *CompilerOptions) VibeSidecarSource(fileName string, caseSensitivity tspath.CaseSensitivity, sourceRoots ...string) string {
	extension := tspath.ExtensionVibe
	if strings.HasSuffix(fileName, ".d"+tspath.ExtensionVibex+".ts") {
		extension = tspath.ExtensionVibex
	}
	suffix := ".d" + extension + ".ts"
	if !strings.HasSuffix(fileName, suffix) {
		return ""
	}
	if options != nil && options.ConfigFilePath != "" && options.VibeLang != nil && options.VibeLang.SidecarDir != "" && tspath.ContainsPath(options.VibeLang.SidecarDir, fileName, caseSensitivity) {
		relative := tspath.GetRelativePathFromDirectory(options.VibeLang.SidecarDir, fileName, caseSensitivity)
		root := options.VibeSidecarRoot(nil, caseSensitivity)
		if len(sourceRoots) != 0 && sourceRoots[0] != "" {
			root = sourceRoots[0]
		}
		return tspath.CombinePaths(root, strings.TrimSuffix(relative, suffix)+extension)
	}
	return strings.TrimSuffix(fileName, suffix) + extension
}
