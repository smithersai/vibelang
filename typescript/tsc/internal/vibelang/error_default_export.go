package vibelang

import "github.com/microsoft/TypeScript/tsc/internal/parser"

// EK1305 is the syntax error for a default-exported error declaration.
var EK1305 = message(1305, errorCategory, parser.VibeLangDefaultErrorExportMessage)

func init() {
	registry[EK1305.Code] = EK1305
}
