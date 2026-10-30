package vibelang

import "github.com/microsoft/TypeScript/tsc/internal/parser"

// EK0905 is the VIP-9 syntax error for a default-exported service declaration.
var EK0905 = message(905, errorCategory, parser.VibeLangDefaultServiceExportMessage)

func init() {
	registry[EK0905.Code] = EK0905
}
