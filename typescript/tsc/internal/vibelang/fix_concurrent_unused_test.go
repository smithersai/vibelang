package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
	"testing"
)

func TestConcurrentUnusedHeadFix(t *testing.T) {
	for _, row := range []struct{ source, want string }{
		{"export effect function main(rows:number[]){for concurrent(const item of rows){}}", "export effect function main(rows:number[]){for concurrent(const _item of rows){}}"},
		{"export effect function main(rows:number[]){const _item=1;for concurrent(let item of rows){void _item}}", "export effect function main(rows:number[]){const _item=1;for concurrent(let _item2 of rows){void _item}}"},
		{"export effect function main(rows:number[]){let read:()=>unknown=()=>0;for concurrent(const item of (read=()=>item,rows)){};return read}", ""},
		{"export effect function main(rows:number[]){for concurrent(const item of rows){const item=1;void item}}", ""},
	} {
		t.Run(row.source, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, row.source)
			program.Options().NoUnusedLocals = core.TSTrue
			result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), program.CommandLine(), FixOptions{})
			if row.want == "" {
				if len(result.Files) != 0 {
					t.Fatalf("unsafe rename: %+v", result)
				}
				return
			}
			if len(result.Refused) != 0 || len(result.Files) != 1 {
				t.Fatalf("fix result: %+v", result)
			}
			if got := result.Files[file.FileName()].Text; got != row.want {
				t.Fatalf("want %q, got %q", row.want, got)
			}
		})
	}
}
