package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// Worker imports (VIP-57).
//
//	import statsWorker from "./stats.vibe" with { type: "worker" }
//
// binds statsWorker to a handle for the module as a worker entry. The
// module's default export is a Layer, and every service it provides is a
// schema service that the module exports (EK5702). The import has a default
// binding and nothing else (EK5703).
//
// The binding's type is Experimental.Rpc.WorkerHandle<L>, L the type of the
// module's default export, so Experimental.Rpc.workers(statsWorker, …) gives
// a layer of the services L provides and the handle is not itself a layer.
//
// The lowering replaces the import: the importing thread needs the services'
// keys and schemas, and nothing else of the module, so it imports those by
// name and makes the handle from the module's URL:
//
//	import { Stats as statsWorker$Stats } from "./stats.js"
//	const statsWorker = runtime.$worker(new URL("./stats.js", import.meta.url), [statsWorker$Stats])
//
// A host's worker layer starts the module in a thread with the runtime's
// worker entry, which serves the default export's schema services; a bundler
// plugin replaces the URL with the worker chunk it emits for the module.

var (
	// EK5702 (worker-default-export): a module imported as a worker whose
	// default export does not serve schema services. {0} is the specifier,
	// {1} what is wrong.
	EK5702 = message(5702, errorCategory, "{0} cannot be imported as a worker: {1}.")
	// EK5703 (worker-binding): a worker import that binds anything but a
	// default binding.
	EK5703 = message(5703, errorCategory, "A worker import binds one default name, the worker's handle: import worker from {0} with { type: \"worker\" }.")
)

func init() {
	registerDiagnostic(EK5702)
	registerDiagnostic(EK5703)
	fileChecks = append(fileChecks, checkWorkerImports)
	checker.RegisterExpressionTypeHook(workerHandleType)
}

// workerHandleModule and workerHandleName name the runtime's handle type:
// Experimental.Rpc.WorkerHandle.
const (
	workerHandleModule = "Rpc"
	workerHandleName   = "WorkerHandle"
)

// isWorkerImport reports whether node, an import or export declaration, has
// the import attribute type: "worker".
func isWorkerImport(node *ast.Node) bool {
	if node == nil || !ast.IsImportDeclaration(node) && !ast.IsExportDeclaration(node) {
		return false
	}
	var attributes *ast.Node
	if ast.IsImportDeclaration(node) {
		attributes = node.AsImportDeclaration().Attributes
	} else {
		attributes = node.AsExportDeclaration().Attributes
	}
	if attributes == nil || attributes.AsImportAttributes().Token != ast.KindWithKeyword || attributes.AsImportAttributes().Attributes == nil {
		return false
	}
	for _, attribute := range attributes.AsImportAttributes().Attributes.Nodes {
		a := attribute.AsImportAttribute()
		if name := a.Name(); name != nil && (ast.IsIdentifier(name) || ast.IsStringLiteral(name)) && name.Text() == "type" &&
			a.Value != nil && ast.IsStringLiteralLike(a.Value) && a.Value.Text() == "worker" {
			return true
		}
	}
	return false
}

// workerBinding returns the default binding of node, a worker import, or nil
// when the import binds anything else (EK5703).
func workerBinding(node *ast.Node) *ast.Node {
	if !ast.IsImportDeclaration(node) {
		return nil
	}
	clause := node.AsImportDeclaration().ImportClause
	if clause == nil || clause.IsTypeOnly() || clause.AsImportClause().PhaseModifier != ast.KindUnknown || clause.AsImportClause().NamedBindings != nil {
		return nil
	}
	return clause.Name()
}

// hasWorkerImport reports whether file, a .vibe file, has a worker import.
// Its bindings need the runtime's handle type.
func hasWorkerImport(file *ast.SourceFile) bool {
	for _, statement := range file.Statements.Nodes {
		if isWorkerImport(statement) {
			return true
		}
	}
	return false
}

// schemaServiceBrandProperty is the static brand stored on compiled schema
// service classes so .d.ts-imported schema services are recognized too.
const schemaServiceBrandProperty = "~vibelang-runtime/SchemaService"

