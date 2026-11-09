package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// Keep the legacy parse tree for migration: parentheses make its existing
// channel grouping explicit without changing the declaration or runtime value.
// VIP-3 requires EK0301 before bare compound channels can be accepted.
var EK0301 = message(301, errorCategory, parser.VibeLangEffectChannelMessage)

func init() {
	registry[EK0301.Code] = EK0301
	tsFormRules[EK0301.Code] = &tsFormRule{
		message: EK0301,
	}
}
