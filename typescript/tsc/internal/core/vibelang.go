package core

import (
	"maps"
	"slices"
)

// VibeLangOptions is compilerOptions.vibelang in tsconfig.json, the
// project's VibeLang settings (design decision D34).
type VibeLangOptions struct {
	// VibeOnly distinguishes a modern section from an explicitly empty legacy
	// object, whose replacement semantics must remain intact during migration.
	VibeOnly bool `json:"-"`
	// InvalidSeverities shadows inherited entries during merging, without applying
	// an invalid value or exposing it in the effective serialized configuration.
	InvalidSeverities map[string]bool `json:"-"`
	// Severities is the release configuration, separate from legacy diagnostics.
	Severities map[string]string `json:"severities,omitzero"`
	// EffectGlobals controls the value exports of effect/Effect in .vibe files
	// (VIP-6). Unknown means true.
	EffectGlobals Tristate `json:"effectGlobals,omitzero"`
	EffectModules Tristate `json:"effectModules,omitzero"`
	// SidecarDir is vibe.sidecarDir, the absolute directory that holds the
	// project's declaration sidecars, or "" for x.d.vibe.ts beside x.vibe
	// (VIP-27, decided detail 268). It may still begin with ${configDir}
	// until the selected config's directory substitutes it.
	SidecarDir string `json:"sidecarDir,omitzero"`

	// TrustedPackages are package-name globs granted D22 trust (D261).
	TrustedPackages []string `json:"trustedPackages,omitzero"`
	// Diagnostics maps an EK code in VibeLangAdjustableCodes, such as "EK9204",
	// to "error", "warning", or "off".
	Diagnostics map[string]string `json:"diagnostics,omitzero"`
	// DeclarationImportStyle is ".js", "extensionless", or ".ts": how an
	// emitted declaration spells a relative import of a VibeLang module that
	// the source writes ./x.vibe, as ./x.js, ./x, or ./x.ts (D298). Empty
	// means ".js".
	DeclarationImportStyle string `json:"declarationImportStyle,omitzero"`
}

// DeclarationImportExtension returns the extension an emitted declaration
// gives a relative import of a VibeLang module: ".js", "" (extensionless), or
// ".ts".
func (o *VibeLangOptions) DeclarationImportExtension() string {
	if o == nil {
		return ".js"
	}
	switch o.DeclarationImportStyle {
	case "extensionless":
		return ""
	case ".ts":
		return ".ts"
	}
	return ".js"
}

// VibeLangAdjustableCodes are the EK codes whose category compilerOptions.vibelang
// and @vibelang-diagnostics comments may change (D34, D241): EK1012, EK9204, EK4403, EK4406, EK4409, EK9100,
// the rules taken from Effect's language service, EK4801-EK4825, except
// EK4813, which stands in for a TypeScript error, and the TypeScript-style
// forms, EK4830-EK4837. EK4838, an owned fiber that leaves its region, is an
// error no setting lowers (D386).
var VibeLangAdjustableCodes = []string{
	"EK1012", "EK9204", "EK3205", "EK4403", "EK4406", "EK4409", "EK9100",
	"EK4801", "EK4802", "EK4803", "EK4804", "EK4805", "EK4806", "EK4807", "EK4808", "EK4809", "EK4810",
	"EK4811", "EK4812", "EK4814", "EK4815", "EK4816", "EK4817", "EK4818", "EK4819", "EK4820",
	"EK4821", "EK4822", "EK4823", "EK4824", "EK4825",
	"EK4830", "EK4831", "EK4832", "EK4833", "EK4834", "EK4835", "EK4836", "EK4837", "EK4839", "EK4840", "EK4841", "EK4842", "EK4853", "EK4854", "EK4855", "EK4856",
}

// Equals reports whether o and other hold the same settings.
func (o *VibeLangOptions) Equals(other *VibeLangOptions) bool {
	if o == nil || other == nil {
		return o == other
	}
	return o.VibeOnly == other.VibeOnly && maps.Equal(o.Severities, other.Severities) && maps.Equal(o.InvalidSeverities, other.InvalidSeverities) && o.EffectGlobals == other.EffectGlobals && o.EffectModules == other.EffectModules && o.SidecarDir == other.SidecarDir && o.DeclarationImportStyle == other.DeclarationImportStyle && slices.Equal(o.TrustedPackages, other.TrustedPackages) && maps.Equal(o.Diagnostics, other.Diagnostics)
}

// VibeSeverityCode implements VIP-30/34/38, details 57 and 77. Legacy
// checker messages outside Appendix B remain available only through the legacy
// configuration. Appendix B categories, not legacy defaults, decide admission.
func VibeSeverityCode(code string) bool {
	category := VibeDiagnosticCategories[code]
	if category == "warning" || category == "lint warning" {
		return true
	}
	_, ok := VibeImportedLintCodes[code]
	return ok
}

// MergeVibeSettings merges release keys without changing legacy replacement
// semantics. Clone maps so siblings extending the same base stay independent.
func MergeVibeSettings(base, child *VibeLangOptions) *VibeLangOptions {
	if base == nil {
		return child
	}
	if child == nil {
		return base
	}
	result := *child
	if child.VibeOnly && !base.VibeOnly {
		result.VibeOnly = false
		result.Diagnostics = base.Diagnostics
		result.TrustedPackages = base.TrustedPackages
		result.DeclarationImportStyle = base.DeclarationImportStyle
	}
	result.Severities = maps.Clone(base.Severities)
	if child.Severities != nil {
		if result.Severities == nil {
			result.Severities = map[string]string{}
		}
		maps.Copy(result.Severities, child.Severities)
	}
	result.InvalidSeverities = maps.Clone(base.InvalidSeverities)
	if len(child.InvalidSeverities) != 0 {
		if result.InvalidSeverities == nil {
			result.InvalidSeverities = map[string]bool{}
		}
		maps.Copy(result.InvalidSeverities, child.InvalidSeverities)
		for code := range child.InvalidSeverities {
			delete(result.Severities, code)
		}
	}
	for code := range child.Severities {
		delete(result.InvalidSeverities, code)
	}
	if len(result.InvalidSeverities) == 0 {
		result.InvalidSeverities = nil
	}
	if result.EffectGlobals == TSUnknown {
		result.EffectGlobals = base.EffectGlobals
	}
	if result.EffectModules == TSUnknown {
		result.EffectModules = base.EffectModules
	}
	if result.SidecarDir == "" {
		result.SidecarDir = base.SidecarDir
	}
	return &result
}

// VibeLintPorts bridges the legacy VibeLang ports to the imported code registry
// until the ports are retired. Populated once at startup by the lint adapter.
var VibeLintPorts = map[string][]string{}
