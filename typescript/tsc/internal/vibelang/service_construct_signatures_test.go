package vibelang

import "testing"

func TestServiceConstructSignatureHeads(t *testing.T) {
	const source = "// expect: EK0902\nexport service PlainFactory {\n static readonly key = \"construct/plain\";\n new(): number\n}\nexport service EffectFactory {\n static readonly key = \"construct/effect\";\n new(): number!!\n}\nexport service GenericFactory {\n static readonly key = \"construct/generic\";\n new<T>(value: T): T\n}\nexport service UntypedFactory {\n static readonly key = \"construct/untyped\";\n new()\n}\n"
	p, file, _, _ := editorProgram(t, source)
	count := 0
	for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
		if d.Source() != diagnosticSource || d.Code() != 902 {
			t.Errorf("unexpected diagnostic: %s", d.String())
		} else {
			count++
		}
	}
	if count != 4 {
		t.Fatalf("want four construct-signature errors, got %d", count)
	}
}

func TestServiceConstructSignatureControls(t *testing.T) {
	const source = "export service Quoted {\n static readonly key = \"construct/quoted\";\n \"new\"(): number!!\n}\nexport service Computed {\n static readonly key = \"construct/computed\";\n [\"new\"](): number!!\n}\nexport service Optional {\n static readonly key = \"construct/optional\";\n new?(): number!!\n}\nexport service ConstructorMember {\n static readonly key = \"construct/member\";\n create: new () => Date\n}\nexport class Ordinary { new(): number { return 1 } }\n"
	p, file, _, _ := editorProgram(t, source)
	for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
		t.Errorf("unexpected diagnostic: %s", d.String())
	}
}
