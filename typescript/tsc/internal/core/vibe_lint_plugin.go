package core

const VibeLintPluginCode int32 = 3012
const VibeLintPluginMessage = "an imported lint severity needs an explicit Effect plugin entry; run vibelang --fix"

func init() { VibeConfigDiagnostics[VibeLintPluginCode] = VibeLintPluginMessage }

// VIP-38's preserving transition applies only to an absent plugin. A resolved
// plugin remains explicit even when diagnostics:false or diagnosticSeverity:null
// makes its parsed Effect options nil.
func VibeNeedsLintPlugin(options *CompilerOptions) bool {
	if options == nil || options.VibeLang == nil {
		return false
	}
	for _, plugin := range options.Plugins {
		if plugin.Name == "@effect/language-service" {
			return false
		}
	}
	for code := range options.VibeLang.Severities {
		if _, assigned := VibeImportedLintCodes[code]; assigned {
			return true
		}
	}
	return false
}
