package rule

import "github.com/microsoft/TypeScript/tsc/internal/effecttsgo/etscore"

type MetadataGroup struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

type MetadataPreset struct {
	Name               string                      `json:"name"`
	Description        string                      `json:"description"`
	DiagnosticSeverity map[string]etscore.Severity `json:"diagnosticSeverity"`
}