// workerService is one schema service a worker module's default export
// provides: its declaring file (nil when exported by the worker module itself)
// and the export name in that module.
type workerService struct {
	sourceFile *ast.SourceFile
	export     string
}

// workerImport records one planned service import for a worker import statement.
// If moduleFile is nil, the service is imported from the worker module itself;
// otherwise it is imported from moduleFile (relative to the importing file).
type workerImport struct {
	moduleFile *ast.SourceFile
	export     string
}

// isSchemaServiceIdentifier reports whether identifier (a service type in a
// Layer's ROut) denotes a `schema service`, whether declared in a `.vibe` file
// or imported through a `.d.ts` declaration.
func isSchemaServiceIdentifier(c *checker.Checker, identifier *checker.Type) (*ast.Symbol, bool) {
	if identifier == nil {
		return nil, false
	}
	symbol := identifier.Symbol()
	if symbol == nil {
		return nil, false
	}
	symbol = c.SkipAlias(symbol)
	if symbol == nil {
		return nil, false
	}
	if decl := symbol.ValueDeclaration(); decl != nil && classKindOf(decl) == serviceClass && isSchemaService(decl) {
		return symbol, true
	}
	if staticType := c.GetTypeOfSymbol(symbol); staticType != nil && c.GetPropertyOfType(staticType, schemaServiceBrandProperty) != nil {
		return symbol, true
	}
	if c.GetPropertyOfType(identifier, schemaServiceBrandProperty) != nil {
		return symbol, true
	}
	return nil, false
}

// workerModuleServices returns the schema services that the default export
// of module, the module of a worker import, provides, or what is wrong with
// the module as a worker (EK5702).
func workerModuleServices(c *checker.Checker, module *ast.Symbol) (services []workerService, problem string) {
	exported := c.TryGetMemberInModuleExports("default", module)
	if exported == nil {
		return nil, "it has no default export, and a worker serves the Layer its module exports by default"
	}
	provided, _, _ := layerChannels(c, c.GetTypeOfSymbol(c.SkipAlias(exported)))
	if provided == nil {
		return nil, "its default export is not a Layer"
	}
	if provided.Flags()&checker.TypeFlagsNever != 0 {
		return nil, "its default export is a Layer that provides no service"
	}
	exports := c.GetExportsOfModule(module)
	for _, identifier := range unionMembers(provided) {
		symbol, ok := isSchemaServiceIdentifier(c, identifier)
		if !ok {
			return nil, "its default export provides " + c.TypeToString(identifier) + ", which is not a schema service"
		}
		name := ""
		var sourceFile *ast.SourceFile
		// Prefer exporting from the service's own declaring file when distinct from
		// the worker module (separate api.vibe + impl.vibe), else from the worker module.
		var declFile *ast.SourceFile
		if decl := symbol.ValueDeclaration(); decl != nil {
			declFile = ast.GetSourceFileOfNode(decl)
		}
		var workerFile *ast.SourceFile
		if decl := module.ValueDeclaration(); decl != nil && ast.IsSourceFile(decl) {
			workerFile = decl.AsSourceFile()
		}
		for _, exp := range exports {
			if exp.Name() != ast.InternalSymbolNameDefault && c.SkipAlias(exp) == symbol {
				name = exp.Name()
				break
			}
		}
		if name == "" && declFile != nil && declFile != workerFile && declFile.Symbol != nil {
			for _, exp := range c.GetExportsOfModule(declFile.Symbol) {
				if exp.Name() != ast.InternalSymbolNameDefault && c.SkipAlias(exp) == symbol {
					name = exp.Name()
					sourceFile = declFile
					break
				}
			}
		}
		if name == "" {
			return nil, "its default export provides " + symbol.Name() + ", which the module does not export; the importing thread needs the schema service to call it"
		}
		services = append(services, workerService{sourceFile: sourceFile, export: name})
	}
	return services, ""
}

