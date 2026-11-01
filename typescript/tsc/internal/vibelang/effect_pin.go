package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// VIP-32 (007 "The Effect version", Appendix B, decided detail 70): VibeLang pins
// exactly one Effect version. The compiler reads the resolved effect/package.json;
// any other version is EK3201, once per program, in the CLI and the editor.
var effectPinDiagnostic = EK3201.With("The resolved effect is {0}; VibeLang {1} pins {2}: upgrade both together.")

type effectPinStateKey struct{}
type effectPinState struct{ checked bool }

func init() {
	checker.RegisterDiagnosticsPreparationHook(prepareEffectPinDiagnostics)
}

// prepareEffectPinDiagnostics reports EK3201 at the first .vibe file a checker
// prepares diagnostics for, when the effect that file resolves is not the pin.
// A file that never asked for effect (a plain const module) resolves it on
// demand: the pin is a project property, not a per-use one. No resolution, or a
// package without a version, reports nothing here; the missing-name
// diagnostics of the uses that need Effect say what is absent.
func prepareEffectPinDiagnostics(c *checker.Checker, file *ast.SourceFile) {
	if !isVibeLangFile(file) || c.Program().IsSourceFileFromExternalLibrary(file) {
		return
	}
	state := c.ExtensionState(effectPinStateKey{}, func() any { return &effectPinState{} }).(*effectPinState)
	if state.checked {
		return
	}
	version := resolvedEffectVersion(c, file)
	if version == "" {
		if resolved := c.Program().ResolveModuleNameForFile(effectRootModule, file); resolved != nil && resolved.IsResolved() {
			version = resolved.PackageId.Version
		}
	}
	if version == "" || version == supportedEffectVersion {
		return
	}
	// A pinned source does not prove that another package in the same
	// program resolves the pin. Stop only once an off-pin source is reported.
	state.checked = true
	at := file.AsNode()
	if len(file.Statements.Nodes) != 0 {
		at = file.Statements.Nodes[0]
	}
	d := report(c, at, effectPinDiagnostic, version, Version, supportedEffectVersion)
	note(d, "Install effect@{0} where this project resolves effect, or move to the VibeLang release that pins effect@{1}.", supportedEffectVersion, version)
}
