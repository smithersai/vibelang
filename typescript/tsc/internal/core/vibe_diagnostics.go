package core

// VIP-30 configuration diagnostics. These are config-file diagnostics, kept
// separate from the source checker registry (which still has legacy codes).
const (
	VibeInvalidSeverityCode int32 = 3006
	VibeInvalidConfigCode   int32 = 3007
	VibeLegacyConfigCode    int32 = 3009
)

var VibeConfigDiagnostics = map[int32]string{
	VibeInvalidSeverityCode: "Invalid vibe.severities entry; use a warning or assigned EK38 lint code and error, warning, suggestion or off.",
	VibeInvalidConfigCode:   "Unknown vibe key or wrong value type; remove the key or supply its declared type.",
	VibeLegacyConfigCode:    "vibelang.diagnostics is deprecated; run vibelang --fix to move it to vibe.severities. Only warning codes and assigned EK38 lint codes are configurable there.",
}