func checkWorkerImports(c *checker.Checker, file *ast.SourceFile) {
	if !isVibeLangFile(file) {
		return
	}
	for _, statement := range file.Statements.Nodes {
		if !isWorkerImport(statement) {
			continue
		}
		specifier := statement.ModuleSpecifier()
		if specifier == nil {
			continue
		}
		if ast.IsImportDeclaration(statement) {
			if attrs := statement.AsImportDeclaration().Attributes; attrs != nil {
				coverCodes(c, attrs, 2823, 2857, 2322)
			}
			coverCodes(c, specifier, 5097)
		}
		text := `"` + specifier.Text() + `"`
		if workerBinding(statement) == nil {
			at := statement
			if ast.IsImportDeclaration(statement) {
				if clause := statement.AsImportDeclaration().ImportClause; clause != nil {
					at = clause
					if bindings := clause.AsImportClause().NamedBindings; bindings != nil {
						at = bindings
					}
				}
			}
			d := report(c, at, EK5703, text)
			note(d, "The handle goes to Experimental.Rpc.workers, which provides the worker's services; import a service's name from the module without the attribute.")
			continue
		}
		module := c.GetSymbolAtLocation(specifier)
		if module == nil {
			continue // TypeScript reports the unresolved module
		}
		if _, problem := workerModuleServices(c, module); problem != "" {
			coverCodes(c, statement, 1192) // TS1192: the missing default export, which EK5702 explains
			d := report(c, specifier, EK5702, text, problem)
			note(d, "Write export default Layer.succeed(Service, { … }) in the module, with Service an exported schema service.")
		}
	}
}

// workerBindingsKey keys the per-checker cache of worker bindings.
type workerBindingsKey struct{}

// workerBindings returns the names that file's worker imports bind.
func workerBindings(c *checker.Checker, file *ast.SourceFile) map[string]bool {
	cache := c.ExtensionState(workerBindingsKey{}, func() any { return map[*ast.SourceFile]map[string]bool{} }).(map[*ast.SourceFile]map[string]bool)
	names, ok := cache[file]
	if !ok {
		for _, statement := range file.Statements.Nodes {
			if !isWorkerImport(statement) {
				continue
			}
			if binding := workerBinding(statement); binding != nil {
				if names == nil {
					names = map[string]bool{}
				}
				names[binding.Text()] = true
			}
		}
		cache[file] = names
	}
	return names
}

// workerHandleType gives a reference to a worker import's binding the type
// Experimental.Rpc.WorkerHandle<L>, L being t, the type of the module's
// default export.
func workerHandleType(c *checker.Checker, node *ast.Node, t *checker.Type) *checker.Type {
	if t == nil || !ast.IsIdentifier(node) {
		return t
	}
	file := ast.GetSourceFileOfNode(node)
	if !isVibeLangFile(file) || !workerBindings(c, file)[node.Text()] {
		return t
	}
	symbol := c.GetSymbolAtLocation(node)
	if symbol == nil || symbol.Flags()&ast.SymbolFlagsAlias == 0 {
		return t
	}
	bound := false
	for _, declaration := range symbol.Declarations() {
		if ast.IsImportClause(declaration) && isWorkerImport(declaration.Parent) && workerBinding(declaration.Parent) != nil {
			bound = true
		}
	}
	if !bound {
		return t
	}
	handle := workerHandleInterface(c, file)
	if handle == nil {
		return t
	}
	return c.NewTypeReference(handle, []*checker.Type{t})
}

// workerHandleInterface returns the runtime's WorkerHandle<L> interface as
// file resolves it, or nil when the runtime that file resolves has none.
func workerHandleInterface(c *checker.Checker, file *ast.SourceFile) *checker.Type {
	module := runtimeModuleSymbol(c, preludeStateOf(c), file)
	if module == nil {
		return nil
	}
	member := func(parent *ast.Symbol, name string) *ast.Symbol {
		if parent == nil {
			return nil
		}
		if export := c.TryGetMemberInModuleExports(name, parent); export != nil {
			return c.SkipAlias(export)
		}
		return nil
	}
	handle := member(member(member(module, "Experimental"), workerHandleModule), workerHandleName)
	if handle == nil || handle.Flags()&ast.SymbolFlagsInterface == 0 {
		return nil
	}
	declared := c.GetDeclaredTypeOfSymbol(handle)
	if declared == nil || len(declared.AsInterfaceType().TypeParameters()) != 1 {
		return nil
	}
	return declared
}

