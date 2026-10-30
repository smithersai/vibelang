import { type User } from "./User.js";
declare module "./User.js" {
    interface User {
        nick?: string;
    }
}
export declare const nick: (user: User) => string;
export declare const label: string;
