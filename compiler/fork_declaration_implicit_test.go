package compiler

import (
	_ "embed"
	"encoding/json"
	"strconv"
	"strings"
	"testing"
)

//go:embed declaration-implicit-vectors.json
var declarationImplicitVectors []byte

func TestPinnedForkPublishedImplicitInvocations(t *testing.T) {
	var vectors struct {
		Prelude string
		Cases   []struct {
			Name, Declaration, Body string
			Code                    string
			Async, Pure             bool
			Value                   int
			RequirementContracts    int
		}
	}
	if err := json.Unmarshal(declarationImplicitVectors, &vectors); err != nil {
		t.Fatal(err)
	}
	backend, ctx := newPinnedTestBackend(t)
	consumerOptions := Options{"lib": []string{"es2022", "dom", "esnext.disposable"}}
	for _, vector := range vectors.Cases {
		t.Run(vector.Name, func(t *testing.T) {
			producer, err := backend.Compile(ctx, CompileRequest{
				RootNames: []string{"library.vibe"}, Lowering: LoweringInternal,
				Files:   []SourceFile{{Path: "library.vibe", Kind: FileKindVibeLang, Text: vectors.Prelude + "\n" + vector.Declaration}},
				Options: Options{"declaration": true, "lib": []string{"es2022", "dom", "esnext.disposable"}},
			})
			if err != nil {
				t.Fatal(err)
			}
			requireClean(t, producer)
			declaration := artifactTextsByPath(t, producer.Artifacts)["library.d.vibe.ts"]
			if !strings.Contains(declaration, `"requirements":["C"]`) {
				t.Fatalf("published requirement lost:\n%s", declaration)
			}
			if vector.RequirementContracts != 0 && strings.Count(declaration, `"requirements":["C"]`) != vector.RequirementContracts {
				t.Fatalf("getter/parameter contracts crossed:\n%s", declaration)
			}
			async, await, resultType := "", "", "number"
			if vector.Async {
				async, await, resultType = "async ", "await ", "Promise<number>"
			}
			prefix := "import * as lib from './library.vibe'; import { Layer } from 'vibelang/provider'; export " + async +
				"function observe(): " + resultType + " { " + vector.Body + " }\n"
			unprovided := compilePublishedConsumer(t, backend, ctx, producer, prefix+"export const answer = "+await+"observe();", consumerOptions)
			if vector.Pure {
				requireClean(t, unprovided)
			} else {
				requireCode(t, unprovided, "VIBE2102", "C")
			}
			provided := compilePublishedConsumer(t, backend, ctx, producer, prefix+"export "+async+
				"function main(): "+resultType+" { return "+await+
				"Layer.provide(Layer.succeed(lib.C, { value: () => 7 }), "+async+"() => "+await+"observe()); }", consumerOptions)
			if vector.Code != "" {
				requireCode(t, provided, vector.Code, "dispos")
				if !provided.EmitSkipped || len(provided.Artifacts) != 0 {
					t.Fatal("invalid published disposal emitted code")
				}
				return
			}
			if actual := runPublishedConsumer(t, producer, provided); actual != strconv.Itoa(vector.Value) {
				t.Fatalf("published implicit invocation computed %q, expected %d", actual, vector.Value)
			}
		})
	}
}

func TestPinnedForkPublishedAccessorDeclarationMaps(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	source := publishedContextSource + `
export const resource = {
    get nested() {
        return { get value(): number { return C.context().value() }, label: "😀" };
    },
    set nested(value: { readonly value: number; label: string }) { void value.value; }
};
export function after(): number { return 1; }
`
	for _, removeComments := range []bool{false, true} {
		t.Run("removeComments="+strconv.FormatBool(removeComments), func(t *testing.T) {
			producer := compilePublishedLibrary(t, backend, ctx, source, removeComments)
			texts := artifactTextsByPath(t, producer.Artifacts)
			declaration := texts["library.d.vibe.ts"]
			if !strings.Contains(declaration, "set nested(") || strings.Count(declaration, `"requirements":["C"]`) != 1 {
				t.Fatalf("nested read/write contracts were not preserved independently:\n%s", declaration)
			}
			_, points := decodeEmittedMap(t, texts["library.d.vibe.ts.map"])
			line, column := positionOf(t, declaration, "after")
			authoredLine, authoredColumn := positionOf(t, source, "after")
			if !hasMapping(points, line, column, authoredLine, authoredColumn) {
				t.Fatalf("accessor restoration moved the following declaration without moving its map: generated %d:%d, authored %d:%d", line, column, authoredLine, authoredColumn)
			}
		})
	}
}

func TestPinnedForkPublishedAccessorMetadataValidation(t *testing.T) {
	var vectors struct {
		AccessorMetadataCases []struct{ Name, Payload string }
	}
	if err := json.Unmarshal(declarationImplicitVectors, &vectors); err != nil {
		t.Fatal(err)
	}
	backend, ctx := newPinnedTestBackend(t)
	for _, vector := range vectors.AccessorMetadataCases {
		t.Run(vector.Name, func(t *testing.T) {
			result, err := backend.Compile(ctx, CompileRequest{
				RootNames: []string{"main.vibe"}, Lowering: LoweringInternal,
				Files: []SourceFile{
					{Path: "main.vibe", Kind: FileKindVibeLang, Text: "import { resource } from './library.mjs'; export function main() { return { ...resource }.value }"},
					{Path: "library.d.mts", Kind: FileKindTypeScript, Text: declarationContractHeader +
						"export declare const resource: { /** @vibelangAccessor " + vector.Payload + " */ get value(): number };"},
				},
			})
			if err != nil {
				t.Fatal(err)
			}
			requireCode(t, result, "VIBE1810", "accessor")
		})
	}
	t.Run("compiler owned", func(t *testing.T) {
		result, err := backend.Compile(ctx, CompileRequest{
			RootNames: []string{"main.vibe"}, Lowering: LoweringInternal,
			Files: []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: `export const resource = { /** @vibelangAccessor {"version":1,"enumerable":false} */ get value() { return 1 } };`}},
		})
		if err != nil {
			t.Fatal(err)
		}
		requireCode(t, result, "VIBE1810", "compiler-owned")
	})
}
