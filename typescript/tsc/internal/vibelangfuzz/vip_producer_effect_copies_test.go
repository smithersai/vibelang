package vibelangfuzz

import "testing"

func TestVIPProducerEffectCopies(t *testing.T) {
	checkVIPEffectCopies(t, []string{"vip21.producer", "vip21.project-effect-instance"})
}
