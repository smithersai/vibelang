package vibelangfuzz

import (
	"maps"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

func TestMigrationMetadataCommentsQuoted(t *testing.T) {
	const quote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output"
	if !strings.Contains(SpecText("007-tooling.md"), quote) {
		t.Fatal("preserving repair rule moved")
	}
}

func FuzzMigrationMetadataComments(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"foreign-header", "foreign-footer", "foreign-inline", "hatch-header", "hatch-footer", "hatch-inline"} {
		f.Add(key, false)
		f.Add(key, true)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, crlf bool) {
		TestMigrationMetadataCommentsQuoted(t)
		const target = "FuzzMigrationMetadataComments"
		source := "import {double} from './plain.ts'\nexport const run=effect(o:{readonly p?:number})=>{if(!o.p)return 0;return double(o.p)}\n"
		if strings.HasPrefix(key, "hatch") {
			source = "export effect function run(){let text='1';const n=try((text)=>{text='2';return JSON.parse(text)},text);return [n,text]}\n"
		}
		const marker = "// metadata marker: café 😀; keep this association"
		switch {
		case strings.HasSuffix(key, "header"):
			source = marker + "\n" + source
		case strings.HasSuffix(key, "inline"):
			source = strings.TrimSuffix(source, "\n") + " " + marker + "\n"
		default:
			source += "\n" + marker + "\n"
		}
		if crlf {
			source = strings.ReplaceAll(source, "\n", "\r\n")
		}
		files := map[string]string{"main.vibe": source, "plain.ts": "export const double=(n:number):number=>n*2\n"}
		before := toolsCompile(t, w, target, files)
		defer before.Remove()
		options := vibelang.FixOptions{}
		if strings.HasPrefix(key, "hatch") {
			options.VIPOnly = true
		}
		result := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), options)
		if result.Err != nil || len(result.Refused) != 0 {
			t.Fatalf("repair err=%v refused=%v source=%s", result.Err, result.Refused, source)
		}
		fixed := maps.Clone(files)
		for name, file := range result.Files {
			fixed[strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")] = file.Text
		}
		if len(result.Files) == 0 {
			t.Fatal("witness was not repaired")
		}
		text := fixed["main.vibe"]
		if strings.Count(text, marker) != 1 {
			t.Fatalf("metadata comment lost or duplicated: %s", text)
		}
		if strings.HasSuffix(key, "header") && !strings.HasPrefix(text, marker) {
			t.Fatalf("header association changed: %s", text)
		}
		if strings.HasSuffix(key, "footer") && !strings.HasSuffix(strings.TrimSpace(text), marker) {
			t.Fatalf("footer association changed: %s", text)
		}
		after := toolsCompile(t, w, target, fixed)
		defer after.Remove()
		if !toolsErrorFree(after) {
			t.Fatalf("fixed errors=%v source=%s", after.Diagnostics, text)
		}
		second := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, after.Dir), options)
		if second.Err != nil || len(second.Files) != 0 || len(second.Refused) != 0 {
			t.Fatalf("repeat repair changed metadata: %+v", second)
		}
	})
}
