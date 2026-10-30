package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// A .vibe file compiles with its own project's VibeLang settings (design
// D297). A program reads another package's .vibe source when a project
// imports a workspace package that exports it: TypeScript checks every source
// file of the program, and the checker lowers each .vibe file to infer its
// functions' Effect types. Trust (D261), diagnostic categories (D34), and
// tracing (D34) decide what that file means, so they are the settings of the
// package that owns it, the same settings its own build and the bundler
// plugins compile it with:
//
//	apps/web/tsconfig.json              the compiled project, no trustedPackages
//	packages/errors/tsconfig.json       "vibelang": { "trustedPackages": ["@smthrs/*"] }
//	packages/errors/src/Failure.vibe    checks with @smthrs/* trusted in either program
//
// A file of the compiled project's own package keeps the compiled project's
// settings, so a test tsconfig that extends the package's tsconfig and changes
// them applies to its files. A file of another package takes the settings of
// the nearest tsconfig.json above it; with none, the compiled project's. A
// program without a tsconfig, such as `vibelang --ignoreConfig a.ts`, has no
// VibeLang settings and no package of its own, so every package's .vibe file
// takes its own package's settings.

type projectSettingsState struct {
	files   map[*ast.SourceFile]*core.CompilerOptions // .vibe file -> the options whose VibeLang settings apply to it
	configs map[tspath.PathKey]*core.VibeLangOptions  // a foreign tsconfig.json -> its VibeLang settings
	home    *tspath.RootedDirectoryPath               // the compiled project's package directory, once known
}

type projectSettingsStateKey struct{}

func projectSettingsOf(c *checker.Checker) *projectSettingsState {
	return c.ExtensionState(projectSettingsStateKey{}, func() any {
		return &projectSettingsState{files: map[*ast.SourceFile]*core.CompilerOptions{}, configs: map[tspath.PathKey]*core.VibeLangOptions{}}
	}).(*projectSettingsState)
}

// optionsFor returns the compiler options whose VibeLang settings apply to
// file: the program's own, or for a .vibe file of another package, a copy that
// carries that package's VibeLang settings (D297). Only VibeLang reads the
// copy; TypeScript keeps checking every file with the program's options.
func optionsFor(c *checker.Checker, file *ast.SourceFile) *core.CompilerOptions {
	options := c.CompilerOptions()
	if !isVibeLangFile(file) || options == nil {
		return options
	}
	s := projectSettingsOf(c)
	if result, ok := s.files[file]; ok {
		return result
	}
	result := options
	directory := file.FileName().Directory()
	if owner, _ := packageRootOf(c, directory); owner != "" && !samePath(c, owner.AsPath(), homeOf(c, s).AsPath()) {
		if config := nearestConfig(c, directory); config != "" && !samePath(c, config.AsPath(), options.ConfigFilePath.AsPath()) {
			if settings := configSettings(c, s, config); !settings.Equals(options.VibeLang) {
				result = options.Clone()
				result.VibeLang = settings
			}
		}
	}
	s.files[file] = result
	return result
}

// homeOf returns the package directory of the compiled project's tsconfig,
// or "" when the program has no tsconfig or it lies in no package.
func homeOf(c *checker.Checker, s *projectSettingsState) tspath.RootedDirectoryPath {
	if s.home == nil {
		var home tspath.RootedDirectoryPath
		if config := c.CompilerOptions().ConfigFilePath; config != "" {
			home, _ = packageRootOf(c, config.Directory())
		}
		s.home = &home
	}
	return *s.home
}

// nearestConfig returns the nearest project config in VIP-30 precedence order.
func nearestConfig(c *checker.Checker, directory tspath.RootedDirectoryPath) tspath.RootedFilePath {
	return tsoptions.FindConfigFile(directory, c.Program().FileExists)
}

// configSettings returns the VibeLang settings that config, with what it
// extends, declares. A config that cannot be read declares none.
func configSettings(c *checker.Checker, s *projectSettingsState, config tspath.RootedFilePath) *core.VibeLangOptions {
	key := c.Program().CaseSensitivity().PathKey(config.AsPath())
	if settings, ok := s.configs[key]; ok {
		return settings
	}
	var settings *core.VibeLangOptions
	if program, ok := c.Program().(*compiler.Program); ok {
		if parsed, _ := tsoptions.GetParsedCommandLineOfConfigFile(config, &core.CompilerOptions{}, nil, program.Host().FS(), nil); parsed != nil {
			settings = parsed.CompilerOptions().VibeLang
		}
	}
	s.configs[key] = settings
	return settings
}

// samePath reports whether a and b name the same path under the program's
// case sensitivity.
func samePath(c *checker.Checker, a, b tspath.RootedPath) bool {
	caseSensitivity := c.Program().CaseSensitivity()
	return caseSensitivity.PathKey(a) == caseSensitivity.PathKey(b)
}
