package vibelang

import "github.com/microsoft/TypeScript/tsc/internal/parser"

// Missing bodies and ambient services are parser diagnostics. Missing member
// separators use the shared field-body recovery and EK0908 fix in fieldcommas.go.
var (
	EK0906 = message(906, errorCategory, parser.VibeLangServiceBodyMessage)
	EK0907 = message(907, errorCategory, parser.VibeLangAmbientServiceMessage)
)

func init() {
	registry[EK0906.Code] = EK0906
	registry[EK0907.Code] = EK0907
}
