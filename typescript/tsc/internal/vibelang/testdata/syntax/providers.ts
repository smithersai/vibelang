abstract class Users {
    abstract find(id: string): Effect.Effect<string, never, never>;
}
const users = { find(id: string) { return id; } };
const live = Layer.effect(Users, () => { return users; });
const fallback = Layer.succeed(Users, users);
function read() {
    {
        [live, $provideService(Users, "Users", users)];
        return ($try(Users)).find("1");
    }
}
