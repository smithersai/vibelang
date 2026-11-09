package vibelangfuzz

const legacyEffectAliasQuote = "Diagnostics retain their existing codes, categories and eligibility; compiling a file does not apply a source rewrite."

func legacyMigrationDeclarationBytes(result *Result) map[string]string {
	declarations := make(map[string]string)
	for name, text := range result.Outputs {
		if isDeclaration(name) {
			declarations[name] = text
		}
	}
	return declarations
}
