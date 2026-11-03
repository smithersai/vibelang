package vibelang

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestFixNothrowHandlerRefusesIteratorCleanup(t *testing.T) {
	source := "export effect function main(xs:Iterable<number>){return (Effect.fail(1) catch (e)=>{for(const n of xs){if(n)throw e};return 0})}"
	_, file, _, _ := editorProgram(t, source)
	r := fixCase(t, filepath.Dir(file.FileName().AsString()))
	if r.Err != nil {
		t.Fatal(r.Err)
	}
	if len(r.Sites) == 0 {
		t.Fatalf("missing cleanup refusal: %+v", r)
	}
	text := source
	if fixed := r.Files[file.FileName()]; fixed != nil {
		text = fixed.Text
	}
	if strings.Contains(text, "catch effect") {
		t.Fatalf("native IteratorClose changed: %s", text)
	}
	for _, site := range r.Sites {
		if site.Code == "EK0401" && !SiteHolds(source, text, site) {
			t.Fatalf("refused throw changed: %+v", site)
		}
	}
}
