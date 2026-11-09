package vibelang

import ()

// VIP-15, VIP-16 and decided detail 241 assign the parser-owned separator
// diagnostics of schema bodies (EK1504) and data declarations (EK1605).
var (
	EK1504 = message(1504, errorCategory, "These schema fields need a separator. Write `;` or a line break between them.")
	EK1605 = message(1605, errorCategory, "These data members need a separator. Write `;` or a line break between them.")
)

func init() {
	registry[EK1504.Code] = EK1504
	registry[EK1605.Code] = EK1605
}
