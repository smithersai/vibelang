package vibelangfuzz

import "github.com/microsoft/TypeScript/tsc/internal/diagnostics"

// legacyErrors retains ordinary error classification for the independent compiler probes.
func legacyErrors(r *Result) []string {
	var errors []string
	for _, d := range withoutEffectLint(r.Diagnostics) {
		if d.Category() == diagnostics.CategoryError {
			errors = append(errors, specDiagnosticText(d))
		}
	}
	return errors
}
