// Test-only stand-in for the Workers runtime module (vitest runs in Node).
export class DurableObject<Env = unknown> {
  constructor(public ctx: unknown, public env: Env) {}
}
