package vibelang

import "testing"

func TestServiceImplementationMemberDiagnostic(t *testing.T) {
	const source = "// expect: EK0902\nexport service MethodBody {\n static readonly key = \"implementation/method\";\n run(): number!! { return 1 }\n}\nexport service FieldBody {\n static readonly key = \"implementation/field\";\n value = 1\n}\nexport service GetterBody {\n static readonly key = \"implementation/getter\";\n get value(): number { return 1 }\n}\n"
	p, file, _, _ := editorProgram(t, source)
	count := 0
	for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
		if d.Source() != diagnosticSource || d.Code() != 902 {
			t.Errorf("unexpected diagnostic: %s", d.String())
		} else {
			count++
		}
	}
	if count != 3 {
		t.Fatalf("want three implementation-member errors, got %d", count)
	}
}

func TestServiceImplementationErrorPrecedence(t *testing.T) {
	const source = "export service PlainBody {\n static readonly key = \"implementation/plain\";\n run(): number { return 1 }\n}\ninterface GivenShape { readonly value: number }\nexport service AliasedBody: GivenShape {\n static readonly key = \"implementation/alias\";\n extra: number\n}\n"
	p, file, _, _ := editorProgram(t, source)
	count := 0
	for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
		if d.Source() != diagnosticSource || d.Code() != 902 {
			t.Errorf("unexpected diagnostic: %s", d.String())
		} else {
			count++
		}
	}
	if count != 2 {
		t.Fatalf("want two member errors without a contract cascade, got %d", count)
	}
}

func TestServiceImplementationControls(t *testing.T) {
	const source = "export service Declared {\n static readonly key = \"implementation/declared-control\";\n value: number\n run(): number!!\n}\nexport service Defaulted: number {\n static readonly key = \"implementation/default-control\";\n static readonly defaultValue = () => 1\n}\nexport class Ordinary {\n value = 1\n run(): number { return 1 }\n get computed(): number { return this.value }\n}\n"
	p, file, _, _ := editorProgram(t, source)
	for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
		t.Errorf("unexpected diagnostic: %s", d.String())
	}
}

func TestServiceImplementationControlDiagnostic(t *testing.T) {
	p, file, _, _ := editorProgram(t, "export control Legacy { run(): number { return 1 } }")
	count := 0
	for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
		if d.Source() != diagnosticSource || d.Code() != 9207 {
			t.Errorf("unexpected diagnostic: %s", d.String())
		} else {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("want one unchanged Control implementation error, got %d", count)
	}
}
