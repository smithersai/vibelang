package vibelang

import (
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/core"
)

// Ordinary --fix applies the repairs of EK4823, EK4824 and EK4825 (styleFix)
// wherever the program reports them. Each is off until a project or a comment
// turns it on (D241), so --fix rewrites only the style a project asks for and
// its own lint would otherwise reject. A project that names the rule's lint
// code, such as EK38123 for EK4823, gets the reports under that code
// (releaseSeverity), so --fix takes those codes too.
func init() {
	for _, m := range []*Message{EK4823, EK4824, EK4825} {
		tsFormFixCodes = append(tsFormFixCodes, m.Code)
		for _, lint := range core.VibeLintPorts[m.String()] {
			if code, err := strconv.Atoi(strings.TrimPrefix(lint, "EK")); err == nil {
				tsFormFixCodes = append(tsFormFixCodes, int32(code))
			}
		}
	}
}
