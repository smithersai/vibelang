package compiler

import (
	"slices"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/printer"
	"github.com/microsoft/TypeScript/tsc/internal/transformers"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// ScriptTransformerHook returns a transformer for sourceFile, or nil to leave
// the file alone. Hooks run first in the script transform pipeline, before
// TypeScript syntax is erased, so the transformer sees the parse tree and can
// ask opts.EmitResolver about types.
type ScriptTransformerHook func(opts *transformers.TransformOptions, sourceFile *ast.SourceFile) *transformers.Transformer

var scriptTransformerHooks []ScriptTransformerHook

// RegisterScriptTransformerHook adds hook to every JavaScript emit. Call it
// only from the init function of an in-tree package that tsc/cmd/tsc imports;
// registration is not synchronized.
func RegisterScriptTransformerHook(hook ScriptTransformerHook) {
	scriptTransformerHooks = append(scriptTransformerHooks, hook)
}

func getHookTransformers(opts *transformers.TransformOptions, sourceFile *ast.SourceFile) []*transformers.Transformer {
	var tx []*transformers.Transformer
	for _, hook := range scriptTransformerHooks {
		if t := hook(opts, sourceFile); t != nil {
			tx = append(tx, t)
		}
	}
	return tx
}

var directiveExemptSources []string

// RegisterDirectiveExemptSource exempts diagnostics whose Source is source
// from @ts-ignore and @ts-expect-error comments, which then neither hide them
// nor count as used. Call it only from the init function of an in-tree
// package that tsc/cmd/tsc imports; registration is not synchronized.
func RegisterDirectiveExemptSource(source string) {
	directiveExemptSources = append(directiveExemptSources, source)
}

func isDirectiveExempt(diagnostic *ast.Diagnostic) bool {
	return diagnostic.Source() != "" && slices.Contains(directiveExemptSources, diagnostic.Source())
}

// ImplicitImportHook returns modules that file uses without importing them.
// The program resolves each one from file, as it resolves tslib for
// importHelpers, and includes the module's file.
type ImplicitImportHook func(file *ast.SourceFile) []string

var implicitImportHooks []ImplicitImportHook

// RegisterImplicitImportHook adds hook to every program. Call it only from the
// init function of an in-tree package that tsc/cmd/tsc imports; registration
// is not synchronized.
func RegisterImplicitImportHook(hook ImplicitImportHook) {
	implicitImportHooks = append(implicitImportHooks, hook)
}

func implicitImports(file *ast.SourceFile) []string {
	var names []string
	for _, hook := range implicitImportHooks {
		names = append(names, hook(file)...)
	}
	return names
}

// DeclarationTransformerHook returns a transform for the declaration file
// emitted for sourceFile, which runs after TypeScript's own declaration
// transforms, or nil to leave the declaration file alone.
type DeclarationTransformerHook func(resolver printer.EmitResolver, sourceFile *ast.SourceFile) func(declarations *ast.SourceFile) *ast.SourceFile

var declarationTransformerHooks []DeclarationTransformerHook

// RegisterDeclarationTransformerHook adds hook to every declaration emit.
// Call it only from the init function of an in-tree package that tsc/cmd/tsc
// imports; registration is not synchronized.
func RegisterDeclarationTransformerHook(hook DeclarationTransformerHook) {
	declarationTransformerHooks = append(declarationTransformerHooks, hook)
}

func getHookDeclarationTransformers(resolver printer.EmitResolver, sourceFile *ast.SourceFile) []declarationTransformer {
	var tx []declarationTransformer
	for _, hook := range declarationTransformerHooks {
		if transform := hook(resolver, sourceFile); transform != nil {
			tx = append(tx, hookDeclarationTransformer(transform))
		}
	}
	return tx
}

// hookDeclarationTransformer adapts a hook's transform to the emitter.
type hookDeclarationTransformer func(declarations *ast.SourceFile) *ast.SourceFile

func (t hookDeclarationTransformer) TransformSourceFile(declarations *ast.SourceFile) *ast.SourceFile {
	return t(declarations)
}

func (t hookDeclarationTransformer) GetDiagnostics() []*ast.Diagnostic { return nil }

// EmbeddedModuleScriptHook reports whether module, the body of a VibeLang
// module declaration (ast.EmbeddedModule), emits JavaScript of its own: its
// file's JavaScript imports it.
type EmbeddedModuleScriptHook func(resolver printer.EmitResolver, options *core.CompilerOptions, module *ast.SourceFile) bool

var embeddedModuleScriptHook EmbeddedModuleScriptHook

// RegisterEmbeddedModuleScriptHook sets the hook that decides which module
// declaration bodies emit JavaScript. Call it only from the init function of
// an in-tree package that tsc/cmd/tsc imports; registration is not
// synchronized.
func RegisterEmbeddedModuleScriptHook(hook EmbeddedModuleScriptHook) {
	embeddedModuleScriptHook = hook
}

func embeddedModuleEmitsScript(resolver printer.EmitResolver, options *core.CompilerOptions, module *ast.SourceFile) bool {
	return embeddedModuleScriptHook == nil || embeddedModuleScriptHook(resolver, options, module)
}

var loaderRoot string

// SetLoaderRoot makes every program type-check and emit only the .vibe files
// under root, an absolute directory, for a module loader's compile: vibelang
// --loader-root, which packages/compiler/project.mjs passes. A loader serves
// only the JavaScript of the .vibe modules under its project's directory, and
// reports only the diagnostics of the module it loads; the runtime or bundler
// loads a .ts module itself. It compiles a module of another workspace package
// with that package's own project. So the program's other files, the .ts
// sources beside the .vibe ones and the sources of the workspace packages it
// imports, only supply types, and the checker reads only the types a .vibe
// file needs: checking a package's every .ts file made one module's cold
// load take seconds (opencode, bun:standalone-cold-project-compiles). An
// empty root checks and emits every file. Call it from the command's entry
// point before compiling; it is not synchronized.
func SetLoaderRoot(root string) {
	loaderRoot = root
}

// outsideLoaderRoot reports whether a loader's compile leaves file unchecked
// and unemitted: every file but a VibeLang source under the root, and the module
// declaration bodies (D283) of a VibeLang source the compile checks.
func outsideLoaderRoot(file *ast.SourceFile, caseSensitivity tspath.CaseSensitivity) bool {
	if loaderRoot == "" {
		return false
	}
	if canonical := file.CanonicalSourceFile(); canonical != nil {
		file = canonical
	}
	return file.IsDeclarationFile || !file.FileName().IsVibeLangSource() ||
		!tspath.ContainsPath(loaderRoot, string(file.FileName()), caseSensitivity)
}
