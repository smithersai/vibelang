package vibelang

import (
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

// A VibeLang port of an Effect rule is reported under the rule's assigned
// lint code when a project sets its severity that way (releaseSeverity):
// EK4823's check appears as EK38123 under "vibe": { "severities": {
// "EK38123": "error" } }. It is the same check, so the quick fixes for the
// port's own code fix it under either number.
func init() {
	for native, lints := range core.VibeLintPorts {
		code, err := strconv.Atoi(strings.TrimPrefix(native, "EK"))
		if err != nil {
			continue
		}
		for _, lint := range lints {
			alias, err := strconv.Atoi(strings.TrimPrefix(lint, "EK"))
			if err != nil {
				continue
			}
			ls.RegisterCodeFixAlias(diagnosticSource, int32(alias), int32(code))
		}
	}
}
