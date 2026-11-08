package core

// VIP-30 configuration diagnostics. These are config-file diagnostics, kept
// separate from the source checker registry (which still has legacy codes).
const (
	VibeInvalidSeverityCode         int32 = 3006
	VibeInvalidConfigCode           int32 = 3007
	VibeLegacyConfigCode            int32 = 3009
	VibeRetiredTrustedPackagesCode  int32 = 3010
	VibeRetiredDeclarationStyleCode int32 = 3011
)

var VibeConfigDiagnostics = map[int32]string{
	VibeInvalidSeverityCode:         "Invalid vibe.severities entry; use a warning or assigned EK38 lint code and error, warning, suggestion or off.",
	VibeInvalidConfigCode:           "Unknown vibe key or wrong value type; remove the key or supply its declared type.",
	VibeLegacyConfigCode:            "vibelang.diagnostics is deprecated; move it to vibe.severities. Only warning codes and assigned EK38 lint codes are configurable there.",
	VibeRetiredTrustedPackagesCode:  "trustedPackages is deprecated and ignored; remove this retired option. Use a signature contract or an explicit Effect.try boundary for foreign calls.",
	VibeRetiredDeclarationStyleCode: "declarationImportStyle is deprecated and ignored; remove this retired option. Declaration spelling follows the native TypeScript twin.",
}
