package vibelangfuzz

import (
	"testing"
)

var retiredRuntimeFactoryKeys = []string{"named", "alias", "namespace", "namespace-keep", "disabled", "both", "optional-spread", "comments", "run-yield", "run-interrupt"}

func TestRetiredRuntimeFactoryQuoted(t *testing.T) { nativeFactoryPhaseQuoted(t) }
