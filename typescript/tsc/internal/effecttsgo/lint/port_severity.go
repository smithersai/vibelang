package lint

import (
	"fmt"
	"maps"
	"slices"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/effecttsgo/etscore"
	"github.com/microsoft/TypeScript/tsc/internal/effecttsgo/internal/pluginoptions"
	"github.com/microsoft/TypeScript/tsc/internal/effecttsgo/internal/rules"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// PortSeverity returns the severity, "error", "warning", "suggestion" or
// "off", that the project's Effect plugin entry gives in file the rules that
// port, a VibeLang diagnostic such as "EK4823", answers (vibeAnswers), and the
// lint code of the rule that set it, such as "EK38123". It returns "", "" when
// the plugin's diagnostics are off or the entry does not decide the port.
// Chapter 7: once enabled, severity resolves from vibe.severities, then the
// repository's Effect language-service configuration, then the rule's default.
func PortSeverity(options *core.CompilerOptions, port string, file tspath.RootedFilePath, caseSensitive bool) (string, string) {
	if options == nil || !etscore.DiagnosticsEnabled(options.Effect) {
		return "", ""
	}
	severities := pluginoptions.ResolveDiagnosticSeverityForFile(options.Effect, file, options.ConfigFilePath, caseSensitive)
	// A port of several rules (EK4804) cannot tell which of them a report
	// answers, so the entry decides it only when every one of its rules has
	// the same severity, counting a rule the entry leaves out at that rule's
	// default. Otherwise the port keeps its own default and code.
	named, agreed, severity := "", true, etscore.SeverityOff
	first := true
	for _, name := range slices.Sorted(maps.Keys(vibeAnswers)) {
		if vibeAnswers[name].ek != port {
			continue
		}
		s, ok := severities[name]
		if !ok {
			s = defaultSeverity(name)
		} else if named == "" {
			named = name
		}
		if !first && severityRank(s) != severityRank(severity) {
			agreed = false
		}
		first, severity = false, s
	}
	if named == "" || !agreed {
		return "", ""
	}
	code := fmt.Sprintf("EK%d", importedRuleCodes[named])
	if severity == etscore.SeverityMessage {
		return "suggestion", code
	}
	return severity.String(), code
}

// defaultSeverity is the severity rule has when the plugin entry names no
// severity for it.
func defaultSeverity(rule string) etscore.Severity {
	for _, r := range rules.All {
		if r.Name == rule {
			return r.DefaultSeverity
		}
	}
	return etscore.SeverityOff
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