// planWorkerImport records the schema service imports that node, a worker
// import, needs in the importing thread.
func (p *servicePlan) planWorkerImport(c *checker.Checker, node *ast.Node) {
	if !isWorkerImport(node) || workerBinding(node) == nil {
		return
	}
	imports := []workerImport{}
	if module := c.GetSymbolAtLocation(node.ModuleSpecifier()); module != nil {
		services, _ := workerModuleServices(c, module)
		for _, service := range services {
			imports = append(imports, workerImport{moduleFile: service.sourceFile, export: service.export})
		}
	}
	p.workers[node] = imports
}

// visitWorkerImport replaces node, a worker import, with the handle it
// binds: runtime.$worker(new URL(specifier, import.meta.url), [services]),
// importing each schema service by name from the worker module or its
// declaring module.
func (tx *lowering) visitWorkerImport(node *ast.Node) *ast.Node {
	f := tx.Factory()
	d := node.AsImportDeclaration()
	binding := d.ImportClause.Name()
	specifier := tx.outputSpecifier(d.ModuleSpecifier)
	fromFile := ast.GetSourceFileOfNode(node)
	var services []*ast.Node
	for _, entry := range tx.plan.workers[node] {
		if entry.moduleFile == fromFile {
			services = append(services, f.NewIdentifier(entry.export))
			continue
		}
		modSpec := specifier.Text()
		if entry.moduleFile != nil && fromFile != nil {
			rel := tspath.EnsurePathIsNonModuleName(tspath.GetRelativePathFromDirectory(
				fromFile.FileName().Directory().AsString(),
				entry.moduleFile.FileName().AsString(),
				tspath.CaseSensitive,
			))
			modSpec = tx.outputSpecifier(f.NewStringLiteral(rel, ast.TokenFlagsNone)).Text()
		}
		local := tx.fileName(binding.Text() + "$" + entry.export)
		tx.imports = append(tx.imports, namedImport{module: modSpec, name: entry.export, local: local})
		services = append(services, local)
	}
	var base *ast.Node
	if tx.commonJS {
		// CommonJS has no import.meta: require("node:url").pathToFileURL(__filename).
		url := f.NewCallExpression(f.NewIdentifier("require"), nil, nil, f.NewNodeList([]*ast.Node{f.NewStringLiteral("node:url", ast.TokenFlagsNone)}), ast.NodeFlagsNone)
		base = f.NewCallExpression(f.NewPropertyAccessExpression(url, nil, f.NewIdentifier("pathToFileURL"), ast.NodeFlagsNone), nil, nil, f.NewNodeList([]*ast.Node{f.NewIdentifier("__filename")}), ast.NodeFlagsNone)
	} else {
		meta := f.NewMetaProperty(ast.KindImportKeyword, f.NewIdentifier("meta"))
		base = f.NewPropertyAccessExpression(meta, nil /*questionDotToken*/, f.NewIdentifier("url"), ast.NodeFlagsNone)
	}
	url := f.NewNewExpression(f.NewIdentifier("URL"), nil /*typeArguments*/, f.NewNodeList([]*ast.Node{f.NewStringLiteral(specifier.Text(), ast.TokenFlagsNone), base}))
	handle := tx.runtimeCall("$worker", url, f.NewArrayLiteralExpression(f.NewNodeList(services), false /*multiLine*/))
	declaration := f.NewVariableDeclaration(f.NewIdentifier(binding.Text()), nil /*exclamationToken*/, nil /*typeNode*/, handle)
	statement := f.NewVariableStatement(nil /*modifiers*/, f.NewVariableDeclarationList(f.NewNodeList([]*ast.Node{declaration}), ast.NodeFlagsConst))
	tx.EmitContext().SetOriginal(statement, node)
	tx.EmitContext().AssignCommentAndSourceMapRanges(statement, node)
	return statement
}
