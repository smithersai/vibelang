package vibelang

// EK4838 is retained for persisted editor diagnostics and severity settings.
// VIP-17 permits ordinary Fiber handles to flow through returns, storage,
// calls and captures; the compiler no longer emits a lexical escape error.
var EK4838 = message(4838, errorCategory, "This fiber is owned by {0}, which interrupts it on exit, but it is {1}.")

func init() {
	registry[EK4838.Code] = EK4838
}
