package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

var EK0512 = message(parser.VibeLangCatchPrecedenceCode, errorCategory, parser.VibeLangCatchPrecedenceMessage)

func init() {
	registerDiagnostic(EK0512)
}
