package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangfmt"
)

const formatBodySpecifierQuote = "the import is not TypeScript and breaks the copy rule"

func formatBodySpecifiersQuoted(t testing.TB) {
	chapterSays(t, "../vips/0040-module-declarations.md", formatBodySpecifierQuote)
	chapterSays(t, "007-tooling.md", "An unparsable file is reported and left unchanged; formatting is idempotent.")
}

func TestFormatModuleBodySpecifiersQuoted(t *testing.T) { formatBodySpecifiersQuoted(t) }

var formatBodySpecifierKeys = []string{"side-effect", "namespace", "named", "type", "export-all", "export-named"}

func formatBodySpecifierSource(key string, mode byte) (string, bool) {
	specifier := "first"
	if mode&1 != 0 {
		specifier = "'./first.js'"
	}
	statement := "import " + specifier
	switch key {
	case "namespace":
		statement = "import * as ns from " + specifier
	case "named":
		statement = "import { n } from " + specifier
	case "type":
		statement = "import type { N } from " + specifier
	case "export-all":
		statement = "export * from " + specifier
	case "export-named":
		statement = "export { n } from " + specifier
	}
	invalid := key == "side-effect" && mode&1 == 0 && mode&2 == 0
	if mode&2 == 0 {
		statement = "module second {\n" + statement + "\n}"
	}
	source := "module first { export const n=1; export type N=number }\n" + statement + "\n"
	if mode&4 != 0 {
		source = "// imports remain in place\n" + strings.ReplaceAll(source, "\n", "\r\n")
	}
	return source, invalid
}

func checkFormatBodySpecifier(t *testing.T, key string, mode byte, fuzz bool) {
	t.Helper()
	fail := func(stage, message string, args ...any) {
		if fuzz {
			Gap(t, "FuzzFormatModuleBodySpecifiers", stage+":"+key, message, args...)
			return
		}
		t.Fatalf(message, args...)
	}
	source, invalid := formatBodySpecifierSource(key, mode)
	syntax := formatSyntaxError(source)
	if (syntax != "") != invalid {
		fail("classification", "specifier=%s mode=%d syntax=%q invalid=%v source=%s", key, mode, syntax, invalid, source)
		return
	}
	calls := 0
	host := func(text string) (string, error) { calls++; return text, nil }
	once, err := vibelangfmt.Format("main.vibe", source, host)
	if invalid {
		if err == nil || calls != 0 || once != "" {
			fail("refusal", "invalid body reached formatter: calls=%d output=%q error=%v", calls, once, err)
		}
		return
	}
	if err != nil || calls == 0 {
		fail("valid", "valid control refused: calls=%d error=%v", calls, err)
		return
	}
	twice, err := vibelangfmt.Format("main.vibe", once, host)
	if err != nil || twice != once {
		fail("idempotence", "valid control is not idempotent: %v", err)
		return
	}
	if err := vibelangfmt.SameProgram(source, once); err != nil {
		fail("program", "%v", err)
	}
}

func TestFormatModuleBodySpecifiers(t *testing.T) {
	formatBodySpecifiersQuoted(t)
	for _, key := range formatBodySpecifierKeys {
		for mode := byte(0); mode < 8; mode++ {
			t.Run(fmt.Sprintf("%s/%d", key, mode), func(t *testing.T) { checkFormatBodySpecifier(t, key, mode, false) })
		}
	}
}

func FuzzFormatModuleBodySpecifiers(f *testing.F) {
	startShortBudget(f)
	formatBodySpecifiersQuoted(f)
	for _, key := range formatBodySpecifierKeys {
		for _, mode := range []byte{0, 1, 2, 4} {
			f.Add([]byte(key + "\x00" + string([]byte{mode})))
		}
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		parts := strings.SplitN(string(data), "\x00", 2)
		key := parts[0]
		found := false
		for _, known := range formatBodySpecifierKeys {
			if key == known {
				found = true
				break
			}
		}
		if !found {
			key = formatBodySpecifierKeys[len(data)%len(formatBodySpecifierKeys)]
		}
		var mode byte
		if len(parts) > 1 && len(parts[1]) > 0 {
			mode = parts[1][0] & 7
		}
		checkFormatBodySpecifier(t, key, mode, true)
		ExpectPending(t, "FuzzFormatModuleBodySpecifiers", key)
		ExpectPending(t, "FuzzFormatModuleBodySpecifiers", specCorpusKey(t))
	})
}

// VIP-40's body is a TypeScript file. A bare side-effect identifier import
// is recovered for EK4007, but TypeScript requires an import-equals clause.
// Only that parse-recovery form is classified here; from-clauses retain the
// formatter's usual diagnostic-preservation checks.
func formatModuleBodySpecifierError(file *ast.SourceFile) string {
	for _, body := range file.EmbeddedModules() {
		var specifier *ast.Node
		var visit ast.Visitor
		visit = func(node *ast.Node) bool {
			if node.Kind == ast.KindImportDeclaration {
				decl := node.AsImportDeclaration()
				if decl.ImportClause == nil && decl.ModuleSpecifier != nil && decl.ModuleSpecifier.Kind == ast.KindIdentifier {
					specifier = decl.ModuleSpecifier
					return true
				}
			}
			return node.ForEachChild(visit)
		}
		if body.AsNode().ForEachChild(visit) && specifier != nil {
			return fmt.Sprintf("%d: EK4007, bare side-effect identifier import in a TypeScript body", specifier.Pos())
		}
	}
	return ""
}
