package vibelangfuzz

import (
	"maps"
	"strconv"
	"strings"
	"testing"
)

const defaultLiteralDeclarationsTarget = "FuzzServiceDefaultLiteralDeclarations"

var defaultLiteralKinds = []string{"number", "string", "boolean", "bigint", "null", "undefined", "union", "annotated-number", "wide-number", "symbol", "void", "never", "unknown"}

func defaultLiteralKeys() []string {
	var keys []string
	for _, form := range []string{"typeof", "indexed"} {
		for _, kind := range defaultLiteralKinds {
			keys = append(keys, form+"-"+kind)
		}
	}
	return keys
}

func defaultLiteralProject(key string, choice uint8) map[string]string {
	kind := strings.TrimPrefix(strings.TrimPrefix(key, "typeof-"), "indexed-")
	n := strconv.Itoa(1 + int(choice%20))
	shape, annotation, value, prefix := "number", "", n, ""
	switch kind {
	case "string":
		shape, value = "string", strconv.Quote("value"+n)
	case "boolean":
		shape, value = "boolean", strconv.FormatBool(choice&1 == 0)
	case "bigint":
		shape, value = "bigint", n+"n"
	case "null":
		shape, value = "string | null", "null"
	case "undefined":
		shape, value = "number | undefined", "undefined"
	case "union":
		annotation, value = ": 1 | 2", "seed"
		prefix = "const seed: 1 | 2 = 1\n"
	case "annotated-number":
		annotation = ": " + n
	case "wide-number":
		shape, annotation = "unknown", ": number"
	case "symbol":
		shape, annotation, value = "unknown", ": symbol", "Symbol.for(\"default-literal\")"
	case "void":
		shape, annotation, value = "unknown", ": void", "undefined"
	case "never":
		shape, annotation, value = "unknown", ": never", "stop()"
		prefix = "function stop(): never { while (true) {} }\n"
	case "unknown":
		shape, annotation = "any", ": unknown"
	}
	declaration := prefix + "export service Flags: " + shape + " { static readonly key = \"literal/Flags\"; static readonly default" + annotation + " = " + value + " }\n"
	read := "typeof Flags.default"
	if strings.HasPrefix(key, "indexed-") {
		read = "(typeof Flags)[\"default\"]"
	}
	if choice&2 != 0 {
		read = "(" + read + ")[]"
	}
	if choice&4 != 0 {
		read = "readonly [" + read + ", " + read + "]"
	}
	statement := "export type Read = " + read + "\n"
	if choice&1 != 0 {
		return map[string]string{"flags.vibe": declaration, "main.vibe": "import { Flags } from \"./flags.js\"\n" + statement}
	}
	return map[string]string{"main.vibe": strings.Replace(declaration, "export service Flags:", "service Flags:", 1) + statement}
}

// VIP-9 gives the native class as the preserving reference. The retired
// declaration can report EK0902 while remaining an EK4855 migration input;
// its erroneous checker type is not a declaration-output oracle.
func defaultLiteralNativeProject(t *testing.T, files map[string]string) map[string]string {
	t.Helper()
	native := maps.Clone(files)
	for name, source := range files {
		if !strings.Contains(source, "service Flags: ") {
			continue
		}
		prefix, body, ok := strings.Cut(source, "service Flags: ")
		if !ok {
			t.Fatal("missing legacy service")
		}
		shape, members, ok := strings.Cut(body, " { static readonly key = \"literal/Flags\"; ")
		if !ok {
			t.Fatal("missing legacy key")
		}
		native[name] = "import * as Context from \"effect/Context\"\n" + prefix +
			"class Flags extends Context.Service<Flags, " + shape + ">()(\"literal/Flags\") { " + members
	}
	return native
}

// The same type-only client reads each actual emitted package declaration.
// Chapter 7 promises that a repair preserves this surface, not only the
// producer checker's view of a static field. No declaration text is guessed.
func defaultLiteralPublishedType(t *testing.T, w *Workspace, emitted *Result, key string) (string, bool) {
	t.Helper()
	files := map[string]string{"main.vibe": "export type Read = import(\"./public/main.js\").Read\n"}
	for name, text := range emitted.Outputs {
		if strings.HasSuffix(name, ".d.ts") || strings.HasSuffix(name, ".d.vibe.ts") {
			files["public/"+strings.TrimPrefix(name, "out/")] = text
		}
	}
	published := toolsCompile(t, w, defaultLiteralDeclarationsTarget, files)
	defer published.Remove()
	if !toolsErrorFree(published) {
		Gap(t, defaultLiteralDeclarationsTarget, "published:"+key, "declaration client errors: %v\n%s", SortedKeys(Keys(published.Dir, published.Diagnostics)), Archive(files))
		return "", false
	}
	return serviceDefaultReadType(t, published), true
}
