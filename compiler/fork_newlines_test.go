package compiler

import (
	"os/exec"
	"strings"
	"testing"
)

func TestPinnedForkAuthoredNewlineSourceMaps(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, newline := range []string{"\n", "\r\n", "\r", "\u2028", "\u2029"} {
		t.Run(newline, func(t *testing.T) {
			const file = "main.vibe"
			source := strings.Join([]string{
				"// astral 🦀", "export function read(): number {", "  if (const value = 41; value > 0) {",
				"    return value + 1;", "  }", "  return 0;", "}", "export const answer = read();", "",
			}, newline)
			result, err := backend.Compile(ctx, CompileRequest{RootNames: []string{file}, Files: []SourceFile{{Path: file, Kind: FileKindVibeLang, Text: source}},
				Lowering: LoweringInternal, Options: Options{"sourceMap": true, "inlineSources": true}})
			if err != nil {
				t.Fatal(err)
			}
			requireClean(t, result)
			outputs := artifactTextsByPath(t, result.Artifacts)
			parsed, points := decodeEmittedMap(t, outputs["main.js.map"])
			if len(parsed.SourcesContent) != 1 || parsed.SourcesContent[0] == nil || *parsed.SourcesContent[0] != source || len(points) == 0 {
				t.Fatalf("lost authored map source: %+v", parsed)
			}
			index := newLineIndex(source)
			for _, point := range points {
				if point.hasSource && (point.sourceLine >= index.lineCount() || point.sourceCharacter > index.utf16Length(point.sourceLine)) {
					t.Fatalf("mapping escaped authored newline boundaries: %+v", point)
				}
			}
			node, err := exec.LookPath("node")
			if err != nil {
				t.Fatal(err)
			}
			command := exec.CommandContext(ctx, node, "--input-type=module")
			command.Stdin = strings.NewReader(outputs["main.js"] + "\nconsole.log(answer);\n")
			output, err := command.CombinedOutput()
			if err != nil || strings.TrimSpace(string(output)) != "42" {
				t.Fatalf("output=%q err=%v", output, err)
			}
		})
	}
}
