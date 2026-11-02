package vibelang

import (
	"errors"
	"slices"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// LoaderRootFlag compiles a project for a module loader, which
// packages/compiler/project.mjs runs for vibelang/register, vibelang/bun and
// the bundler plugins:
//
//	vibelang -p packages/a/tsconfig.json --loader-root packages/a ...
//
// type-checks and emits only the .vibe files under the directory (compiler.SetLoaderRoot).
// The loader compiles a module of another workspace package with that
// package's own project, so checking the sources of every package a project
// imports in each project's compile would check each package once per
// project that imports it.
const LoaderRootFlag = "--loader-root"

// LoaderRootArguments returns args without --loader-root and its directory,
// and the directory, absolute against cwd, or "" when args hold no
// --loader-root.
func LoaderRootArguments(args []string, cwd tspath.RootedDirectoryPath) ([]string, string, error) {
	index := slices.IndexFunc(args, func(arg string) bool { return strings.EqualFold(arg, LoaderRootFlag) })
	if index < 0 {
		return args, "", nil
	}
	if index+1 >= len(args) || strings.HasPrefix(args[index+1], "-") {
		return nil, "", errors.New(LoaderRootFlag + " needs a directory: " + LoaderRootFlag + " <directory>")
	}
	for _, arg := range args {
		switch strings.ToLower(arg) {
		case "-b", "--b", "-build", "--build":
			return nil, "", errors.New(LoaderRootFlag + " compiles one project; it cannot be combined with " + arg)
		}
	}
	root := tspath.GetNormalizedAbsolutePath(args[index+1], cwd)
	return slices.Delete(slices.Clone(args), index, index+2), root, nil
}
