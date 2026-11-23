package vibelang

import "github.com/microsoft/TypeScript/tsc/internal/parser"

// Missing bodies and ambient services are parser diagnostics. Missing member
// separators use the shared field-body recovery and EK0908 fix in fieldcommas.go.
var (
	EK0906 = message(906, errorCategory, parser.VibeLangServiceBodyMessage)
	EK0907 = message(907, errorCategory, parser.VibeLangAmbientServiceMessage)
)

func init() {
	registerDiagnostic(EK0906)
	registerDiagnostic(EK0907)
}
