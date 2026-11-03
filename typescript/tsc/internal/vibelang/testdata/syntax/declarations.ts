class Gone extends TaggedError("Gone")<{
    readonly id: string;
}> {
}
abstract class Users {
    abstract find(id: string): Effect.Effect<string, Gone, never>;
}
type Ticket = typeof Ticket.Type;
const Ticket = Schema.Struct({
    id: Schema.mutableKey(Schema.String), count: Schema.mutableKey(Schema.Number),
});
