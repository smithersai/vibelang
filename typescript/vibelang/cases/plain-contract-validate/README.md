# D282: A-1

Smithers twin finding A-1 wrote a synchronous validator that throws under a
plain annotation. Under D282 a plain function never fails, so the validator is
an Effect function whose throw is a typed failure. The plain-annotated form is
EK9203 (`plain-throw-escapes.fail`).
