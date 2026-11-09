package vibelangfuzz

import (
	"strings"
	"testing"
)

const migrationFactoryBindingQuote = "Diagnostics retain their existing codes, categories and eligibility; compiling a file does not apply a source rewrite."
const factoryBindingPrefix = "import { Effect } from \"effect\"\nlet constructions = 0\n/** @throws {never} */\nexport const count = () => constructions\n"
const factoryBindingSimple = factoryBindingPrefix + "export function make(label = \"value\") { constructions++; return Effect.succeed(label) }\n"
const factoryBindingGuarded = factoryBindingPrefix + "export function make(label = \"first\") { constructions++; let closed = false; return Effect.sync(() => { if (closed) return \"closed\"; closed = true; return label }) }\n"
const factoryBindingURL = factoryBindingPrefix + "export function make(base: string) { constructions++; const url = new URL(\"/v1/shape\", base).toString(); return Effect.succeed(url) }\n"
const factoryBindingReadTwice = "\nconst before = Factory.count()\nconst first = yield* operation\nconst second = yield* operation\nreturn [before, Factory.count(), first, second]\n"

var migrationFactoryBindingPrograms = append([]struct{ key, factory, body string }{
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
}, smithersFactoryPrograms...)

func TestMigrationFactoryBindingQuoted(t *testing.T) {
	chapterSays(t, "003-failures.md", "| `/** @throws {T} */` on it or its call signature | `T`, trusted, not checked |")
	if !strings.Contains(SpecText("007-tooling.md"), migrationFactoryBindingQuote) {
		t.Fatalf("Chapter 7 no longer contains %q", migrationFactoryBindingQuote)
	}
}
