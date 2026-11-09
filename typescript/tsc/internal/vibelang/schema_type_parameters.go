package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

var EK1502 = message(1502, errorCategory, parser.VibeLangSchemaTypeParametersMessage)

func init() {
	registry[EK1502.Code] = EK1502
}
