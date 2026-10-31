package vibelang

import "testing"

func TestServiceCallSignatureMembers(t *testing.T) {
	const source = "export service Format {\n static readonly key = \"call/format\";\n (value: string): string\n}\nexport service Generic {\n static readonly key = \"call/generic\";\n <T>(value: T): T!!\n}\nexport service Mixed {\n static readonly key = \"call/mixed\"\n find(id: string): number!!\n (id: string): number\n readonly region: string\n}\n"
	p, file, _, _ := editorProgram(t, source)
	if diagnostics := p.GetSyntacticDiagnostics(t.Context(), file); len(diagnostics) != 0 {
		t.Fatalf("want no syntax errors, got %s", diagnostics[0].String())
	}
	count := 0
	for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
		if d.Source() != diagnosticSource || d.Code() != 902 {
			t.Errorf("unexpected diagnostic: %s", d.String())
		} else {
			count++
		}
	}
	if count != 3 {
		t.Fatalf("want three call-signature errors, got %d", count)
	}
}

func TestServiceCallSignatureControls(t *testing.T) {
	const source = "export service Callable {\n static readonly key = \"call/property\"\n format: (value: string) => string\n parse: { (value: string): number }\n}\nexport interface Formatter { (value: string): string }\nexport class Ordinary { call(value: string): string { return value } }\n"
	p, file, _, _ := editorProgram(t, source)
	for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), file), p.GetSemanticDiagnostics(t.Context(), file)...) {
		t.Errorf("unexpected diagnostic: %s", d.String())
	}
}
