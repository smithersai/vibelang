package vibelang

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// Legacy platform markers report EK2601 without adding startup.
// Programs explicitly call their runner and provide the required layers.

// platformNodeModule is the package whose NodeRuntime runs an entry module.
const platformNodeModule = "@effect/platform-node"

// platformImportPrefix starts the specifier of a platform import.
const platformImportPrefix = "vibelang/platform/"

// A platformBundle is the export of a module whose layer member provides a
// platform's services, as @effect/platform-node's NodeServices.layer does.
type platformBundle struct {
	module    string // the module specifier
	namespace string // the export whose layer the entry provides
}

// An entryPlatform is a platform that a platform import names, with the
// runtime whose runMain runs main when its package resolves, and its
// bundles: Effect's, and VibeLang's experimental one, which provides the
// services Effect lacks (D313).
type entryPlatform struct {
	name                 string // the name after platformImportPrefix
	runtime              platformBundle
	effect, experimental platformBundle
}

// nodeRuntime is the runtime of a file that names Node, Bun or no platform
// (D135).
var nodeRuntime = platformBundle{platformNodeModule, "NodeRuntime"}

// entryPlatforms are the platforms a platform import can name.
var entryPlatforms = []entryPlatform{
	{"node", nodeRuntime, platformBundle{platformNodeModule, "NodeServices"}, platformBundle{"vibelang-runtime/experimental/platform-node", "ExperimentalNodeServices"}},
	{"bun", nodeRuntime, platformBundle{"@effect/platform-bun", "BunServices"}, platformBundle{"vibelang-runtime/experimental/platform-bun", "ExperimentalBunServices"}},
	{"browser", platformBundle{"@effect/platform-browser", "BrowserRuntime"}, platformBundle{"@effect/platform-browser", "BrowserServices"}, platformBundle{"vibelang-runtime/experimental/platform-browser", "ExperimentalBrowserServices"}},
}

// entryRuntime returns the runtime whose runMain runs file's main when its
// package resolves: the named platform's, or NodeRuntime when file names
// none.
func entryRuntime(file *ast.SourceFile) platformBundle {
	if platform := namedPlatform(file); platform != nil {
		return platform.runtime
	}
	return nodeRuntime
}

func init() {
	fileChecks = append(fileChecks, checkPlatformImports)
}

// checkPlatformImports reports EK2601 at each platform import of file, and
// EK3206 at each one that names a platform other than the first one file
// names: a file ran on one platform, and source order was no way to choose it.
func checkPlatformImports(c *checker.Checker, file *ast.SourceFile) {
	var first *entryPlatform
	for _, statement := range file.Statements.Nodes {
		platform := platformImport(statement)
		if platform == nil {
			continue
		}
		specifier := statement.AsImportDeclaration().ModuleSpecifier
		report(c, specifier, EK2601)
		if first == nil {
			first = platform
		} else if platform != first {
			d := report(c, specifier, EK3206, first.name, platform.name)
			note(d, "Keep one platform import in this file, and start a separate entry file for each platform.")
		}
	}
}

// namedPlatform returns the platform that file names with a platform import,
// the first when it names several (EK3206), or nil. It reads only syntax, so
// the implicit imports can use it.
func namedPlatform(file *ast.SourceFile) *entryPlatform {
	for _, statement := range file.Statements.Nodes {
		if platform := platformImport(statement); platform != nil {
			return platform
		}
	}
	return nil
}

// platformImport returns the platform that statement names when it is a
// platform import, `import "vibelang/platform/node"`, or nil.
func platformImport(statement *ast.Node) *entryPlatform {
	if !ast.IsImportDeclaration(statement) || statement.AsImportDeclaration().ImportClause != nil {
		return nil
	}
	specifier := statement.AsImportDeclaration().ModuleSpecifier
	if !ast.IsStringLiteral(specifier) {
		return nil
	}
	name, ok := strings.CutPrefix(specifier.Text(), platformImportPrefix)
	if !ok {
		return nil
	}
	for i := range entryPlatforms {
		if entryPlatforms[i].name == name {
			return &entryPlatforms[i]
		}
	}
	return nil
}

