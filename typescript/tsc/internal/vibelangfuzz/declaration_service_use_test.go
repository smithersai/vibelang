package vibelangfuzz

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"
)

func TestDeclarationServiceUseQuoted(t *testing.T) {
	TestMigrationDeclarationFixQuoted(t)
	chapterSays(t, "000-intro.md", "TypeScript's meaning outside Effect code.")
	chapterSays(t, "001-functions.md", "Declarations are exactly what idiomatic Effect TypeScript would declare.")
}

// serviceUseKeys are the shapes around Alchemy's HetznerEnvironment.current:
// a service whose value is itself an Effect, read through the class's own
// static use. Stock TypeScript declares use's result Effect<A, E, R | Self>;
// the renamed .vibe must declare the same type, never Effect<Effect<A>>.
var serviceUseKeys = []string{"identity", "error-channel", "mapped", "record", "generator", "module-const", "readonly-static"}

// serviceUseSource builds one ordinary TypeScript module. Mode bits vary
// the import form, line endings, a JSDoc comment on the member and a
// non-ASCII class name; none of them changes stock's declared type.
func serviceUseSource(key string, mode uint8) string {
	shape, body := "Effect.Effect<number>", "value => value"
	switch key {
	case "error-channel":
		shape = "Effect.Effect<number, Error>"
	case "mapped":
		body = "value => value.pipe(Effect.map(n => n + 1))"
	case "record":
		shape, body = "{ readonly n: number }", "value => Effect.succeed(value.n)"
	case "generator":
		body = "value => Effect.gen(function* () { return yield* value })"
	}
	name := "Service"
	if mode&8 != 0 {
		name = "Serviceδ"
	}
	imports := "import * as Effect from \"effect/Effect\";\nimport * as Context from \"effect/Context\";\n"
	if mode&1 != 0 {
		imports = "import { Context, Effect } from \"effect\";\n"
	}
	doc := ""
	if mode&4 != 0 {
		doc = "  /** The current value. */\n"
	}
	member := doc + "  static current = " + name + ".use(" + body + ");\n"
	if key == "readonly-static" {
		member = doc + "  static readonly current = " + name + ".use(" + body + ");\n"
	}
	tail := ""
	if key == "module-const" {
		member = "  static readonly label = \"service\";\n"
		tail = strings.ReplaceAll(doc, "  ", "") + "export const current = " + name + ".use(" + body + ");\n"
	}
	source := imports + "export class " + name + " extends Context.Service<" + name + ", " + shape + ">()(\"Service\") {\n" + member + "}\n" + tail
	if mode&2 != 0 {
		source = strings.ReplaceAll(source, "\n", "\r\n")
	}
	return source
}

// serviceUseProgram is the stock project the declaration-identity gate renames.
func serviceUseProgram(key string, mode uint8) string {
	return Archive(map[string]string{
		"main.ts":       serviceUseSource(key, mode),
		"package.json":  "{\"type\":\"module\"}\n",
		"tsconfig.json": "{\"compilerOptions\":{\"target\":\"ES2022\",\"module\":\"NodeNext\",\"moduleResolution\":\"NodeNext\",\"strict\":true,\"skipLibCheck\":true,\"declaration\":true,\"outDir\":\"out\",\"singleThreaded\":true},\"files\":[\"main.ts\"]}\n",
	})
}

// FuzzDeclarationServiceUse widens the Alchemy Hetzner witness (also kept as
// testdata/fuzz/FuzzDeclarationIdentity/alchemy-service-use-effect-value) into
// its neighbourhood. Each program passes two gates: the renamed .vibe declares
// what stock declares, and --fix on that .vibe keeps its declarations. The
// reported defect was the second: a fix that wrapped the initializer as
// effect { return try Service.use(...) } and nested the Effect.
func FuzzDeclarationServiceUse(f *testing.F) {
	startShortBudget(f)
	tsc, api := StockTypeScript(f), declarationIdentityAPI(f)
	w := NewWorkspace(f)
	f.Add("identity", uint8(0))
	f.Add("record", uint8(13))
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestDeclarationServiceUseQuoted(t)
		if !slices.Contains(serviceUseKeys, key) {
			if key == "" {
				key = serviceUseKeys[0]
			} else {
				key = serviceUseKeys[int(key[0])%len(serviceUseKeys)]
			}
		}
		t.Run("rename", func(t *testing.T) { checkServiceUseIdentity(t, w, tsc, api, serviceUseProgram(key, mode&15)) })
		t.Run("fix", func(t *testing.T) { checkServiceUseFix(t, w, api, serviceUseSource(key, mode&15)) })
	})
}

// The original minimum must pass the gate, not be admitted away by a skip.
func TestDeclarationServiceUseWitness(t *testing.T) {
	TestDeclarationServiceUseQuoted(t)
	data, err := os.ReadFile(filepath.Join(Root(), "typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzDeclarationIdentity/alchemy-service-use-effect-value"))
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	if len(lines) != 2 || lines[0] != "go test fuzz v1" || !strings.HasPrefix(lines[1], "string(") {
		t.Fatal("expected one keyed declaration-identity archive")
	}
	archive, err := strconv.Unquote(strings.TrimSuffix(strings.TrimPrefix(lines[1], "string("), ")"))
	if err != nil {
		t.Fatal(err)
	}
	if archive != serviceUseProgram("identity", 0) {
		t.Fatal("the keyed Alchemy witness and the generator's identity program differ")
	}
	w, api := NewWorkspace(t), declarationIdentityAPI(t)
	t.Run("rename", func(t *testing.T) { checkServiceUseIdentity(t, w, StockTypeScript(t), api, archive) })
	t.Run("fix", func(t *testing.T) { checkServiceUseFix(t, w, api, serviceUseSource("identity", 0)) })
}

// checkServiceUseFix applies the shared Chapter 7 fix-preservation gate. Every
// generated module is well typed, so an admission skip would hide the check.
func checkServiceUseFix(t *testing.T, w *Workspace, api, source string) {
	t.Helper()
	t.Cleanup(func() {
		if t.Skipped() {
			t.Error("a Service.use module must reach the --fix declaration comparison")
		}
	})
	checkMigrationDeclarationFix(t, w, api, Archive(map[string]string{"main.vibe": source}))
}

func checkServiceUseIdentity(t *testing.T, w *Workspace, tsc, api, archive string) {
	t.Helper()
	report := filepath.Join(t.TempDir(), "declaration-diff.jsonl")
	t.Setenv("VIBELANG_FUZZ_DECLARATION_REPORT", report)
	t.Cleanup(func() {
		if !t.Skipped() {
			return
		}
		data, err := os.ReadFile(report)
		var record struct{ Diff string }
		if err == nil && json.Unmarshal(data, &record) == nil && record.Diff != "" {
			t.Errorf("Stock (-) and renamed .vibe (+) canonical declarations differ:\n%s", record.Diff)
		} else {
			t.Error("a Service.use declaration program must run without an admission skip")
		}
	})
	CheckDeclarationIdentity(t, w, tsc, api, archive)
}
