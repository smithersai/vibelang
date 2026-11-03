package vibelangfuzz

import "testing"

func TestEditorContainmentPanicKeys(t *testing.T) {
	frame := "ls.getContainingArgumentInfo"
	block := toolsPanicKey(frame, "Debug failure. False expression: Not a subspan. Child: KindVariableStatement, parent: KindBlock")
	payload := toolsPanicKey(frame, "Debug failure. False expression: Not a subspan. Child: KindPropertySignature, parent: KindTypeLiteral")
	if block != "crash:"+frame+":VariableStatement:Block" || payload != "crash:"+frame {
		t.Fatalf("distinct span defects share a pending key: block=%q payload=%q", block, payload)
	}
}