// entryModules are the modules that file, an entry candidate, resolves as
// implicit imports (implicitRuntimeImport), so the plan can ask which are
// installed: its runtime's package, and the bundles of the platform it names.
func entryModules(file *ast.SourceFile) []string {
	modules := []string{entryRuntime(file).module}
	if platform := namedPlatform(file); platform != nil {
		modules = append(modules, platform.effect.module, platform.experimental.module)
	}
	return modules
}

// entryCandidate returns a marked file's exported main function declaration
// with no parameters, or nil. It reads only syntax, so the implicit imports
// can use it; a candidate whose module starts its program itself still
// resolves the modules an entry would use, which loads them and nothing more.
func entryCandidate(file *ast.SourceFile) *ast.Node {
	// VIP-26: unmarked modules execute only their written top-level code.
	// Only a legacy platform marker selects the remaining entry migration.
	if !isVibeLangFile(file) || namedPlatform(file) == nil {
		return nil
	}
	var main *ast.Node
	for _, statement := range file.Statements.Nodes {
		if statement.Kind == ast.KindFunctionDeclaration && statement.Name() != nil && statement.Name().Text() == "main" &&
			ast.HasSyntacticModifier(statement, ast.ModifierFlagsExport) && !ast.HasSyntacticModifier(statement, ast.ModifierFlagsDefault) &&
			len(statement.Parameters()) == 0 && statement.Body() != nil {
			main = statement
		}
	}
	return main
}

// entryMain returns file's entry candidate, or nil when file has none or
// starts a program at its top level by calling a runner.
func entryMain(c *checker.Checker, file *ast.SourceFile) *ast.Node {
	if !file.FileName().IsVibeLangSource() {
		return nil // a TypeScript source with the directive runs what it calls, as TypeScript does (VIP-42)
	}
	main := entryCandidate(file)
	if main == nil {
		return nil
	}
	for _, statement := range file.Statements.Nodes {
		if containsTopLevelRunner(c, statement) {
			return nil
		}
	}
	return main
}

// containsTopLevelRunner finds runner calls in expressions and initializers
// that execute during module evaluation, without descending into delayed
// function bodies or instance field initializers.
func containsTopLevelRunner(c *checker.Checker, node *ast.Node) bool {
	if ast.IsFunctionLike(node) {
		return false
	}
	if node.Kind == ast.KindPropertyDeclaration && !ast.HasSyntacticModifier(node, ast.ModifierFlagsStatic) {
		return false
	}
	return startsProgram(c, node) || node.ForEachChild(func(child *ast.Node) bool { return containsTopLevelRunner(c, child) })
}

// startsProgram reports whether expression calls a runner that starts a
// program, by the declaration the call resolves to: a runner of Effect's or
// a platform's (runnerOf), such as Effect.runPromise, the prelude's
// runPromise or NodeRuntime.runMain; the runtime's runMain; or a runner that
// effect's Runtime.makeRunMain made. A method or function of the program's
// own named runSync or runMain is not one.
func startsProgram(c *checker.Checker, expression *ast.Node) bool {
	expression = ast.SkipParentheses(expression)
	if !ast.IsCallExpression(expression) {
		return false
	}
	if runnerOf(c, expression) == programRunner {
		return true
	}
	d, ok := calleeIdentity(c, expression)
	switch {
	case !ok:
		return false
	case d.pkg == runtimeModule:
		return d.name == "runMain" || d.name == "$runMain"
	case d.pkg == "effect" && d.module == "Runtime" && d.name == "makeRunMain":
		// Runtime.makeRunMain(f) makes a runner and starts nothing; calling
		// the runner, whose signature the declared type returns, starts one.
		return signatureDeclaration(c, expression).Parent != d.owner
	}
	return false
}

