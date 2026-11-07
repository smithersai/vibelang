package vibelangfuzz

import (
	"maps"
	"strings"
	"testing"
)

var httpHandlerDeclarationCases = []string{"opencode-native-pipe", "opencode-native-pipe-fixed"}

func httpHandlerDeclarationSeed(t *testing.T, key string, variant uint8) string {
	t.Helper()
	TestTscDeclarationRulesQuoted(t)
	for _, seed := range CaseSeeds() {
		if seed.Name != key {
			continue
		}
		files := maps.Clone(seed.Files)
		files["tsconfig.json"] = withEmitters(files["tsconfig.json"])
		for name, text := range files {
			if !isSource(name) {
				continue
			}
			if variant&1 != 0 {
				text = strings.ReplaceAll(text, "handler", "requestHandler")
			}
			if variant&2 != 0 {
				text = strings.ReplaceAll(text, "\n", "\r\n")
			}
			files[name] = text
		}
		return Archive(files)
	}
	t.Fatalf("missing HTTP handler declaration fixture %q", key)
	return ""
}

func TestHttpHandlerDeclarationFixtures(t *testing.T) {
	w := NewWorkspace(t)
	for _, key := range httpHandlerDeclarationCases {
		t.Run(key, func(t *testing.T) {
			CheckCompile(t, w, "FuzzHttpHandlerDeclarations", httpHandlerDeclarationSeed(t, key, 0))
		})
	}
}

func FuzzHttpHandlerDeclarations(f *testing.F) {
	startShortBudget(f)
	for _, key := range httpHandlerDeclarationCases {
		for variant := range uint8(4) {
			f.Add(key, variant)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		if key != httpHandlerDeclarationCases[0] && key != httpHandlerDeclarationCases[1] {
			key = httpHandlerDeclarationCases[int(variant)%len(httpHandlerDeclarationCases)]
		}
		CheckCompile(t, w, "FuzzHttpHandlerDeclarations", httpHandlerDeclarationSeed(t, key, variant))
	})
}
