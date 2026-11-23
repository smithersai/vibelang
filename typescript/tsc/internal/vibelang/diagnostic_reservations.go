package vibelang

// Canonical primary messages for registry/editor lookup. The config loader and
// parser/checker own these reports; compatibility messages have separate IDs.
var configKeyDiagnostic = message(3007, errorCategory, "This vibe configuration key or value is invalid.")

func init() {
	registerDiagnostic(configKeyDiagnostic)
}
