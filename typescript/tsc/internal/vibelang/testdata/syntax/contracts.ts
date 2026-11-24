class Gone extends TaggedError("Gone")<{}> {
    static {
        $schemaErrorMatcher(this, "Gone", true);
    }
}
abstract class Users {
    abstract find(id: string): Effect.Effect<string, Gone, never>;
}
function read(id: string): Effect.Effect<string, Gone, Users> { return ($try(Users)).find(id); }
type Program = Effect.Effect<number, never, never>;
type Errors = Effect.Effect<string, Gone, never>;
type Requirements = Effect.Effect<boolean, never, Users>;
