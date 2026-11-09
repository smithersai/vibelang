package vibelang

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

func TestSchemaGenericTypeNavigation(t *testing.T) {
	packages := map[string]string{"effect": "packages/runtime/node_modules/effect", "vibelang-runtime": "packages/runtime", "bindings": "typescript/tsc/internal/vibelang/testdata/schema-generic-imports"}
	for _, name := range []string{"Array", "ReadonlyArray", "Record", "Readonly", "ReadonlySet", "ReadonlyMap"} {
		for _, style := range []string{"direct", "import", "inline", "namespace", "qualified", "alias"} {
			for _, home := range []string{"module", "function", "namespace"} {
				prefix, field, needle := "", name, name
				switch style {
				case "import":
					prefix = fmt.Sprintf("import type {Library%s as Native} from 'bindings'; ", name)
					field, needle = "Native", "Native"
				case "inline":
					prefix = fmt.Sprintf("import {type Library%s as Native} from 'bindings'; ", name)
					field, needle = "Native", "Native"
				case "qualified":
					field = "globalThis." + name
				case "namespace":
					prefix = "import type * as Types from 'bindings'; "
					field = "Types.Library" + name
					needle = "Library" + name
				}
				switch name {
				case "Record", "ReadonlyMap":
					field += "<string, number>"
				case "Readonly":
					field += "<Record<string, number>>"
				default:
					field += "<number>"
				}
				prefix = "import 'effect'; " + prefix
				body := "export schema Example {readonly value:" + field + "}"
				twin := "export type Example={readonly value:" + field + "}"
				if style == "alias" {
					body = "export schema Example=" + field
					twin = "export type Example=" + field
				}
				switch home {
				case "function":
					body = "export function scope() {" + strings.TrimPrefix(body, "export ") + ";}"
					twin = "export function scope() {" + strings.TrimPrefix(twin, "export ") + ";}"
				case "namespace":
					body = "export namespace Scope {" + body + ";}"
					twin = "export namespace Scope {" + twin + ";}"
				}
				t.Run(name+"/"+style+"/"+home, func(t *testing.T) {
					defer func() {
						if failure := recover(); failure != nil {
							t.Fatalf("navigation panicked: %v", failure)
						}
					}()
					answers := map[string]string{}
					for _, row := range []struct{ file, source string }{{"main.ts", prefix + twin}, {"main.vibe", prefix + body}} {
						program, file, service, converters := editorProgramAt(t, row.file, `{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"types":[]}`, row.source, editorPackageJSON, packages)
						service = ls.NewLanguageService(nil, program, programEditorHost{program: program, converters: converters}, file.FileName().AsString())
						for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
							if d.Category() == diagnostics.CategoryError {
								t.Fatalf("setup: %s", d.String())
							}
						}
						t.Logf("source=%s generic=%s style=%s home=%s", row.file, name, style, home)
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
							text := schemaNavigationTargets(t, strings.ReplaceAll(string(data), string(uri), "<source>"))
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
}