// entryBundles returns the bundles whose layers the entry provides to main,
// the main of file, outermost first, and the services they provide; or none
// when file names no platform or main needs none of its bundles' services.
// A main that needs only services Effect's bundle provides gets that one. A
// main that needs a service only the experimental bundle provides gets the
// experimental one, which holds Effect's when its layer declares Effect's
// services too, so the platform's services are built once; Effect's comes
// outside it only for a service the experimental bundle does not declare, or
// when the experimental layer needs services itself.
func entryBundles(c *checker.Checker, file *ast.SourceFile, main *ast.Node) ([]platformBundle, *checker.Type) {
	platform := namedPlatform(file)
	if platform == nil || resolvedModuleFile(c, file, platform.effect.module) == nil {
		// The platform must resolve from the entry itself. Its experimental
		// bundle may see a private platform dependency that the entry cannot
		// import; that does not install the named platform for this project.
		return nil, nil
	}
	needed := neededServices(c, main)
	effect, _ := bundleServices(c, file, platform.effect)
	experimental, experimentalNeeds := bundleServices(c, file, platform.experimental)
	var usesEffect, effectOnly, usesExperimental bool
	for _, service := range needed {
		byEffect, byExperimental := provides(c, effect, service), provides(c, experimental, service)
		usesEffect = usesEffect || byEffect
		effectOnly = effectOnly || byEffect && !byExperimental
		usesExperimental = usesExperimental || byExperimental && !byEffect
	}
	var bundles []platformBundle
	var services []*checker.Type
	if effect != nil && (usesEffect && !usesExperimental || usesExperimental && (effectOnly || experimentalNeeds)) {
		bundles, services = append(bundles, platform.effect), append(services, effect)
	}
	if usesExperimental {
		bundles, services = append(bundles, platform.experimental), append(services, experimental)
	}
	if len(bundles) == 0 {
		return nil, nil
	}
	return bundles, c.GetUnionType(services)
}

// neededServices returns the services that main, an entry module's main,
// needs: the members of its program's R, or none when R is any.
func neededServices(c *checker.Checker, main *ast.Node) []*checker.Type {
	needed := runnerRequirements(c, c.GetTypeAtLocation(main.Name()))
	if needed == nil || needed.Flags()&(checker.TypeFlagsAny|checker.TypeFlagsUnknown) != 0 {
		return nil
	}
	return unionMembers(needed)
}

// provides reports whether service is one of services, which may be nil: a
// member of services that service is assignable to and that is assignable to
// service. A layer provides a service by its key, so a service whose type
// only extends a bundle's is not that service: an implementation of Effect's
// FileSystem with more members, under a key of its own, is not provided by a
// layer of Effect's FileSystem, though Effect's types, which exclude by
// assignability, would let it pass (D313).
func provides(c *checker.Checker, services *checker.Type, service *checker.Type) bool {
	if services == nil {
		return false
	}
	for _, member := range unionMembers(services) {
		if c.IsTypeAssignableTo(service, member) && c.IsTypeAssignableTo(member, service) {
			return true
		}
	}
	return false
}

// platformNote returns what EK3205 adds at file's main when the platform
// that file names is not installed, or "".
func platformNote(c *checker.Checker, file *ast.SourceFile) string {
	if platform := namedPlatform(file); platform != nil && resolvedModuleFile(c, file, platform.effect.module) == nil {
		return "import \"" + platformImportPrefix + platform.name + "\" names " + platform.effect.module + ", which is not installed."
	}
	return ""
}

// resolvedModuleFile returns the file of the module named name that file
// resolves, or nil.
func resolvedModuleFile(c *checker.Checker, file *ast.SourceFile, name string) *ast.SourceFile {
	program := c.Program()
	for key, resolved := range program.GetResolvedModules()[file.PathKey()] {
		if key.Name == name && resolved.IsResolved() {
			return program.GetSourceFileForResolvedModule(resolved)
		}
	}
	return nil
}

// bundleServices returns the services that bundle's layer provides, the Out
// of its declared Layer type, and whether the layer needs services itself,
// an In other than never; or nil when bundle does not resolve from file or
// declares no such layer.
func bundleServices(c *checker.Checker, file *ast.SourceFile, bundle platformBundle) (*checker.Type, bool) {
	moduleFile := resolvedModuleFile(c, file, bundle.module)
	if moduleFile == nil || moduleFile.Symbol == nil {
		return nil, false
	}
	namespace := c.TryGetMemberInModuleExports(bundle.namespace, moduleFile.Symbol)
	if namespace == nil {
		return nil, false
	}
	if namespace.Flags()&ast.SymbolFlagsAlias != 0 {
		namespace = c.GetAliasedSymbol(namespace)
	}
	layer := c.GetTypeOfPropertyOfType(c.GetTypeOfSymbol(namespace), "layer")
	if layer == nil {
		return nil, false
	}
	outputs, inputs, opaque, ok := layerParts(c, layer)
	if !ok || opaque || len(outputs) == 0 {
		return nil, false
	}
	return c.GetUnionType(outputs), len(inputs) > 0
}
