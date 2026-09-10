package compiler

import (
	"encoding/json"
	"strconv"
	"strings"
	"testing"
)

func TestPinnedForkBodyOriginMaps(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	lowerer := backend.(BodyLowerer)
	const source = `import {durable,Action} from "vibelang:flows"; class Read extends Action<(n:number)=>Result<number,never>>{}; export const Flow=durable((n:number):Result<number,never>=>Read.run(n)!)`
	const name = "origin.vibe"
	base := func() map[string]any {
		return map[string]any{"version": 3, "file": name, "sourceRoot": "", "sources": []string{name},
			"sourcesContent": []string{source}, "names": []string{}, "mappings": "AAAA"}
	}
	for _, tc := range []struct {
		name     string
		change   func(map[string]any)
		accepted bool
		message  string
	}{
		{"ordinary single source", nil, true, ""},
		{"comptime extension", func(v map[string]any) {
			v["x_vibelang_comptime"] = map[string]any{"schema": "vibelang.comptime-lowering/v1", "edits": []any{}}
		}, true, ""},
		{"primary is not first", func(v map[string]any) {
			v["sources"] = []string{"input.ts", name}
			v["sourcesContent"] = []string{"export const input=1", source}
			v["mappings"] = "ACAA"
		}, true, ""},
		{"foreign segment is not primary", func(v map[string]any) {
			v["sources"] = []string{"input.ts", name}
			v["sourcesContent"] = []string{source, source}
		}, false, "no authored location"},
		{"foreign segment is validated", func(v map[string]any) {
			v["sources"] = []string{name, "input.ts"}
			v["sourcesContent"] = []string{source, ""}
			v["mappings"] = "ACAC"
		}, false, "beyond authored line"},
		{"missing source", func(v map[string]any) { v["sources"] = []string{"other.vibe"} }, false, "sources must name"},
		{"duplicate primary", func(v map[string]any) {
			v["sources"] = []string{name, "./" + name}
			v["sourcesContent"] = []string{source, source}
		}, false, "unique"},
		{"missing pinned text", func(v map[string]any) { delete(v, "sourcesContent") }, false, "pin each"},
		{"null pinned text", func(v map[string]any) { v["sourcesContent"] = []any{nil} }, false, "pin each"},
		{"changed pinned text", func(v map[string]any) { v["sourcesContent"] = []string{"changed"} }, false, "does not match"},
		{"invalid source index", func(v map[string]any) { v["mappings"] = "ACAA" }, false, "source index"},
		{"invalid name index", func(v map[string]any) { v["mappings"] = "AAAAA" }, false, "name index"},
		{"invalid mapping", func(v map[string]any) { v["mappings"] = "g" }, false, "mappings"},
		{"nonempty source root", func(v map[string]any) { v["sourceRoot"] = "other" }, false, "sourceRoot"},
		{"unknown extension", func(v map[string]any) { v["x_forged"] = map[string]any{} }, false, "unknown field"},
		{"null comptime extension", func(v map[string]any) { v["x_vibelang_comptime"] = nil }, false, "must be an object"},
		{"array comptime extension", func(v map[string]any) { v["x_vibelang_comptime"] = []any{} }, false, "must be an object"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			value := base()
			if tc.change != nil {
				tc.change(value)
			}
			encoded, err := json.Marshal(value)
			if err != nil {
				t.Fatal(err)
			}
			got, err := lowerer.LowerBody(ctx, BodyLoweringRequest{Source: source, FileName: name, FlowVersion: 1, RuntimeImport: "vibelang/runtime", OutputFileName: "/output/origin.ts",
				SourceOrigin: &BodyLoweringOrigin{Text: source, SourceMap: string(encoded), LoweringIdentity: strings.Repeat("a", 64)}})
			if err != nil || got.OK != tc.accepted {
				t.Fatalf("lowering %+v, err=%v", got, err)
			}
			if tc.accepted {
				var manifest struct{ Sites []struct{ Anchor string } }
				if err := json.Unmarshal([]byte(got.ManifestJSON), &manifest); err != nil {
					t.Fatal(err)
				}
				if len(manifest.Sites) != 1 || manifest.Sites[0].Anchor != "0:"+strconv.Itoa(strings.Index(source, "Read.run")) {
					t.Fatalf("wrong authored request anchor: %+v", manifest)
				}
			} else if got.Reason != "provenance" || len(got.Diagnostics) != 1 || got.Diagnostics[0].Code != "VIBE4101" || !strings.Contains(got.Diagnostics[0].Message, tc.message) {
				t.Fatalf("invalid provenance was not a structured refusal: %+v", got)
			}
		})
	}
	t.Run("duplicate source-map fields", func(t *testing.T) {
		value, err := json.Marshal(base())
		if err != nil {
			t.Fatal(err)
		}
		wire := `{"version":3,` + string(value[1:])
		got, err := lowerer.LowerBody(ctx, BodyLoweringRequest{Source: source, FileName: name, FlowVersion: 1, RuntimeImport: "vibelang/runtime", OutputFileName: "/output/origin.ts",
			SourceOrigin: &BodyLoweringOrigin{Text: source, SourceMap: wire, LoweringIdentity: strings.Repeat("a", 64)}})
		if err != nil || got.OK || got.Reason != "provenance" || len(got.Diagnostics) != 1 || !strings.Contains(got.Diagnostics[0].Message, "duplicate") {
			t.Fatalf("%+v %v", got, err)
		}
	})
}
