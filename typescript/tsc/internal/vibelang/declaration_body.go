package vibelang

import "github.com/microsoft/TypeScript/tsc/internal/parser"

var EK1503 = message(parser.VibeLangSchemaMissingBodyCode, errorCategory, parser.VibeLangSchemaMissingBodyMessage)

func init() {
	registry[EK1503.Code] = EK1503
}
