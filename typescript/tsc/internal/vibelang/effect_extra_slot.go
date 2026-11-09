package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

var EK0302 = message(302, errorCategory, parser.VibeLangExtraEffectSlotMessage)

func init() {
	registry[EK0302.Code] = EK0302
	tsFormRules[EK0302.Code] = &tsFormRule{
		message: EK0302,
	}
}
