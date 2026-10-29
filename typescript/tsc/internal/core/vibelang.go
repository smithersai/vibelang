package core

import (
	"maps"
	"slices"
)

// VibeLangOptions is compilerOptions.vibelang in tsconfig.json, the
// project's VibeLang settings (design decision D34).
type VibeLangOptions struct {
	// TrustedPackages are package-name globs granted D22 trust (D261).
	TrustedPackages []string `json:"trustedPackages,omitzero"`
	// Diagnostics maps an EK code in VibeLangAdjustableCodes, such as "EK2004",
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
// and @vibelang-diagnostics comments may change (D34, D241): EK1012, EK2004, EK4403, EK4406, EK4409, EK9100,
// the rules taken from Effect's language service, EK4801-EK4825, except
// EK4813, which stands in for a TypeScript error, and the TypeScript-style
// forms, EK4830-EK4837. EK4838, an owned fiber that leaves its region, is an
// error no setting lowers (D386).
var VibeLangAdjustableCodes = []string{
	"EK1012", "EK2004", "EK3205", "EK4403", "EK4406", "EK4409", "EK9100",
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
	return o.Tracing == other.Tracing && o.DeclarationSidecars == other.DeclarationSidecars && slices.Equal(o.TrustedPackages, other.TrustedPackages) && maps.Equal(o.Diagnostics, other.Diagnostics)
}
