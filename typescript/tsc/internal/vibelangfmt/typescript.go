package vibelangfmt

import (
	"fmt"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// A module body's first pass formats ordinary TypeScript before the file is
// encoded. Restore written return grouping there as well as in the outer pass,
// before that intermediate output becomes the next encoding's source.
func preserveTypeScript(before, after string) (string, error) {
	original := parser.ParseSourceFile(typeScriptOptions, before, core.ScriptKindTS)
	formatted := parser.ParseSourceFile(typeScriptOptions, after, core.ScriptKindTS)
	if diagnostics := formatted.Diagnostics(); len(diagnostics) != 0 {
		return "", fmt.Errorf("vibelang format: the formatted TypeScript does not parse: %s", diagnostics[0].String())
	}
	enc := &encoding{text: before}
	enc.recordReturnTypes(original)
	d := decoder{enc: enc, text: after, file: formatted}
	if err := d.restoreReturnTypes(); err != nil {
		return "", err
	}
	return d.apply()
}
