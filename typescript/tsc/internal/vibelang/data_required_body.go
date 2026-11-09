package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// VIP-16 and Appendix A recognize data [no LineTerminator here] BindingIdentifier.
var EK1604 = message(parser.VibeLangDataMissingBodyCode, errorCategory, parser.VibeLangDataMissingBodyMessage)

func init() {
	registry[EK1604.Code] = EK1604
}
