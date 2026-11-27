package vibelangestree

import "testing"

func TestParseSchemaDataDeclaration(t *testing.T) {
	src := "export schema Address { city: string }\nexport schema data Delivery {\n  Waiting\n  Sent { tracking: string; address: Address }\n}\n"
	program := parse(t, "/delivery.vibe", src)
	all := nodes(program)
	foundSchemaValue := false
	for _, n := range all {
		if n["type"] == "Identifier" && n["name"] == "Address" && n["schemaValue"] == true {
			foundSchemaValue = true
		}
	}
	if !foundSchemaValue {
		t.Fatalf("expected Address in schema data variant to carry schemaValue=true")
	}
}
