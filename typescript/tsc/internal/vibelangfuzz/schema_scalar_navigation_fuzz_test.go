package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

const scalarNavigationTarget = "FuzzSchemaScalarTypeNavigation"
const scalarNavigationQuote = "These names mean the TypeScript-library bindings, selected by ordinary type lookup, as VIP-15's mapped generics do. A shadowing declaration supplies no schema."

func TestSchemaScalarTypeNavigationQuoted(t *testing.T) {
	if !strings.Contains(SpecText("../vips/0044-durable-values.md"), scalarNavigationQuote) {
		t.Fatal("VIP-44 library binding rule changed")
	}
	if !strings.Contains(SpecText("000-intro.md"), "Where a VIP is silent, its TypeScript or pinned TC39 counterpart applies.") {
		t.Fatal("TypeScript counterpart rule changed")
	}
}

// These source names select the same library type as their TypeScript twins.
// Codec selection must not change navigation or quick info for those names.
func FuzzSchemaScalarTypeNavigation(f *testing.F) {
	startShortBudget(f)
	names := []string{"Date", "URL", "RegExp", "Uint8Array", "Error"}
	for _, name := range names {
		f.Add(name, uint8(1), uint8(0))
	}
	f.Add("schema-value", uint8(8), uint8(0))
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, syntax, shape uint8) {
		TestSchemaScalarTypeNavigationQuoted(t)
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
		switch syntax % 4 {
		case 1:
			prefix = "import type {Library as Native} from './types.js'; "
			field, needle = "Native", "Native"
		case 2:
			prefix = "import {type Library as Native} from './types.js'; "
			field, needle = "Native", "Native"
		case 3:
			prefix = "import type * as Types from './types.js'; "
			field, needle = "Types.Library", "Library"
		}
		if syntax&4 != 0 && syntax%4 == 0 {
			prefix = "const " + name + "=1; "
		}
		nativeField := field
		control := syntax&8 != 0 || key == "schema-value"
		ruleKey := name
		if control {
			prefix = "import * as Schema from 'effect/Schema'; type Decoder=string; const Decoder=Schema.String; "
			field, nativeField, needle, ruleKey = "Decoder", "typeof Decoder.Type", "Decoder", "schema-value"
		}
		if shape%3 == 2 {
			field = "readonly [" + field + "]"
			nativeField = "readonly [" + nativeField + "]"
		}
		body, twin := "export schema Example {readonly value:"+field+"}", "export type Example={readonly value:"+nativeField+"}"
		if shape%3 == 1 {
			body, twin = "export schema Example="+field, "export type Example="+nativeField
		}
		files := map[string]string{"main.vibe": prefix + body, "control.ts": prefix + twin, "types.ts": "import Library=globalThis." + name + ";export {Library};"}
		r := toolsCompile(t, w, scalarNavigationTarget, files)
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
			toolsRun(t, scalarNavigationTarget, "navigation", Archive(files), nil, func() {
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
				Gap(t, scalarNavigationTarget, fmt.Sprintf("%s/%d/%d/%s/request", ruleKey, syntax%16, shape%3, file), scalarNavigationQuote+"; navigation request: %v\n%s", requestErr, Archive(files))
				return
			}
			for feature, value := range result {
				data, err := json.Marshal(value)
				if err != nil {
					t.Fatal(err)
				}
				text := strings.ReplaceAll(string(data), string(uri), "<source>")
				if file == "control.ts" {
					answers[feature] = text
				} else if text != answers[feature] {
					Gap(t, scalarNavigationTarget, fmt.Sprintf("%s/%d/%d/%s", ruleKey, syntax%16, shape%3, feature), scalarNavigationQuote+"; native %s; VibeLang %s\n%s", answers[feature], data, Archive(files))
				}
			}
		}
	})
}
