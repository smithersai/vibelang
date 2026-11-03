package vibelangfmt

import "testing"

// Chapter4 requires a semicolon after every match arm, including the last.
// Keep a valid binding/template/literal witness for the formatter; omitted
// separators are checked by the spec-quoted compiler corpus.
func TestMatchBindingArmRoundTrip(t *testing.T) {
	source := "function describeFailure(failure: NotFound | Timeout) {\n" +
		"  return match (failure) {\n" +
		"    when NotFound and { let id }: `no user ${id}`;\n" +
		"    when Timeout: 'retry';\n" +
		"  }\n" +
		"}\n"
	formatter := dprintFormatter(t)
	enc, err := encode("match-binding.vibe", source)
	if err != nil {
		t.Fatal(err)
	}
	formatted, err := formatter(enc.text)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := enc.decode(formatted)
	if err != nil {
		t.Fatal(err)
	}
	if err := SameProgram(source, decoded); err != nil {
		t.Logf("encoded minimized witness:\n%s", enc.text)
		t.Logf("formatted TypeScript:\n%s", formatted)
		t.Logf("decoded VibeLang:\n%s", decoded)
		t.Fatalf("match binding changed: %v", err)
	}
}
