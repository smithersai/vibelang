package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

const genericNavigationTarget = "FuzzSchemaGenericTypeNavigation"
const genericNavigationQuote = "The generic built-ins `Array<T>`, `ReadonlyArray<T>`, `Record<K, V>` and `Readonly<T>` in the table mean the corresponding TypeScript-library type bindings, selected by ordinary type lookup and alias resolution, not by spelling."

func TestSchemaGenericTypeNavigationQuoted(t *testing.T) {
	if !strings.Contains(SpecText("006-data.md"), genericNavigationQuote) {
		t.Fatal("schema library binding rule changed")
	}
	if !strings.Contains(SpecText("../vips/0044-durable-values.md"), "These names mean the TypeScript-library bindings, selected by ordinary type lookup, as VIP-15's mapped generics do. A shadowing declaration supplies no schema.") {
		t.Fatal("collection library binding rule changed")
	}
}

// Each mapped generic name has the editor behavior of its native type binding,
// including when the retained reference belongs to an alias or a nested scope.
func FuzzSchemaGenericTypeNavigation(f *testing.F) {
	startShortBudget(f)
	names := []string{"Array", "ReadonlyArray", "Record", "Readonly", "ReadonlySet", "ReadonlyMap"}
	for _, name := range names {
		f.Add(name, uint8(0), uint8(0))
		f.Add(name, uint8(1), uint8(1))
		f.Add(name, uint8(11), uint8(2))
	}
	f.Add("Array", uint8(4), uint8(7))
	f.Add("Readonly", uint8(8), uint8(3))
	f.Add("ReadonlyMap", uint8(5), uint8(8))
	f.Add("ReadonlySet", uint8(10), uint8(4))
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, syntax, shape uint8) {
		TestSchemaGenericTypeNavigationQuoted(t)
		if key == "" || len(key) > 128 {
			return
		}
		name := names[int(key[0])%len(names)]
		for _, n := range names {
			if key == n {
				name = n
			}
		}
		prefix, field, needle := "", name, name
		switch syntax & 7 {
		case 1:
			prefix = "import type {Library as Native} from './types.js'; "
			field, needle = "Native", "Native"
		case 2:
			prefix = "import {type Library as Native} from './types.js'; "
			field, needle = "Native", "Native"
		case 3:
			prefix = "import type * as Types from './types.js'; "
			field, needle = "Types.Library", "Library"
		case 4:
			field = "globalThis." + name
		case 5, 6, 7:
			prefix = "const " + name + "=1; "
		}
		switch name {
		case "Record", "ReadonlyMap":
			field += "<string, number>"
		case "Readonly":
			field += "<Record<string, number>>"
		default:
			field += "<number>"
		}
		switch shape / 3 % 3 {
		case 1:
			field = "readonly [" + field + "]"
		case 2:
			field = "ReadonlyArray<" + field + ">"
		}
		body := "export schema Example {readonly value:" + field + "}"
		twin := "export type Example={readonly value:" + field + "}"
		if syntax&8 != 0 {
			body, twin = "export schema Example="+field, "export type Example="+field
		}
		switch shape % 3 {
		case 1:
			body = "export function scope(){" + strings.TrimPrefix(body, "export ") + ";}"
			twin = "export function scope(){" + strings.TrimPrefix(twin, "export ") + ";}"
		case 2:
			body = "export namespace Scope{" + body + ";}"
			twin = "export namespace Scope{" + twin + ";}"
		}
		files := map[string]string{"main.vibe": prefix + body, "control.ts": prefix + twin, "types.ts": "export import Library=globalThis." + name + ";"}

		r := toolsCompile(t, w, genericNavigationTarget, files)
		defer r.Remove()
		if HasError(r.Diagnostics) {
			t.Fatalf("invalid navigation witness: %v\n%s", Keys(r.Dir, r.Diagnostics), Archive(files))
		}
		c := &consistency{t: t, ctx: t.Context(), w: w, main: "main.vibe", archive: Archive(files)}
		p := c.project(r, files)
		answers := map[string]string{}
		for _, file := range []string{"control.ts", "main.vibe"} {
			uri := p.uri(file)
			position := p.position(file, strings.LastIndex(files[file], needle))
			result := map[string]any{}
			var requestErr error
			toolsRun(t, genericNavigationTarget, "navigation", Archive(files), nil, func() {
				definition, err := p.service.ProvideDefinition(t.Context(), uri, position)
				if err != nil {
					requestErr = err
					return
				}
				typ, err := p.service.ProvideTypeDefinition(t.Context(), uri, position)
				if err != nil {
					requestErr = err
					return
				}
				hover, err := p.service.ProvideHover(t.Context(), &lsproto.HoverParams{TextDocument: lsproto.TextDocumentIdentifier{Uri: uri}, Position: position})
				if err != nil {
					requestErr = err
					return
				}
				if hover.Hover == nil || hover.Hover.Contents.MarkupContent == nil {
					requestErr = fmt.Errorf("missing hover")
					return
				}
				result["definition"], result["type-definition"], result["hover"] = definition, typ, hover.Hover.Contents.MarkupContent.Value
			})
			if requestErr != nil {
				Gap(t, genericNavigationTarget, fmt.Sprintf("%s/%d/%d/%s/request", name, syntax%16, shape%9, file), genericNavigationQuote+"; navigation request: %v\n%s", requestErr, Archive(files))
				return
			}
			for feature, value := range result {
				data, err := json.Marshal(value)
				if err != nil {
					t.Fatal(err)
				}
				text := genericNavigationTargets(t, strings.ReplaceAll(string(data), string(uri), "<source>"))
				if file == "control.ts" {
					answers[feature] = text
				} else if text != answers[feature] {
					Gap(t, genericNavigationTarget, fmt.Sprintf("%s/%d/%d/%s", name, syntax%16, shape%9, feature), genericNavigationQuote+"; native %s; VibeLang %s\n%s", answers[feature], data, Archive(files))
				}
			}
		}
	})
}

// Preserve all target locations and ranges; definition target order is not
// significant, and the two source files necessarily have different URIs.
func genericNavigationTargets(t *testing.T, text string) string {
	t.Helper()
	var value any
	if err := json.Unmarshal([]byte(text), &value); err != nil {
		t.Fatal(err)
	}
	if object, ok := value.(map[string]any); ok {
		for _, key := range []string{"Locations", "DefinitionLinks"} {
			if list, ok := object[key].([]any); ok {
				sort.Slice(list, func(i, j int) bool {
					a, _ := json.Marshal(list[i])
					b, _ := json.Marshal(list[j])
					return string(a) < string(b)
				})
			}
		}
	}
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}
