package vibelangfuzz

import (
	"os"
	"path/filepath"
	"strconv"
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

func checkLegacyCallableContract(t *testing.T, w *Workspace, api, source string) {
	t.Helper()
	var child *testing.T
	t.Run("preservation", func(t *testing.T) {
		child = t
		checkMigrationDeclarationFix(t, w, api, Archive(map[string]string{"main.vibe": source}))
	})
	if child.Skipped() {
		t.Fatal("valid legacy callable was not admitted")
	}
}

func TestMigrationLegacyCallableContractsCorpus(t *testing.T) {
	TestMigrationLegacyCallableContractsQuoted(t)
	w := NewWorkspace(t)
	api := declarationIdentityAPI(t)
	stock := StockTypeScript(t)
	for _, pattern := range legacyCallablePatterns {
		t.Run(pattern.key, func(t *testing.T) {
			source := legacyCallableSource(t, pattern.key, 0)
			var twin *testing.T
			t.Run("stock-twin", func(t *testing.T) {
				twin = t
				CheckDeclarationIdentity(t, w, stock, api, Archive(map[string]string{"main.ts": source}))
			})
			if twin.Skipped() {
				t.Fatal("original callable stock twin was not admitted")
			}
			checkLegacyCallableContract(t, w, api, source)
		})
	}
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

func FuzzMigrationLegacyCallableContracts(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{
		"contract:promise-client:5",
		"contract:foreign-generator:10",
		"contract:parameter-docs:15",
	} {
		f.Add([]byte(key))
	}
	w := NewWorkspace(f)
	api := declarationIdentityAPI(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		TestMigrationLegacyCallableContractsQuoted(t)
		parts := strings.Split(string(data), ":")
		key, mode := legacyCallablePatterns[0].key, 0
		if len(parts) == 3 && parts[0] == "contract" {
			for _, pattern := range legacyCallablePatterns {
				if parts[1] == pattern.key {
					key = pattern.key
				}
			}
			value, err := strconv.ParseUint(parts[2], 10, 8)
			if err == nil {
				mode = int(value) % 16
			}
		} else if len(data) > 0 {
			key = legacyCallablePatterns[int(data[0])%len(legacyCallablePatterns)].key
			if len(data) > 1 {
				mode = int(data[1]) % 16
			}
		}
		checkLegacyCallableContract(t, w, api, legacyCallableSource(t, key, mode))
	})
}
