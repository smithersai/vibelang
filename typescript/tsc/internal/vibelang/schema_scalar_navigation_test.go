package vibelang

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

func TestSchemaScalarTypeNavigation(t *testing.T) {
	packages := map[string]string{"effect": "packages/runtime/node_modules/effect", "vibelang-runtime": "packages/runtime", "bindings": "typescript/tsc/internal/vibelang/testdata/schema-generic-imports"}
	for _, name := range []string{"Date", "URL", "RegExp", "Uint8Array", "Error"} {
		for _, style := range []string{"direct", "import", "inline", "namespace", "alias"} {
			prefix, field, needle := "", name, name
			switch style {
			case "import":
				prefix = fmt.Sprintf("import type {Library%s as Native} from 'bindings'; ", name)
				field, needle = "Native", "Native"
			case "inline":
				prefix = fmt.Sprintf("import {type Library%s as Native} from 'bindings'; ", name)
				field, needle = "Native", "Native"
			case "namespace":
				prefix = "import type * as Types from 'bindings'; "
				field = "Types.Library" + name
				needle = "Library" + name
			}
			prefix = "import 'effect'; " + prefix
			body := "export schema Example {readonly value:" + field + "}"
			twin := "export type Example={readonly value:" + field + "}"
			if style == "alias" {
				body = "export schema Example=" + field
				twin = "export type Example=" + field
			}
			t.Run(name+"/"+style, func(t *testing.T) {
				answers := map[string]string{}
				for _, row := range []struct{ file, source string }{{"main.ts", prefix + twin}, {"main.vibe", prefix + body}} {
					program, file, service, converters := editorProgramAt(t, row.file, `{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"types":[]}`, row.source, editorPackageJSON, packages)
					service = ls.NewLanguageService(nil, program, fixHost{program: program, converters: converters}, file.FileName().AsString())
					for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
						if d.Category() == diagnostics.CategoryError {
							t.Fatalf("setup: %s", d.String())
						}
					}
					offset := strings.LastIndex(row.source, needle)
					pos, _ := converters.ToLSPPosition(file, core.TextPos(offset))
					uri := lsconv.FileNameToDocumentURI(file.FileName())
					def, err := service.ProvideDefinition(t.Context(), uri, pos)
					if err != nil {
						t.Fatal(err)
					}
					typ, err := service.ProvideTypeDefinition(t.Context(), uri, pos)
					if err != nil {
						t.Fatal(err)
					}
					hov, err := service.ProvideHover(t.Context(), &lsproto.HoverParams{TextDocument: lsproto.TextDocumentIdentifier{Uri: uri}, Position: pos})
					if err != nil {
						t.Fatal(err)
					}
					if hov.Hover == nil || hov.Hover.Contents.MarkupContent == nil {
						t.Fatal("missing hover")
					}
					for key, value := range map[string]any{"definition": def, "type-definition": typ, "hover": hov.Hover.Contents.MarkupContent.Value} {
						data, err := json.Marshal(value)
						if err != nil {
							t.Fatal(err)
						}
						text := schemaNavigationTargets(t, string(data))
						if row.file == "main.ts" {
							answers[key] = text
						} else if text != answers[key] {
							t.Errorf("%s: got %s; native %s", key, text, answers[key])
						}
					}
				}
			})
		}
	}
}

func TestSchemaScalarTypeNavigationValueControls(t *testing.T) {
	for _, prefix := range []string{
		"import * as Schema from 'effect/Schema'; const Decoder=Schema.String; ",
		"import * as Schema from 'effect/Schema'; type Decoder=string; const Decoder=Schema.String; ",
	} {
		answers := map[string]string{}
		for _, row := range []struct{ file, body string }{{"main.ts", "export type Example={readonly value:typeof Decoder.Type}"}, {"main.vibe", "export schema Example {readonly value:Decoder}"}} {
			source := prefix + row.body
			program, file, _, converters := editorProgramAt(t, row.file, `{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"types":[]}`, source, editorPackageJSON, editorPackages)
			service := ls.NewLanguageService(nil, program, fixHost{program: program, converters: converters}, file.FileName().AsString())
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatal(d.String())
				}
			}
			pos, _ := converters.ToLSPPosition(file, core.TextPos(strings.LastIndex(source, "Decoder")))
			uri := lsconv.FileNameToDocumentURI(file.FileName())
			def, err := service.ProvideDefinition(t.Context(), uri, pos)
			if err != nil {
				t.Fatal(err)
			}
			typ, err := service.ProvideTypeDefinition(t.Context(), uri, pos)
			if err != nil {
				t.Fatal(err)
			}
			hov, err := service.ProvideHover(t.Context(), &lsproto.HoverParams{TextDocument: lsproto.TextDocumentIdentifier{Uri: uri}, Position: pos})
			if err != nil {
				t.Fatal(err)
			}
			if hov.Hover == nil || hov.Hover.Contents.MarkupContent == nil {
				t.Fatal("missing hover")
			}
			for feature, value := range map[string]any{"definition": def, "type-definition": typ, "hover": hov.Hover.Contents.MarkupContent.Value} {
				data, err := json.Marshal(value)
				if err != nil {
					t.Fatal(err)
				}
				text := schemaNavigationTargets(t, strings.ReplaceAll(string(data), string(uri), "<source>"))
				if row.file == "main.ts" {
					answers[feature] = text
				} else if text != answers[feature] {
					t.Errorf("value %s: got %s; native %s", feature, text, answers[feature])
				}
			}
		}
	}
}

// Definition responses contain a collection of targets, whose order is not
// significant. Preserve every URI and range while comparing that collection.
func schemaNavigationTargets(t *testing.T, text string) string {
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
