package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

var EK0512 = message(parser.VibeLangCatchPrecedenceCode, errorCategory, parser.VibeLangCatchPrecedenceMessage)

func init() {
	registry[EK0512.Code] = EK0512
}
