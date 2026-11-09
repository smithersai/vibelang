package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// VIP-5/detail 212: the parser reports this syntax error at the execution head.
var EK0510 = message(parser.VibeLangExecutionPowerCode, errorCategory, parser.VibeLangExecutionPowerMessage)

func init() {
	registry[EK0510.Code] = EK0510
}
