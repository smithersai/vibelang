package vibelang

import "github.com/microsoft/TypeScript/tsc/internal/parser"

// EK0904 is the VIP-9 syntax error for an extends or implements clause on a
// service declaration (parser/vibelang_service_heritage.go).
var EK0904 = message(904, errorCategory, parser.VibeLangServiceHeritageMessage)

func init() {
	registry[EK0904.Code] = EK0904
}
