package vibelangfuzz

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReturnedPipeContractQuoted(t *testing.T) {
	data, err := os.ReadFile(filepath.Join(Root(), ".smithers/flows/migrate/test/corpus/foldkit-websocket-returned-pipe-error.json"))
	if err != nil {
		t.Fatal(err)
	}
	var corpus struct {
		Rule struct{ Chapter, Quote string }
	}
	if err := json.Unmarshal(data, &corpus); err != nil {
		t.Fatal(err)
	}
	if corpus.Rule.Chapter != "001-functions.md" || corpus.Rule.Quote == "" || !strings.Contains(SpecText(corpus.Rule.Chapter), corpus.Rule.Quote) {
		t.Fatalf("the returned-pipe contract oracle lost its Chapter1 citation: %+v", corpus.Rule)
	}
}
