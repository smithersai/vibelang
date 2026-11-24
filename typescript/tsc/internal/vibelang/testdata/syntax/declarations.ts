class Gone extends TaggedError("Gone")<{
    readonly id: string;
}> {
    static {
        $schemaErrorMatcher(this, "Gone", true);
    }
}
class Invalid extends Schema.TaggedError<Invalid>()("Invalid", {
    reason: Schema.String,
}) {
    static {
        $schemaErrorMatcher(this, "Invalid");
    }
}
type Role = typeof Role.Type;
const Role = Schema.Literals(["admin", "member"]);
type Ticket = typeof Ticket.Type;
const Ticket = Schema.Struct({
    id: Schema.mutableKey(Schema.String), label: Schema.mutableKey(Schema.optional(Schema.String)), role: Schema.mutableKey(Role),
});
const Delivery = Data.taggedEnum<Delivery>();
type Delivery = Data.TaggedEnum<{
    Waiting: {};
    Sent: {
        readonly tracking: string;
    };
}>;
