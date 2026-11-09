package vibelangfuzz

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDeclarationServiceUseQuoted(t *testing.T) {
	chapterSays(t, "001-functions.md", "Declarations are exactly what idiomatic Effect TypeScript would declare.")
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
