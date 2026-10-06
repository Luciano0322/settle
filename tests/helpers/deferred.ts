export type Deferred<Value> = {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value | PromiseLike<Value>) => void;
  readonly reject: (reason?: unknown) => void;
};

export function deferred<Value>(): Deferred<Value> {
  let resolve!: Deferred<Value>["resolve"];
  let reject!: Deferred<Value>["reject"];

  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}
