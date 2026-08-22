import { Codec, Json, JsonSchema, Schema } from "../../src/schema/index.ts";

const User = Schema.struct({
  id: Schema.number,
  name: Schema.string,
  nickname: Schema.optional(Schema.string),
  roles: Schema.array(Schema.union(Schema.literal("admin"), Schema.literal("member"))),
  metadata: Schema.record(Schema.string),
}).describe("User");

const input: unknown = {
  id: 7,
  name: "Ada",
  roles: ["admin"],
  metadata: { team: "compiler" },
};

const parsed = User.parse(input);
const json = parsed.andThen((user) => Json.stringify(user));

const UserWire = Codec.struct({
  id: Codec.number,
  name: Codec.string,
  roles: Codec.array(Codec.union(Codec.literal("admin"), Codec.literal("member"))),
  metadata: Codec.struct({ team: Codec.string }),
});

console.log("parsed", parsed.unwrap());
console.log("json", json.unwrap());
console.log("codec law", Codec.checkRoundTrip(UserWire, [{
  id: 7,
  name: "Ada",
  roles: ["admin"],
  metadata: { team: "compiler" },
}]).isNone());
console.log("json schema", JsonSchema.fromSchema(User));
