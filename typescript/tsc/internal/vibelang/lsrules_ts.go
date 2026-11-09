package vibelang

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// D266 supersedes D242: "This removes EK4801, EK4819, and EK4820 from
// ordinary TypeScript." No check looks for them in a .ts file: the shared
// diagnostic constructor would drop what it found, and the types it asked
// the checker for made the checker report TypeScript diagnostics in code
// that TypeScript never checks. The codes and editor fixes are retained.

var (
	// EK4819 (missingStarInYieldEffectGen): yield of an Effect in an Effect generator.
	EK4819 = message(4819, errorCategory, "yield hands this Effect to the generator's caller without running it; yield* runs it.")
	// EK4820 (missingReturnYieldStar): yield* of an Effect that never succeeds, without return.
	EK4820 = message(4820, errorCategory, "This Effect never succeeds, but TypeScript does not know the generator stops here.")
)

func init() {
	registry[EK4819.Code] = EK4819
	registry[EK4820.Code] = EK4820
}

// typeScriptFileChecks run once for each .ts or .tsx file outside
// node_modules that a checker checks, after TypeScript's own checks of that
// file.
var typeScriptFileChecks []func(c *checker.Checker, file *ast.SourceFile)

// isCheckedTypeScriptFile reports whether file is a .ts, .tsx, .mts, or .cts
// source file outside node_modules.
func isCheckedTypeScriptFile(file *ast.SourceFile) bool {
	if file == nil || file.IsDeclarationFile || file.IsVibeLang() || strings.Contains(string(file.FileName()), "/node_modules/") {
		return false
	}
	return tspath.FileExtensionIsOneOf(string(file.FileName()), []string{tspath.ExtensionTs, tspath.ExtensionTsx, tspath.ExtensionMts, tspath.ExtensionCts})
}
