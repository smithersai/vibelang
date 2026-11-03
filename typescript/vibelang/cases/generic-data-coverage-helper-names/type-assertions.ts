// VIP-28: the public data unions and constructors have native Effect types.
const outcome:Exact<V.Outcome<string,number,boolean,bigint>,R.Outcome<string,number,boolean,bigint>>=true
const box:Exact<V.Box<string>,R.Box<string>>=true
const constructors:Exact<typeof V.Outcome,typeof R.Outcome>=true
