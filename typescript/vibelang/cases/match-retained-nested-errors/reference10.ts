import * as M from "effect/graphql/GraphQLClientError"
export function witness(){
const copy={_tag:"GraphQLClientError", ["~effect/graphql/GraphQLClientError"]:"~effect/graphql/GraphQLClientError"};
if(!M.isGraphQLClientError(copy))throw new Error("tagged-error fixture lacks its brand");
const subjects=[copy,{_tag:"GraphQLClientError"},null,{}];
return subjects.map(s=>[M.isGraphQLClientError(s),M.isGraphQLClientError(s),false,false]);
}
export function narrow(s:unknown){return M.isGraphQLClientError(s)?s._tag:undefined;}
