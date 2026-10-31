package vibelang

import "testing"

func TestServiceShapeThisTypeContext(t *testing.T) {
	const source = "// expect: TS2526\nimport { Effect } from \"effect\"\nservice Direct {\n static readonly key = \"shape-this/direct\";\n self: this\n}\nservice Method {\n static readonly key = \"shape-this/method\";\n next(): this!!\n}\nservice Nested {\n static readonly key = \"shape-this/nested\";\n nested: { self: this }\n}\n"
	p, file, _, _ := editorProgram(t, source)
	count := 0
	for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
		if d.Source() == "" && d.Code() == 2526 {
			count++
		} else {
			t.Errorf("unexpected diagnostic %s%d: %s", d.Source(), d.Code(), d.String())
		}
	}
	if count != 3 {
		t.Errorf("want three native TS2526 errors, got %d", count)
	}
}

func TestServiceShapeInterfaceThisControl(t *testing.T) {
	const source = "// expect-result: 7\ninterface Api {\n value: number;\n readonly self: this\n}\nclass Impl implements Api {\n value = 7\n get self(): this { return this }\n next(): this { return this }\n}\nservice Recursive: Api {\n static readonly key = \"shape-this/valid\"\n}\n"
	p, file, _, _ := editorProgram(t, source)
	for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
		t.Errorf("unexpected diagnostic %s%d: %s", d.Source(), d.Code(), d.String())
	}
}
