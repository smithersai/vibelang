package lint

import (
	"fmt"
	"maps"
	"slices"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/effecttsgo/etscore"
	"github.com/microsoft/TypeScript/tsc/internal/effecttsgo/internal/pluginoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// PortSeverity returns the severity, "error", "warning", "suggestion" or
// "off", that the project's Effect plugin entry gives in file the rules that
// port, a VibeLang diagnostic such as "EK4823", answers (vibeAnswers), and the
// lint code of the rule that set it, such as "EK38123". It returns "", "" when
// the plugin's diagnostics are off or none of those rules has an entry. A port
// of several rules takes the strongest, the first name in order on a tie.
// Chapter 7: once enabled, severity resolves from vibe.severities, then the
// repository's Effect language-service configuration, then the rule's default.
func PortSeverity(options *core.CompilerOptions, port string, file tspath.RootedFilePath, caseSensitive bool) (string, string) {
	if options == nil || !etscore.DiagnosticsEnabled(options.Effect) {
		return "", ""
	}
	severities := pluginoptions.ResolveDiagnosticSeverityForFile(options.Effect, file, options.ConfigFilePath, caseSensitive)
	found, strongest, rule := false, etscore.SeverityOff, ""
	for _, name := range slices.Sorted(maps.Keys(vibeAnswers)) {
		if vibeAnswers[name].ek != port {
			continue
		}
		if severity, ok := severities[name]; ok && (!found || severityRank(severity) > severityRank(strongest)) {
			found, strongest, rule = true, severity, name
		}
	}
	code := fmt.Sprintf("EK%d", importedRuleCodes[rule])
	switch {
	case !found:
		return "", ""
	case strongest == etscore.SeverityMessage:
		return "suggestion", code
	}
	return strongest.String(), code
}

func severityRank(s etscore.Severity) int {
	switch s {
	case etscore.SeverityError:
		return 3
	case etscore.SeverityWarning:
		return 2
	case etscore.SeveritySuggestion, etscore.SeverityMessage:
		return 1
	}
	return 0
}
