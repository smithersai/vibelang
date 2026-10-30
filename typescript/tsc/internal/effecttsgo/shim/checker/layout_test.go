package checker

import (
	"reflect"
	"testing"
	"unsafe"

	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// The shim accesses private Checker fields through unsafe.Pointer. Check every
// field, including fields without an accessor: one missing slot shifts the rest.
func TestCheckerLayout(t *testing.T) {
	actual := reflect.TypeFor[checker.Checker]()
	mirror := reflect.TypeFor[extra_Checker]()
	for i := 0; i < actual.NumField(); i++ {
		field := actual.Field(i)
		if i >= mirror.NumField() {
			t.Fatalf("Checker.%s: missing mirror field at index %d", field.Name, i)
		}
		mirrored := mirror.Field(i)
		if mirrored.Name != field.Name {
			t.Fatalf("Checker.%s: mirror field %d is %s", field.Name, i, mirrored.Name)
		}
		if mirrored.Offset != field.Offset || mirrored.Type.Size() != field.Type.Size() || mirrored.Type.Align() != field.Type.Align() {
			t.Fatalf("Checker.%s: mirror offset/size/align %d/%d/%d, checker %d/%d/%d",
				field.Name, mirrored.Offset, mirrored.Type.Size(), mirrored.Type.Align(),
				field.Offset, field.Type.Size(), field.Type.Align())
		}
	}
	if mirror.NumField() != actual.NumField() {
		t.Fatalf("Checker.%s: unexpected mirror field", mirror.Field(actual.NumField()).Name)
	}
	if unsafe.Sizeof(extra_Checker{}) != unsafe.Sizeof(checker.Checker{}) {
		t.Fatalf("Checker size: mirror %d, checker %d", unsafe.Sizeof(extra_Checker{}), unsafe.Sizeof(checker.Checker{}))
	}
}
