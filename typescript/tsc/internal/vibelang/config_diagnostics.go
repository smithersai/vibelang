package vibelang

import "github.com/microsoft/TypeScript/tsc/internal/core"

// Configuration is checked before source checking, but its printed diagnostic
// still belongs to the compiler's registry and documentation coverage.
var EK3009 = message(3009, warningCategory, core.VibeConfigDiagnostics[core.VibeLegacyConfigCode])

func init() {
	registry[EK3009.Code] = EK3009
}
