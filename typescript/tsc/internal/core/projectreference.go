package core

import "github.com/microsoft/TypeScript/tsc/internal/tspath"

type ProjectReference struct {
	// Path is a normalized path on disk.
	Path tspath.RootedPath `json:"path"`
	// OriginalPath is the path as it was originally written.
	OriginalPath string `json:"originalPath,omitempty"`
	// Circular indicates that this reference is intended to form a circularity.
	Circular bool `json:"circular,omitempty"`
}

func ResolveProjectReferencePath(ref *ProjectReference) tspath.RootedFilePath {
	return ResolveConfigFileNameOfProjectReference(ref.Path)
}

func ResolveConfigFileNameOfProjectReference(path tspath.RootedPath) tspath.RootedFilePath {
	fileName := tspath.RootedFilePathFromPath(path)
	if fileName.ExtensionIs(tspath.ExtensionJson) {
		return fileName
	}
	return tspath.RootedDirectoryPathFromPath(path).ResolveFile("tsconfig.json")
}

// ProjectConfigFileNames is the order in which a directory names its project
// (VIP-30): the same order -p <dir> and config discovery follow.
var ProjectConfigFileNames = []string{"vibe.config.json", "tsconfig.json", "jsconfig.json"}

// ConfigFileInProjectDirectory returns the first of ProjectConfigFileNames that
// exists in directory, or the conventional tsconfig.json path when none does,
// so callers report their usual "file not found" error.
func ConfigFileInProjectDirectory(directory tspath.RootedDirectoryPath, fileExists func(tspath.RootedFilePath) bool) tspath.RootedFilePath {
	for _, name := range ProjectConfigFileNames {
		candidate := directory.ResolveFile(name)
		if fileExists(candidate) {
			return candidate
		}
	}
	return directory.ResolveFile("tsconfig.json")
}

// ResolveConfigFileNameOfProjectReferenceInDirectory resolves a project
// reference, a `-b` argument or a `references` path, to its config file. A
// path that names a .json file is that file; a directory resolves as -p <dir>
// does. ResolveConfigFileNameOfProjectReference cannot see the file system and
// knows only tsconfig.json, so callers that have one resolve through here.
func ResolveConfigFileNameOfProjectReferenceInDirectory(path tspath.RootedPath, fileExists func(tspath.RootedFilePath) bool) tspath.RootedFilePath {
	fileName := tspath.RootedFilePathFromPath(path)
	if fileName.ExtensionIs(tspath.ExtensionJson) {
		return fileName
	}
	return ConfigFileInProjectDirectory(tspath.RootedDirectoryPathFromPath(path), fileExists)
}
