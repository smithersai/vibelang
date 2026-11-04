package vibelang

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs"
)

// configFileOwnership bounds configuration codemods by the selected project's
// repository. Without a VCS marker, only its own directory is known to be owned.
// Check both logical and real paths: an owned-looking symlink may reach another
// repository or a dependency, and a dependency symlink may point back inside.
func configFileOwnership(fs vfs.FS, selected tspath.RootedFilePath) func(tspath.RootedFilePath) bool {
	root := tspath.GetDirectoryPath(selected.AsString())
	for dir := root; ; dir = tspath.GetDirectoryPath(dir) {
		found := false
		for _, marker := range []string{".jj", ".git"} {
			name := tspath.CombinePaths(dir, marker)
			if fs.FileExists(tspath.RootedFilePathFromAbsolute(name)) || fs.DirectoryExists(tspath.RootedDirectoryPathFromAbsolute(name)) {
				root = dir
				found = true
				break
			}
		}
		if found || tspath.GetDirectoryPath(dir) == dir {
			break
		}
	}
	realRoot := fs.Realpath(tspath.RootedPath(root)).AsString()
	dependency := func(name string) bool {
		for _, part := range strings.Split(name, "/") {
			if part == "node_modules" {
				return true
			}
		}
		return false
	}
	return func(name tspath.RootedFilePath) bool {
		logical := name.AsString()
		real := fs.Realpath(tspath.RootedPath(name)).AsString()
		return !dependency(logical) && !dependency(real) &&
			tspath.ContainsPath(root, logical, fs.CaseSensitivity()) &&
			tspath.ContainsPath(realRoot, real, fs.CaseSensitivity())
	}
}
