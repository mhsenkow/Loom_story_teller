// =================================================================
// SocialHub — Durable Object that owns community votes and comments
// =================================================================
// One SQLite-backed instance ("social-v1") keeps counts consistent: a
// vote, its tally and its rate-limit record are written in one atomic
// step. Reads that everyone shares (the summary) are edge-cached by the
// route for ~20 s, and writes are rate-limited, so a single instance has
// plenty of headroom. If it ever runs hot, shard writes by source kind
// with getByName(`social-v1:${kind}`) and merge summaries in the route.
//
// Device tokens and addresses arrive raw over RPC and are hashed here
// (socialService) with a secret kept in this object's own storage.
// =================================================================

import { DurableObject } from "cloudflare:workers";
import { SocialService } from "./socialService";
import { SocialStore, type ItemMeta, type SqlLike } from "./socialStore";

export class SocialHub extends DurableObject<Record<string, unknown>> {
  private service!: SocialService;

  constructor(ctx: DurableObjectState, env: Record<string, unknown>) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      // SqlStorage matches SqlLike at runtime; its generic row typing is just narrower.
      const store = new SocialStore(ctx.storage.sql as unknown as SqlLike);
      // An optional SOCIAL_PEPPER secret seeds the hash secret the first time only.
      this.service = new SocialService(store, typeof env.SOCIAL_PEPPER === "string" ? env.SOCIAL_PEPPER : undefined);
    });
  }

  summary() {
    return this.service.summary();
  }

  thread(key: string, voter: string | null) {
    return this.service.thread(key, voter);
  }

  vote(key: string, voter: string, ip: string, value: -1 | 0 | 1, meta: ItemMeta) {
    return this.service.vote(key, voter, ip, value, meta);
  }

  comment(key: string, voter: string, ip: string, name: string, body: string, meta: ItemMeta) {
    return this.service.comment(key, voter, ip, name, body, meta);
  }

  report(commentId: string, voter: string, ip: string) {
    return this.service.report(commentId, voter, ip);
  }

  deleteOwn(commentId: string, voter: string) {
    return this.service.deleteOwn(commentId, voter);
  }
}
