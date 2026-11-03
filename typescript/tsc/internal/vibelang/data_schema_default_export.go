package vibelang

import "github.com/microsoft/TypeScript/tsc/internal/parser"

// VIP-15 and VIP-16 require named declarations before a default export.
var EK1501 = message(1501, errorCategory, parser.VibeLangDefaultSchemaExportMessage)
var EK1603 = message(1603, errorCategory, parser.VibeLangDefaultDataExportMessage)

func init() {
	registry[EK1501.Code] = EK1501
	registry[EK1603.Code] = EK1603
}
