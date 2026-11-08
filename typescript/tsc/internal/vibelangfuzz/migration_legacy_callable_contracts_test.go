package vibelangfuzz

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

var legacyCallablePatterns = []struct{ key, corpus string }{
	{"promise-client", "alchemy-legacy-promise-client.ts"},
	{"foreign-generator", "alchemy-legacy-foreign-builder.ts"},
	{"parameter-docs", "alchemy-legacy-parameter-docs.ts"},
}

const legacyCallableIdentityQuote = "No other JSDoc difference is allowed, and an authored `@throws` must remain unchanged."

func TestMigrationLegacyCallableContractsQuoted(t *testing.T) {
	TestMigrationDeclarationFixQuoted(t)
	if !strings.Contains(SpecText("001-functions.md"), legacyCallableIdentityQuote) {
		t.Fatalf("Chapter 1 no longer says %q", legacyCallableIdentityQuote)
	}
}

func legacyCallableSource(tb testing.TB, key string, mode int) string {
	tb.Helper()
	corpus := ""
	for _, pattern := range legacyCallablePatterns {
		if pattern.key == key {
			corpus = pattern.corpus
		}
	}
	if corpus == "" {
		tb.Fatalf("unknown callable pattern %q", key)
	}
	data, err := os.ReadFile(filepath.Join("testdata", "corpus", corpus))
	if err != nil {
		tb.Fatal(err)
	}
	source := string(data)
	if mode&1 != 0 {
		source = strings.ReplaceAll(source, "import * as Effect from \"effect/Effect\";", "import { Effect } from \"effect\";")
	}
	if mode&4 != 0 {
		switch key {
		case "promise-client":
			source = strings.ReplaceAll(source, ".pipe(Effect.runPromise)", ".pipe(Effect.map((value) => value), Effect.runPromise)")
		case "foreign-generator":
			source = strings.ReplaceAll(source, "yield* Effect.succeed(1);", "const one = yield* Effect.succeed(1);\n    void one;")
		case "parameter-docs":
			source = strings.ReplaceAll(source, "branch:", "readonly branch:")
			source = strings.ReplaceAll(source, "project:", "readonly project:")
		}
	}
	if mode&8 != 0 {
		source = strings.ReplaceAll(source, "export const ", "/** Public callable. */\nexport const ")
	}
	if mode&2 != 0 {
		source = strings.ReplaceAll(source, "\n", "\r\n")
	}
	return source
}

func TestMigrationLegacyCallableContractOracleControls(t *testing.T) {
	original := "export interface Shape {\n/** branch doc */\nbranch: { id: string };\n}\nexport declare const read: (scope: Shape) => Shape;\n"
	for _, changed := range []string{
		strings.ReplaceAll(original, "branch doc", "changed doc"),
		strings.ReplaceAll(original, "id: string", "id: number"),
		strings.ReplaceAll(original, "=> Shape", "=> Promise<Shape>"),
	} {
		if diff := compareDeclarationOutputs(t, map[string]string{"main.d.ts": original}, map[string]string{"main.d.ts": changed}); diff == "" {
			t.Fatalf("API oracle accepted a changed callable contract: %s", changed)
		}
	}
}
