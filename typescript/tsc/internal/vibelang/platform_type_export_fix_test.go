package vibelang

import (
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

func TestPlatformTypeExportRepair(t *testing.T) {
	data, err := os.ReadFile("../vibelangfuzz/testdata/platform-type-export-fixes.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Key, Source, Module string
		TypeOnly            bool
	}
	if err := json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}
	for _, test := range cases {
		t.Run(test.Key, func(t *testing.T) {
			p, file, _, _ := platformImportProgram(t, test.Source, true)
			result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), FixOptions{})
			fixed := result.Files[file.FileName()]
			if result.Err != nil || len(result.Refused) != 0 || len(result.Files) != 1 || fixed == nil {
				t.Fatalf("expected a preserving single-source repair: %+v", result)
			}
			text := fixed.Text
			if !strings.Contains(text, "module $platformExport") || !strings.Contains(text, "import $platformExport") || !strings.Contains(text, "export {} from \""+test.Module+"\"") {
				t.Fatalf("runtime dependency must remain behind a side-effect-imported native body:\n%s", text)
			}
			if test.TypeOnly && !strings.Contains(text, "export type") {
				t.Fatalf("lost type export:\n%s", text)
			}
			for _, comment := range []string{"/* before */", "/* binding */"} {
				if strings.Contains(test.Source, comment) && strings.Count(text, comment) != 1 {
					t.Fatalf("lost or duplicated %s:\n%s", comment, text)
				}
			}
			checked, next, _, _ := platformImportProgram(t, text, true)
			if ds := checked.GetSemanticDiagnostics(t.Context(), next); len(ds) != 0 {
				t.Fatalf("fixed source: %v", ds)
			}
			again := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), checked.CommandLine(), FixOptions{})
			if again.Err != nil || len(again.Files) != 0 || len(again.Refused) != 0 {
				t.Fatalf("not a fixed point: %+v", again)
			}
		})
	}
}

func TestPlatformTypeExportRepairControls(t *testing.T) {
	for _, test := range []struct {
		name, source string
		verbatim     bool
	}{
		{"whole type", "export type { Stats } from \"node:fs\"\n", true},
		{"elided inline", "export { type Stats } from \"node:fs\"\n", false},
		{"elided empty", "export {} from \"fs\"\n", false},
		{"ordinary dependency", "export { type Stats } from \"ordinary\"\n", true},
	} {
		t.Run(test.name, func(t *testing.T) {
			p, _, _, _ := platformImportProgram(t, test.source, test.verbatim)
			result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), FixOptions{})
			if result.Err != nil || len(result.Files) != 0 || len(result.Refused) != 0 {
				t.Fatalf("unchanged control: %+v", result)
			}
		})
	}
}

func TestPlatformTypeExportRepairPreservesLeadingMetadata(t *testing.T) {
	for _, leading := range []string{"/** Public type documentation. */", "// @ts-expect-error", "/// <reference path=\"node.d.ts\" />", "// eslint-disable-next-line"} {
		t.Run(leading, func(t *testing.T) {
			p, file, _, _ := platformImportProgram(t, leading+"\nexport { type Stats } from \"node:fs\"\n", true)
			c, done := p.GetTypeCheckerForFile(t.Context(), file)
			defer done()
			rewrite := platformTypeExportRewrite(c, file, file.Statements.Nodes[0])
			if rewrite == nil || rewrite.fixable() || !strings.Contains(rewrite.why, "documentation and directives") {
				t.Fatalf("leading metadata needs an explicit boundary: %+v", rewrite)
			}
		})
	}
}
