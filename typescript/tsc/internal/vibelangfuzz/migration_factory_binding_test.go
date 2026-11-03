package vibelangfuzz

import (
	"maps"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const migrationFactoryBindingTarget = "FuzzMigrationFactoryBinding"
const migrationFactoryBindingQuote = "A rewrite that can't preserve types, behavior and declaration output refuses at that site."
const factoryBindingPrefix = "import { Effect } from \"effect\"\nlet constructions = 0\nexport const count = () => constructions\n"
const factoryBindingSimple = factoryBindingPrefix + "export function make(label = \"value\") { constructions++; return Effect.succeed(label) }\n"
const factoryBindingGuarded = factoryBindingPrefix + "export function make(label = \"first\") { constructions++; let closed = false; return Effect.sync(() => { if (closed) return \"closed\"; closed = true; return label }) }\n"
const factoryBindingURL = factoryBindingPrefix + "export function make(base: string) { constructions++; const url = new URL(\"/v1/shape\", base).toString(); return Effect.succeed(url) }\n"
const factoryBindingReadTwice = "\nconst before = Factory.count()\nconst first = yield* operation\nconst second = yield* operation\nreturn [before, Factory.count(), first, second]\n"

var migrationFactoryBindingPrograms = []struct{ key, factory, body string }{
	{"guarded-const", factoryBindingGuarded, "const operation = Factory.make()\n" + factoryBindingReadTwice},
	{"guarded-let", factoryBindingGuarded, "let operation = Factory.make()\n" + factoryBindingReadTwice},
	{"guarded-pipe", factoryBindingGuarded, "const operation = Factory.make().pipe(Effect.map((s) => s + \"!\"))\n" + factoryBindingReadTwice},
	{"simple-const", factoryBindingSimple, "const operation = Factory.make()\n" + factoryBindingReadTwice},
	{"simple-pipe", factoryBindingSimple, "const operation = Factory.make().pipe(Effect.map((s) => s + \"!\"))\n" + factoryBindingReadTwice},
	{"argument-update", factoryBindingSimple, "let argument = 0\nconst operation = Factory.make(String(++argument))\nconst before = argument\nconst first = yield* operation\nconst second = yield* operation\nreturn [before, argument, Factory.count(), first, second]\n"},
	{"getter-argument", factoryBindingSimple, "let reads = 0\nconst input = { get label() { reads++; return String(reads) } }\nconst operation = Factory.make(input.label)\nconst before = reads\nconst first = yield* operation\nconst second = yield* operation\nreturn [before, reads, Factory.count(), first, second]\n"},
	{"bad-url", factoryBindingURL, "const operation = Factory.make(\"electric:3000\")\nvoid operation\nreturn Factory.count()\n"},
	{"good-url", factoryBindingURL, "const operation = Factory.make(\"http://electric.example\")\nvoid operation\nreturn Factory.count()\n"},
	{"already-lazy", factoryBindingSimple, "const operation = Effect.suspend(() => Factory.make())\n" + factoryBindingReadTwice},
	{"alias-reuse", factoryBindingGuarded, "const operation = Factory.make()\nconst alias = operation\nconst before = Factory.count()\nconst first = yield* alias\nconst second = yield* alias\nreturn [before, Factory.count(), first, second]\n"},
	{"two-bindings", factoryBindingSimple, "const first = Factory.make(\"a\")\nconst second = Factory.make(\"b\")\nconst before = Factory.count()\nconst a = yield* first\nconst b = yield* second\nreturn [before, Factory.count(), a, b]\n"},
}

func TestMigrationFactoryBindingQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), migrationFactoryBindingQuote) {
		t.Fatalf("Chapter 7 no longer contains %q", migrationFactoryBindingQuote)
	}
}

func FuzzMigrationFactoryBinding(f *testing.F) {
	startShortBudget(f)
	for _, p := range migrationFactoryBindingPrograms {
		f.Add(p.key)
	}
	w := NewWorkspace(f)
	node, err := NewNode(w.Dir)
	if err != nil {
		f.Fatal(err)
	}
	f.Fuzz(func(t *testing.T, key string) {
		TestMigrationFactoryBindingQuoted(t)
		i := slices.IndexFunc(migrationFactoryBindingPrograms, func(p struct{ key, factory, body string }) bool { return p.key == key })
		if i < 0 {
			if key == "" {
				return
			}
			i = int(key[0]) % len(migrationFactoryBindingPrograms)
		}
		p := migrationFactoryBindingPrograms[i]
		source := "import { Effect } from \"effect\"\nimport * as Factory from \"./factory.js\"\nexport const main = () => Effect.gen(function* () {\n" + p.body + "\n})\n"
		toolsGuard(t, migrationFactoryBindingTarget, func() {
			stock := toolsCompile(t, w, migrationFactoryBindingTarget, map[string]string{"main.ts": source, "factory.ts": p.factory})
			defer stock.Remove()
			if !toolsErrorFree(stock) {
				t.Fatalf("invalid TypeScript control: %v\n%s", SortedKeys(Keys(stock.Dir, stock.Diagnostics)), source)
			}
			files := map[string]string{"main.vibe": source, "factory.ts": p.factory}
			before := toolsCompile(t, w, migrationFactoryBindingTarget, files)
			defer before.Remove()
			config := toolsConfig(w, before.Dir)
			if config == nil || len(config.Errors) > 0 {
				t.Fatal("invalid migration configuration")
			}
			var result *vibelang.FixResult
			toolsRun(t, migrationFactoryBindingTarget, "fix", source, nil, func() {
				result = vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), config, vibelang.FixOptions{})
			})
			oracleKey := "construction:" + p.key
			if result.Err != nil {
				Gap(t, migrationFactoryBindingTarget, oracleKey, "Chapter 7: %q; fix failed: %v", migrationFactoryBindingQuote, result.Err)
			}
			fixed := maps.Clone(files)
			for name, file := range result.Files {
				fixed[strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")] = file.Text
			}
			after := toolsCompile(t, w, migrationFactoryBindingTarget, fixed)
			defer after.Remove()
			if !toolsErrorFree(after) {
				Gap(t, migrationFactoryBindingTarget, oracleKey, "factory migration leaves errors: %v\n%s", SortedKeys(Keys(after.Dir, after.Diagnostics)), fixed["main.vibe"])
			} else {
				was, is := node.Run(stock, "out/main.js", "main"), node.Run(after, "out/main.js", "main")
				if toolsInvalidOutcome(was) {
					t.Fatalf("invalid TypeScript outcome: %+v\n%s", was, source)
				}
				if was.Kind != is.Kind || string(was.Value) != string(is.Value) {
					Gap(t, migrationFactoryBindingTarget, oracleKey, "factory construction/run phase differs: .ts %s %s; migrated %s %s\n%s", was.Kind, was.Value, is.Kind, is.Value, fixed["main.vibe"])
				}
			}
			ExpectPending(t, migrationFactoryBindingTarget, oracleKey)
			ExpectPending(t, migrationFactoryBindingTarget, specCorpusKey(t))
		})
	})
}
