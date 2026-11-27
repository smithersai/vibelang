package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	stdmaps "maps"
	"slices"
	"strconv"
	"strings"
)

// VIP-32 (amended): VibeLang accepts any stable Effect >=4.1.0 <5.0.0 (^4.1.0),
// tested against supportedEffectVersion. Dependency constraints belong to the
// project, never to an Effect use site.
var EK3201 = message(3201, errorCategory, "The resolved effect is {0}; VibeLang {1} requires {2} (tested on {3}): upgrade both together.")
var effectPinDiagnostic = EK3201

func init() { registerDiagnostic(EK3201) }

var platformPinDiagnostic = EK3201.With("The resolved {0} is {1}; VibeLang {2} requires {3} (tested on {4}): upgrade both together.")

func init() {
	compiler.RegisterProgramDiagnosticsHook(effectPinDiagnostics)
}

// isSupportedEffectVersion reports whether version is a stable semver
// satisfying ^4.1.0 (>=4.1.0 <5.0.0, no prereleases or build suffixes).
func isSupportedEffectVersion(version string) bool {
	parts := strings.Split(version, ".")
	if len(parts) != 3 {
		return false
	}
	var nums [3]int
	for i, part := range parts {
		if len(part) == 0 || (len(part) > 1 && part[0] == '0') {
			return false
		}
		for j := range len(part) {
			if part[j] < '0' || part[j] > '9' {
				return false
			}
		}
		n, err := strconv.Atoi(part)
		if err != nil {
			return false
		}
		nums[i] = n
	}
	return nums[0] == 4 && nums[1] >= 1
}

func effectPinDiagnostics(p *compiler.Program) []*ast.Diagnostic {
	var anchor *ast.SourceFile
	if config := p.CommandLine().ConfigFile; config != nil {
		anchor = config.SourceFile
	}

	versions := map[string]string{}
	add := func(name, version string) {
		if version != "" && !isSupportedEffectVersion(version) {
			if _, exists := versions[name]; !exists {
				versions[name] = version
			}
		}
	}
	// Resolve from every project source: a compatible package in one workspace
	// member does not prove that a sibling resolves a supported version.
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
		message := format(platformPinDiagnostic.Text, []any{name, version, Version, supportedEffectRange, supportedEffectVersion})
		if name == effectRootModule {
			message = format(effectPinDiagnostic.Text, []any{version, Version, supportedEffectRange, supportedEffectVersion})
		}
		d := ast.NewExternalDiagnostic(anchor, core.NewTextRange(0, 0), diagnosticSource, errorCategory, EK3201.Code, message)
		// The compiler names only its own supported range and tested baseline,
		// never an unknown VibeLang release for the resolved version.
		note(d, "Install {0}@{1} (or any stable {2}) where this project resolves it: VibeLang {3} supports {0}@{2}.", name, supportedEffectVersion, supportedEffectRange, Version)
		result = append(result, d)
	}
	return result
}

// Inferred and command-line projects use their nearest package manifest.
func effectPinPackageAnchor(p *compiler.Program, file *ast.SourceFile) *ast.SourceFile {
	fs := p.Host().FS()
	anchor, _ := file.FileName().Directory().ForEachAncestorDirectory(func(dir tspath.RootedDirectoryPath) (*ast.SourceFile, bool) {
		name := dir.ResolveFile("package.json")
		if text, ok := fs.ReadFile(name); ok {
			return parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: name, PathKey: fs.CaseSensitivity().PathKey(tspath.RootedPath(name))}, text, core.ScriptKindJSON), true
		}
		return nil, false
	})
	return anchor
}
