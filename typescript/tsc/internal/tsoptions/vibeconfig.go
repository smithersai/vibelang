package tsoptions

import (
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// ConfigFileNames is ordered by VIP-30 precedence within each directory.
var ConfigFileNames = core.ProjectConfigFileNames

// ConfigFileInDirectory returns the preferred config, or the conventional
// tsconfig path when none exists so callers can report their normal error.
func ConfigFileInDirectory(directory tspath.RootedDirectoryPath, exists func(tspath.RootedFilePath) bool) tspath.RootedFilePath {
	return core.ConfigFileInProjectDirectory(directory, exists)
}

// FindConfigFile searches each directory before moving to its parent.
func FindConfigFile(directory tspath.RootedDirectoryPath, exists func(tspath.RootedFilePath) bool) tspath.RootedFilePath {
	result, ok := directory.ForEachAncestorDirectory(func(ancestor tspath.RootedDirectoryPath) (tspath.RootedFilePath, bool) {
		candidate := ConfigFileInDirectory(ancestor, exists)
		return candidate, exists(candidate)
	})
	if !ok {
		return ""
	}
	return result
}
