package vibelang

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

// EK4818 (preferSchemaOverJson) suggests the schema operation that replaces
// the call: JSON.parse decodes text, and JSON.stringify encodes a value, so
// its suggestion is Schema.encodeEffect, not the decode that parse gets.
func TestJSONPreferenceSuggestsTheMatchingSchemaOperation(t *testing.T) {
	t.Parallel()
	const source = "export const text = JSON.stringify({ a: 1 })\nexport const value: unknown = JSON.parse(text)\n"
	fs := bundled.WrapFS(vfstest.FromMap(fixtureRuntime(map[string]string{
		"/main.vibe":     source,
		"/tsconfig.json": `{ "compilerOptions": { "strict": true, "noEmit": true, "vibelang": { "diagnostics": { "EK4818": "warning" } } }, "files": ["main.vibe"] }`,
	}), tspath.CaseInsensitive))
	parsed, errors := tsoptions.GetParsedCommandLineOfConfigFile("/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 {
		t.Fatalf("tsconfig: %v", errors)
	}
	p := compiler.NewProgram(compiler.ProgramOptions{Config: parsed, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
	var got []string
	for _, d := range p.GetSemanticDiagnostics(t.Context(), p.GetSourceFile("/main.vibe")) {
		if d.Code() != EK4818.Code {
			continue
		}
		var notes []string
		for _, chained := range d.MessageChain() {
			notes = append(notes, chained.MessageText())
		}
		got = append(got, fmt.Sprintf("%s: %s", source[d.Pos():d.End()], strings.Join(notes, " ")))
	}
	slices.Sort(got)
	want := []string{
		"JSON.parse: Decode with a schema instead: Schema.decodeUnknownEffect(Schema.fromJsonString(User))(text).",
		"JSON.stringify: Encode with a schema instead: Schema.encodeEffect(Schema.fromJsonString(User))(user).",
	}
	if !slices.Equal(got, want) {
		t.Fatalf("EK4818 suggestions\n%q\nwant\n%q", got, want)
	}
}
