package vibelang

import (
	"context"
	"slices"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/astnav"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

type missingRuntimeStateKey struct{}
type missingRuntimeState struct {
	scanning, scanned bool
	owner             *ast.SourceFile
	dependency        *ast.Diagnostic
	needs             map[*ast.SourceFile]bool
}

func missingRuntimeStateOf(c *checker.Checker) *missingRuntimeState {
	return c.ExtensionState(missingRuntimeStateKey{}, func() any {
		return &missingRuntimeState{needs: map[*ast.SourceFile]bool{}}
	}).(*missingRuntimeState)
}

func init() {
	checker.RegisterDiagnosticsPreparationHook(prepareMissingRuntimeDiagnostics)
	checker.RegisterDiagnosticsFilterHook(missingRuntimeDiagnostics)
}

func prepareMissingRuntimeDiagnostics(c *checker.Checker, _ *ast.SourceFile) {
	state := missingRuntimeStateOf(c)
	// A native TypeScript file can be checked before the VibeLang source
	// that needs the runtime. Establish the project's one dependency error
	// before filtering diagnostics from either language.
	if state.scanning || state.scanned {
		return
	}
	if !state.scanned {
		state.scanning = true
		files := slices.Clone(c.Program().SourceFiles())
		slices.SortFunc(files, func(a, b *ast.SourceFile) int { return a.FileName().Compare(b.FileName()) })
		for _, candidate := range files {
			if !isVibeLangFile(candidate) || c.Program().IsSourceFileFromExternalLibrary(candidate) ||
				runtimeInstalledFor(c, candidate) {
				continue
			}
			c.GetDiagnostics(context.Background(), candidate)
			p := newFilePlan()
			populateFilePlan(c, candidate, p)
			tx := &lowering{plan: p, frames: findFrameReferences(candidate), fresh: freshNames{file: candidate}}
			tx.NewTransformer(tx.visit, nil)
			lowered := tx.TransformSourceFile(candidate)
			needed := tx.runtime != nil
			for _, statement := range lowered.Statements.Nodes {
				if ast.IsImportDeclaration(statement) {
					module := statement.AsImportDeclaration().ModuleSpecifier.Text()
					if module == runtimeModule || strings.HasPrefix(module, runtimeModule+"/") {
						needed = true
					}
				}
			}
			state.needs[candidate] = needed
			if needed && state.owner == nil {
				state.owner = candidate
			}
		}
		state.scanning, state.scanned = false, true
	}
	if state.owner != nil {
		at := state.owner.AsNode()
		if len(state.owner.Statements.Nodes) != 0 {
			at = state.owner.Statements.Nodes[0]
		}
		d := checker.NewDiagnosticForNode(at, diagnostics.Cannot_find_module_0_or_its_corresponding_type_declarations, runtimeModule)
		state.dependency = note(d, "Install {0} at the version of vibelang.", runtimeModule)
		c.AddDiagnostic(state.dependency)
	}
}

func missingRuntimeDiagnostics(c *checker.Checker, file *ast.SourceFile, all []*ast.Diagnostic) []*ast.Diagnostic {
	state := missingRuntimeStateOf(c)
	if state.scanning || !state.scanned {
		return all
	}

	if state.owner == nil {
		return all
	}
	kept := make([]*ast.Diagnostic, 0, len(all)+1)
	for _, d := range all {
		// Written imports of this same absent package are the dependency
		// failure already reported once, not independent source errors.
		if d != state.dependency && d.Source() == "" && d.Code() == 2307 && len(d.MessageArgs()) != 0 {
			module := d.MessageArgs()[0]
			if module == runtimeModule || strings.HasPrefix(module, runtimeModule+"/") {
				source := d.File()
				if source == nil {
					source = file
				}
				// A missing subpath of an installed package is independent
				// of a different source's absent runtime installation.
				if source != nil && !runtimeInstalledFor(c, source) {
					continue
				}
			}
		}
		if isVibeLangFile(file) && state.needs[file] && d.Source() == "" {
			if missingNameCodes[d.Code()] && len(d.MessageArgs()) != 0 {
				if _, ok := preludeModules[d.MessageArgs()[0]]; ok && !writtenEffectModuleDisabled(c, file, d, d.MessageArgs()[0]) {
					continue
				}
			}
			// A missing generated helper cannot contextually type its callbacks.
			// Keep unrelated names and source errors inside those callbacks.
			if (d.Code() == 7006 || d.Code() == 7019 || d.Code() == 7031) && missingRuntimeHelperAncestor(astnav.GetTokenAtPosition(file, d.Pos())) {
				continue
			}
		}
		kept = append(kept, d)
	}
	return kept
}

func missingRuntimeHelperAncestor(node *ast.Node) bool {
	for node != nil {
		if ast.IsFunctionLike(node) {
			// A missing helper removes only its own callback's contextual
			// type. Never suppress errors in a nested written callable.
			parent := node.Parent
			for parent != nil && ast.IsParenthesizedExpression(parent) {
				parent = parent.Parent
			}
			if parent == nil || !ast.IsCallExpression(parent) {
				return false
			}
			callee := parent.Expression()
			return ast.IsIdentifier(callee) && callee.Flags&ast.NodeFlagsVibeLangIntrinsic != 0 &&
				preludeModules[callee.Text()] == runtimeModule
		}
		node = node.Parent
	}
	return false
}

// runtimeInstalledFor reports whether file resolves vibelang-runtime. The
// prelude requests the module only for files it predicts need it; a file whose
// lowering needs the runtime anyway (an annotated effect arrow, a plain try)
// never resolved it, so ask the resolver before calling the package missing.
func runtimeInstalledFor(c *checker.Checker, file *ast.SourceFile) bool {
	if runtimeModuleSymbol(c, preludeStateOf(c), file) != nil {
		return true
	}
	resolved := c.Program().ResolveModuleNameForFile(runtimeModule, file)
	return resolved != nil && resolved.IsResolved()
}
