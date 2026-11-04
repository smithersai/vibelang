package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	stdmaps "maps"
	"path"
	"slices"
	"strings"
)

// VIP-32: dependency pins belong to the project, never to an Effect use site.
var EK3201 = message(3201, errorCategory, "The resolved effect is {0}; VibeLang {1} pins {2}: upgrade both together.")
var effectPinDiagnostic = EK3201

func init() { registry[EK3201.Code] = EK3201 }

var platformPinDiagnostic = EK3201.With("The resolved {0} is {1}; VibeLang {2} pins {3}: upgrade both together.")

func init() {
	compiler.RegisterProgramDiagnosticsHook(effectPinDiagnostics)
}

func effectPinDiagnostics(p *compiler.Program) []*ast.Diagnostic {
	var anchor *ast.SourceFile
	if config := p.CommandLine().ConfigFile; config != nil {
		anchor = config.SourceFile
	}
	versions := map[string]string{}
	add := func(name, version string) {
		if version != "" && version != supportedEffectVersion {
			if _, exists := versions[name]; !exists {
				versions[name] = version
			}
		}
	}
	// Resolve from every project source: a pinned package in a monorepo
	// does not prove that a sibling resolves the pin.
	for _, file := range p.SourceFiles() {
		if !isVibeLangFile(file) || p.IsSourceFileFromExternalLibrary(file) {
			continue
		}
		if anchor == nil {
			anchor = effectPinPackageAnchor(p, file)
		}
		for _, name := range []string{effectRootModule, "@effect/platform-node", "@effect/platform-bun", "@effect/platform-browser", "@effect/platform-node-shared"} {
			if resolved := p.ResolveModuleNameForFile(name, file); resolved != nil && resolved.IsResolved() {
				add(name, resolved.PackageId.Version)
			}
		}
		for key, resolved := range p.GetResolvedModules()[file.PathKey()] {
			if resolved == nil || !resolved.IsResolved() {
				continue
			}
			name := key.Name
			if !strings.HasPrefix(name, "@effect/platform-") {
				continue
			}
			// A subpath is still the same package; its package identity comes
			// from the resolved manifest, not an import-site version range.
			if slash := strings.IndexByte(name[len("@effect/"):], '/'); slash >= 0 {
				name = name[:len("@effect/")+slash]
			}
			add(name, resolved.PackageId.Version)
		}
	}
	// With no config or package manifest, keep the project error locationless.
	var result []*ast.Diagnostic
	for _, name := range slices.Sorted(stdmaps.Keys(versions)) {
		version := versions[name]
		message := format(platformPinDiagnostic.Text, []any{name, version, Version, supportedEffectVersion})
		if name == effectRootModule {
			message = format(effectPinDiagnostic.Text, []any{version, Version, supportedEffectVersion})
		}
		d := ast.NewExternalDiagnostic(anchor, core.NewTextRange(0, 0), diagnosticSource, errorCategory, EK3201.Code, message)
		note(d, "Install {0}@{1} where this project resolves it, or move to the VibeLang release that pins {0}@{2}.", name, supportedEffectVersion, version)
		result = append(result, d)
	}
	return result
}

// Inferred and command-line projects use their nearest package manifest.
func effectPinPackageAnchor(p *compiler.Program, file *ast.SourceFile) *ast.SourceFile {
	fs := p.Host().FS()
	for dir := path.Dir(file.FileName().AsString()); ; dir = path.Dir(dir) {
		name := tspath.RootedFilePathFromAbsolute(path.Join(dir, "package.json"))
		if text, ok := fs.ReadFile(name); ok {
			return parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: name, PathKey: fs.CaseSensitivity().PathKey(tspath.RootedPath(name))}, text, core.ScriptKindJSON)
		}
		if path.Dir(dir) == dir {
			return nil
		}
	}
}
