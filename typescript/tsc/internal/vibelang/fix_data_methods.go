package vibelang

import (
	"context"
	stdmaps "maps"
	"slices"
	"strconv"
	"strings"
	"sync"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

const dataMethodMigrationLabel = "data-method namespace calls"

// Only the checker's synthetic accesses qualify. Same-spelling own/native
// methods and namespaces never enter methodState. Optional chains, computed
// accesses and extracted functions have no legacy call lowering to preserve.
func legacyDataMethodCalls(c *checker.Checker, file *ast.SourceFile) []*ast.Node {
	var calls []*ast.Node
	for access := range methodStateOf(c).accesses {
		if ast.GetSourceFileOfNode(access) != file {
			continue
		}
		call := access.Parent
		if call != nil && ast.IsCallExpression(call) && call.Expression() == access && !ast.IsOptionalChain(call) {
			calls = append(calls, call)
		}
	}
	// Inner calls first. A later round rechecks a chain's outer call.
	slices.SortFunc(calls, func(a, b *ast.Node) int {
		if size := (a.End() - a.Pos()) - (b.End() - b.Pos()); size != 0 {
			return size
		}
		return a.Pos() - b.Pos()
	})
	return calls
}

// Reuse a module binding only when it resolves at the call to the actual
// namespace. Never introduce a name that could capture a local binding.
func dataMethodMigrationNamespace(c *checker.Checker, file *ast.SourceFile, access *ast.Node, module string) string {
	if namesPreludeModule(c, access, module) {
		return module
	}
	namespace := effectModuleNamespace(c, file, module)
	for _, binding := range importBindingsOf(file) {
		if binding.declaration.ImportClause().AsImportClause().IsTypeOnly() || binding.declaration.ImportClause().AsImportClause().PhaseModifier == ast.KindDeferKeyword {
			continue
		}
		if ast.IsImportSpecifier(binding.node) && binding.node.AsImportSpecifier().IsTypeOnly {
			continue
		}
		bound := c.ResolveName(binding.name, access, ast.SymbolFlagsValue, false)
		declared := binding.node
		if !ast.IsIdentifier(declared) {
			declared = declared.Name()
		}
		if declared == nil || bound == nil || c.GetSymbolAtLocation(declared) != bound {
			continue // a different binding of the same namespace can still shadow it
		}
		symbol := bound
		if symbol != nil && symbol.Flags()&ast.SymbolFlagsAlias != 0 {
			symbol = c.GetAliasedSymbol(symbol)
		}
		if symbol != nil && symbol == namespace {
			return binding.name
		}
	}
	return ""
}

func dataMethodMigrationEdits(c *checker.Checker, file *ast.SourceFile, call *ast.Node) ([]sourceEdit, string) {
	access := call.Expression()
	module := methodModuleOf(c, access)
	namespace := dataMethodMigrationNamespace(c, file, access, module)
	if namespace == "" {
		return nil, "no namespace binding can be reused without changing scope or import evaluation; add a namespace import from effect/" + module + " under a free value name first"
	}
	if call.TypeArguments() != nil || isBlockParamCall(call) {
		return nil, "explicit type arguments or a trailing block need an explicit namespace call"
	}
	receiver := access.Expression()
	text := file.Text()
	if receiver.End() < 0 || receiver.End() > len(text) || access.End() < receiver.End() || access.End() > len(text) {
		return nil, "the recovered call has no complete source span"
	}
	dot := scanner.SkipTrivia(text, receiver.End())
	open := scanner.SkipTrivia(text, access.End())
	if dot >= len(text) || text[dot] != '.' || open >= len(text) || text[open] != '(' {
		return nil, "the recovered call has no ordinary dotted argument list"
	}
	separator := ""
	if len(call.Arguments()) > 0 {
		separator = ", "
	}
	// Keep every trivia byte. The module property is read before the receiver
	// just as in the legacy lowering; the receiver and arguments occur once,
	// in precisely their old order. No closure, capture or new run is introduced.
	return []sourceEdit{
		{nodeStart(file, receiver), nodeStart(file, receiver), namespace + "." + access.Name().Text() + "("},
		{dot, dot + 1, ""},
		{nodeStart(file, access.Name()), access.Name().End(), ""},
		{open, open + 1, separator},
	}, ""
}

func dataMethodMigrationFixes(ctx context.Context, program *compiler.Program, file *ast.SourceFile, refused map[string]bool, refuse func(FixRefusal, string), fresh func(map[tspath.RootedFilePath]string) *compiler.Program, texts map[tspath.RootedFilePath]string) proposal {
	p := proposal{file: file}
	c, done := program.GetTypeCheckerForFile(ctx, file)
	var taken []sourceEdit
	for _, call := range legacyDataMethodCalls(c, file) {
		key := "dataMethod:" + file.FileName().AsString() + ":" + strconv.Itoa(nodeStart(file, call)) + ":" + expressionText(file, call)
		if refused[key] {
			continue
		}
		edits, why := dataMethodMigrationEdits(c, file, call)
		if why != "" {
			line, _ := scannerLineOf(file, nodeStart(file, call))
			refuse(FixRefusal{File: file.FileName(), Line: line + 1, Rewrite: dataMethodMigrationLabel, Error: why}, key)
			continue
		}
		if slices.ContainsFunc(edits, func(e sourceEdit) bool { return overlapsAny(e, taken) }) {
			continue
		}
		p.fixes = append(p.fixes, fileFix{edits: edits, key: key, label: dataMethodMigrationLabel})
		taken = append(taken, edits...)
	}
	done()
	if len(p.fixes) == 0 {
		return p
	}
	// Moving a receiver from 'this' to parameter zero can affect overload and
	// generic inference without adding an error. Compare actual declaration
	// bytes, even under noEmit, before proposing the rewrite to the error gate.
	names := []tspath.RootedFilePath{file.FileName()}
	before := declarationsOf(ctx, program, names)
	overlay := stdmaps.Clone(texts)
	overlay[file.FileName()] = p.text()
	candidate := fresh(overlay)
	after := declarationsOf(ctx, candidate, names)
	if before[file.FileName()] == "" || !stdmaps.Equal(before, after) {
		for _, f := range p.fixes {
			line, _ := scannerLineOf(file, firstEdit(f.edits))
			refuse(FixRefusal{File: file.FileName(), Line: line + 1, Rewrite: dataMethodMigrationLabel, Error: "the namespace call changes public declaration bytes; write and verify an explicit overload or type annotation"}, f.key)
		}
		p.fixes = nil
	}
	if len(p.fixes) > 0 {
		beforeImports, beforeOK := dataMethodRuntimeImports(ctx, program, file)
		afterImports, afterOK := dataMethodRuntimeImports(ctx, candidate, candidate.GetSourceFile(file.FileName()))
		same := beforeOK && afterOK && stdmaps.EqualFunc(beforeImports, afterImports, func(a, b dataMethodImportSchedule) bool {
			return a.nonModuleText == b.nonModuleText && slices.Equal(a.dependencies, b.dependencies)
		})
		if !same {
			for _, f := range p.fixes {
				line, _ := scannerLineOf(file, firstEdit(f.edits))
				refuse(FixRefusal{File: file.FileName(), Line: line + 1, Rewrite: dataMethodMigrationLabel, Error: dataMethodImportReason(beforeImports, afterImports, beforeOK && afterOK)}, f.key)
			}
			p.fixes = nil
		}
	}

	return p
}

// Each first static module request fixes dependency evaluation order. Import
// aliases do not matter, and repeated identical requests evaluate once. An
// alias whose existing import stays live can still move Effect initialization
// past user code when the legacy lowering's prepended import disappears.
type dataMethodImportSchedule struct {
	dependencies  []string
	nonModuleText string
}

func dataMethodRuntimeImports(ctx context.Context, program *compiler.Program, file *ast.SourceFile) (map[tspath.RootedFilePath]dataMethodImportSchedule, bool) {
	result := map[tspath.RootedFilePath]dataMethodImportSchedule{}
	valid := file != nil
	if !valid {
		return result, false
	}
	var mu sync.Mutex
	emitted := program.Emit(ctx, compiler.EmitOptions{TargetSourceFiles: []*ast.SourceFile{file}, EmitOnly: compiler.EmitOnlyJs, ForceEmit: true, WriteFile: func(name tspath.RootedFilePath, text string, _ *compiler.WriteFileData) error {
		path := name.AsString()
		if !strings.HasSuffix(path, ".js") && !strings.HasSuffix(path, ".mjs") && !strings.HasSuffix(path, ".cjs") && !strings.HasSuffix(path, ".jsx") {
			return nil
		}
		kind := core.ScriptKindJS
		if strings.HasSuffix(path, ".jsx") {
			kind = core.ScriptKindJSX
		}
		js := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: name, PathKey: tspath.PathKey(name)}, text, kind)
		schedule := dataMethodImportSchedule{}
		seen := map[string]bool{}
		for _, statement := range js.Statements.Nodes {
			var specifier, attributes *ast.Node
			phase := ast.KindUnknown
			switch {
			case ast.IsImportDeclaration(statement):
				imp := statement.AsImportDeclaration()
				specifier, attributes = imp.ModuleSpecifier, imp.Attributes
				if imp.ImportClause != nil {
					phase = imp.ImportClause.AsImportClause().PhaseModifier
				}
			case ast.IsExportDeclaration(statement):
				exp := statement.AsExportDeclaration()
				specifier, attributes = exp.ModuleSpecifier, exp.Attributes
			default:
				continue
			}
			if specifier == nil {
				continue
			}
			if !ast.IsStringLiteral(specifier) {
				continue
			}
			attributeText := ""
			if attributes != nil {
				attributeText = expressionText(js, attributes)
			}
			key := specifier.Text() + "|" + strconv.Itoa(int(phase)) + "|" + attributeText
			if !seen[key] {
				schedule.dependencies = append(schedule.dependencies, key)
				seen[key] = true
			}
		}
		// CommonJS/AMD/etc. imports can interleave with body effects. Until a
		// matching schedule proof exists, accept only byte-identical non-ESM output.
		if len(schedule.dependencies) == 0 {
			schedule.nonModuleText = text
		}
		mu.Lock()
		result[name] = schedule
		valid = valid && len(js.Diagnostics()) == 0
		mu.Unlock()
		return nil
	}})
	return result, valid && !emitted.EmitSkipped && len(result) > 0
}

