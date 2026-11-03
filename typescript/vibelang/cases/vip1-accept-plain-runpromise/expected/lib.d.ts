export declare const render: {
    /** @throws {never} */
    (): Promise<number>;
};
export declare const renderPage: {
    /** @throws {never} */
    (request: {
        readonly path: string;
    }): Promise<string>;
};
