package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
)

const computedProjectionTarget = "FuzzComputedKeyExpressionProjection"

// Check rendered ordinary TypeScript independently of the source parser's
// expression metadata. Closed object and unique-symbol domains reject a lost
// key type even when the source compiler can still check the original pattern.
func FuzzComputedKeyExpressionProjection(f *testing.F) {
	startShortBudget(f)
	computedExpressionQuotes(f)
	for _, rule := range computedExpressionRules {
		for context := uint8(0); context < 8; context++ {
			f.Add(rule.key, context)
		}
	}
	preludePath := filepath.Join(filepath.Dir(SpecPath("004-match.md")), "..", "..", "..", "packages", "ts-mapper", "prelude.d.ts")
	prelude, err := os.ReadFile(preludePath)
	if err != nil {
		f.Fatal(err)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, context uint8) {
		index := slices.IndexFunc(computedExpressionRules, func(rule struct{ key, prefix, domain, expression, parameters string }) bool { return rule.key == key })
		if index < 0 {
			index = int(context) % len(computedExpressionRules)
			key = computedExpressionRules[index].key
		}
		source := computedExpressionSource(index, context)
		projected := vibelangmapper.Project(source, vibelangmapper.FileContext{})
		if len(projected.Diagnostics) != 0 {
			for _, d := range projected.Diagnostics {
				diagnosticKey := fmt.Sprintf("projection:%s:%d:EK%04d", key, context%8, d.Code)
				if _, known := Pending(computedProjectionTarget, diagnosticKey); !known {
					Gap(t, computedProjectionTarget, diagnosticKey, "rejected key expression: %v\n%s", d, source)
					return
				}
			}
			d := projected.Diagnostics[0]
			Gap(t, computedProjectionTarget, fmt.Sprintf("projection:%s:%d:EK%04d", key, context%8, d.Code), "rejected key expression: %v\n%s", d, source)
			return
		}
		result, err := w.CompileOrdered(t.Context(), Project{
			Files: map[string]string{
				"main.ts":      strings.ReplaceAll(projected.Text, "vibelang-ts-mapper/prelude", "./prelude.js"),
				"prelude.d.ts": string(prelude),
				"package.json": `{"type":"module"}`,
			},
			Config: `{"compilerOptions":{"strict":true,"skipLibCheck":true,"target":"esnext","module":"nodenext","moduleResolution":"nodenext","noEmit":true,"types":[]},"files":["main.ts"]}`,
		}, OrderTsc, true)
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		for _, d := range result.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				Gap(t, computedProjectionTarget, fmt.Sprintf("type:%s:%d", key, context%8), "%s: %s\n%s", computedExpressionGrammar, specDiagnosticText(d), projected.Text)
				return
			}
		}
	})
}
