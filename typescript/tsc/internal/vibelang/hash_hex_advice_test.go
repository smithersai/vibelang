package vibelang

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestHashHexAdvice(t *testing.T) {
	var rows []struct {
		Key, Source string
		Host        bool
	}
	data, err := os.ReadFile("../vibelangfuzz/testdata/hash-hex-advice.json")
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(data, &rows); err != nil {
		t.Fatal(err)
	}
	for _, row := range rows {
		t.Run(row.Key, func(t *testing.T) {
			files := computedKeyFiles(false)
			files["/workspace/x/src/main.vibe"] = row.Source
			files["/workspace/x/src/node.d.ts"] = `declare module "crypto" {export function hash(algorithm:string,input:Uint8Array):string} declare module "node:crypto" {export function hash(algorithm:string,input:Uint8Array):string}`
			files["/workspace/x/src/tsconfig.json"] = `{"compilerOptions":{"strict":true,"target":"ES2022","module":"NodeNext","skipLibCheck":true,"noEmit":true},"files":["main.vibe","node.d.ts"]}`
			count := 0
			for _, d := range computedKeyProgram(t, files).GetSemanticDiagnostics(t.Context(), nil) {
				if d.Code() != EK4402.Code {
					continue
				}
				count++
				text := diagnosticWithNotes(d)
				for _, want := range []string{
					"try (try Digest.Digest).digestHex(Digest.sha256, bytes)", "lowercase hex", "buffer output", "matching algorithm",
				} {
					if !strings.Contains(text, want) {
						t.Errorf("missing %q in:\n%s", want, text)
					}
				}
			}
			if row.Host != (count > 0) {
				t.Fatalf("want host diagnostic presence %t, got %d", row.Host, count)
			}
		})
	}
}
