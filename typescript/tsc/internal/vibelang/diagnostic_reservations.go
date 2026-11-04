package vibelang

// Canonical primary messages for registry/editor lookup. The config loader and
// parser/checker own these reports; compatibility messages have separate IDs.
var (
	configKeyDiagnostic     = message(3007, errorCategory, "This vibe configuration key or value is invalid.")
	producerYieldDiagnostic = message(2104, errorCategory, "yield belongs in an effect producer, not in nonproducer effect code or formal parameter initialization.")
)

func init() {
	registry[configKeyDiagnostic.Code] = configKeyDiagnostic
	registry[producerYieldDiagnostic.Code] = producerYieldDiagnostic
}