// Report core module order, while keeping arbitrary customer module URLs and
// import attributes out of diagnostics.
func dataMethodImportReason(before, after map[tspath.RootedFilePath]dataMethodImportSchedule, valid bool) string {
	reason := "cannot prove unchanged runtime module evaluation order"
	if valid {
		for _, name := range slices.Sorted(stdmaps.Keys(before)) {
			a, b := before[name], after[name]
			if a.nonModuleText != b.nonModuleText {
				reason = "non-ESM JavaScript changed"
				break
			}
			if !slices.Equal(a.dependencies, b.dependencies) {
				describe := func(deps []string) string {
					labels := make([]string, 0, len(deps))
					for _, dep := range deps {
						module := strings.SplitN(dep, "|", 2)[0]
						if !(strings.HasPrefix(module, "effect/") && methodModules[strings.TrimPrefix(module, "effect/")]) && module != "effect" && module != "vibelang-runtime" {
							module = "<project import>"
						}
						labels = append(labels, module)
					}
					return "[" + strings.Join(labels, ", ") + "]"
				}
				reason = "runtime module evaluation order changes: " + describe(a.dependencies) + " -> " + describe(b.dependencies)
				break
			}
		}
	}
	return reason + "; preserve the old import initialization position and verify an explicit call"
}
