# A plain function runs no Effect

A function not marked `effect` is plain JavaScript (VIP-1): calling
`Effect.succeed(1)` there builds an Effect and runs nothing, so a statement
that discards it is EK4801. Before VIP-1 a plain return annotation made this
EK9203 (D263).
