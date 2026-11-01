package compiler

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// The module resolver knows which package provided a types entry. Use that
// package's effective config, including extends and configDir, to recover the
// source of a relocated sidecar. Checking its forward mapping proves ownership;
// a same-named file near an arbitrary output is not that proof (268/271).
func (h *compilerResolutionHost) ResolveVibeSidecarSource(sidecar tspath.RootedFilePath, owner tspath.RootedDirectoryPath) tspath.RootedFilePath {
	fs := h.host.FS()
	seen := make(map[tspath.PathKey]bool)
	try := func(file tspath.RootedFilePath) tspath.RootedFilePath {
		key := fs.CaseSensitivity().PathKey(file.AsPath())
		if seen[key] || !fs.FileExists(file) {
			return ""
		}
		seen[key] = true
		config, known := h.sidecarConfigs.Load(key)
		if !known {
			config = h.host.GetResolvedProjectReference(file, key)
			h.sidecarConfigs.Store(key, config)
		}
		if config == nil || config.CompilerOptions().VibeLang == nil || config.CompilerOptions().VibeLang.SidecarDir == "" {
			return ""
		}
		options := config.CompilerOptions()
		source := options.VibeSidecarSource(string(sidecar), fs.CaseSensitivity())
		candidate := tspath.RootedFilePathFromNormalized(source)
		if !fs.FileExists(candidate) {
			return ""
		}
		output, _ := options.VibeSidecarPaths(source, fs.CaseSensitivity())
		if fs.CaseSensitivity().CompareFilePaths(tspath.RootedFilePathFromNormalized(output), sidecar) != 0 {
			return ""
		}
		return candidate
	}
	if owner != "" {
		for _, name := range tsoptions.ConfigFileNames {
			if source := try(owner.ResolveFile(name)); source != "" {
				return source
			}
		}
		// A package can select a named build config with -p. Default configs
		// retain precedence; other JSON configs are considered only on a miss.
		for _, name := range fs.GetAccessibleEntries(owner).Files {
			if name != "package.json" && strings.HasSuffix(name, ".json") {
				if source := try(owner.ResolveFile(name)); source != "" {
					return source
				}
			}
		}
	}
	source, _ := sidecar.Directory().ForEachAncestorDirectory(func(directory tspath.RootedDirectoryPath) (tspath.RootedFilePath, bool) {
		for _, name := range tsoptions.ConfigFileNames {
			if candidate := try(directory.ResolveFile(name)); candidate != "" {
				return candidate, true
			}
		}
		return "", false
	})
	return source
}
