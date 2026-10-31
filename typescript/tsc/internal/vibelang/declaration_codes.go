package vibelang

import "github.com/microsoft/TypeScript/tsc/internal/parser"

// Declaration errors the parser reports as EK syntax errors (chapter 006).
var (
	// EK1501: export default schema S.
	EK1501 = message(1501, errorCategory, parser.VibeLangDefaultSchemaExportMessage)
	// EK1502: type parameters on a schema declaration.
	EK1502 = message(1502, errorCategory, parser.VibeLangSchemaTypeParametersMessage)
	// EK1603: export default data D.
	EK1603 = message(1603, errorCategory, parser.VibeLangDefaultDataExportMessage)
)

func init() {
	for _, m := range []*Message{EK1501, EK1502, EK1603} {
		registry[m.Code] = m
	}
}
