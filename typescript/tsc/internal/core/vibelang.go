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
	Severities    map[string]string `json:"severities,omitzero"`
	EffectGlobals Tristate          `json:"effectGlobals,omitzero"`
	EffectModules Tristate          `json:"effectModules,omitzero"`

	// TrustedPackages are package-name globs granted D22 trust (D261).
	TrustedPackages []string `json:"trustedPackages,omitzero"`
	// Diagnostics maps an EK code in VibeLangAdjustableCodes, such as "EK9204",
	// to "error", "warning", or "off".
	Diagnostics map[string]string `json:"diagnostics,omitzero"`
	// Tracing is "none", "exported", or "all": which functions compile with
	// Effect.fn spans. Empty means "none".
	Tracing string `json:"tracing,omitzero"`
	// DeclarationSidecars writes each .vibe module's declarations beside it,
	// x.d.vibe.ts for x.vibe, which stock TypeScript and the tools built on it
	// resolve for an import of ./x.vibe under allowArbitraryExtensions.
	DeclarationSidecars bool `json:"declarationSidecars,omitzero"`
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
	"EK4830", "EK4831", "EK4832", "EK4833", "EK4834", "EK4835", "EK4836", "EK4837", "EK4839", "EK4840", "EK4841", "EK4842", "EK4843", "EK4853", "EK4854", "EK4855",
}

// Equals reports whether o and other hold the same settings.
func (o *VibeLangOptions) Equals(other *VibeLangOptions) bool {
	if o == nil || other == nil {
		return o == other
	}
	return o.VibeOnly == other.VibeOnly && maps.Equal(o.Severities, other.Severities) && maps.Equal(o.InvalidSeverities, other.InvalidSeverities) && o.EffectGlobals == other.EffectGlobals && o.EffectModules == other.EffectModules && o.Tracing == other.Tracing && o.DeclarationSidecars == other.DeclarationSidecars && slices.Equal(o.TrustedPackages, other.TrustedPackages) && maps.Equal(o.Diagnostics, other.Diagnostics)
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
		result.Tracing = base.Tracing
		result.TrustedPackages = base.TrustedPackages
		result.DeclarationSidecars = base.DeclarationSidecars
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
	return &result
}

// VibeLintPorts bridges the legacy VibeLang ports to the imported code registry
// until the ports are retired. Populated once at startup by the lint adapter.
var VibeLintPorts = map[string][]string{}
