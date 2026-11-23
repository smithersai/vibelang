package vibelang

import "github.com/microsoft/TypeScript/tsc/internal/core"

// Configuration is checked before source checking, but its printed diagnostic
// still belongs to the compiler's registry and documentation coverage.
var EK3009 = message(3009, warningCategory, core.VibeConfigDiagnostics[core.VibeLegacyConfigCode])

func init() {
	registerDiagnostic(EK3009)
}

var EK3012 = message(3012, warningCategory, core.VibeLintPluginMessage)

func init() { registerDiagnostic(EK3012) }
