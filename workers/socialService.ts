// =================================================================
// socialService — turns a device token and an address into hashes
// =================================================================
// Sits between the HTTP routes and SocialStore, inside the Durable
// Object. Raw device tokens and IP addresses stop here: they are hashed
// with a secret that lives in the store (created once, never changed)
// and only the hashes go any further.
// =================================================================

import { hashNetwork, hashVoter } from "./socialCore";
import type { ItemMeta, SocialStore } from "./socialStore";

const DAY = 86_400_000;

export class SocialService {
  private readonly pepper: string;

  constructor(
    private readonly store: SocialStore,
    seedPepper?: string,
  ) {
    this.pepper = store.pepper(seedPepper);
  }

  /** This network's hash for today and yesterday, so daily caps hold across midnight. */
  private async nets(ip: string, now: number): Promise<string[]> {
    return [await hashNetwork(ip, now, this.pepper), await hashNetwork(ip, now - DAY, this.pepper)];
  }

  summary() {
    return this.store.summary();
  }

  async thread(key: string, voter: string | null) {
    return this.store.thread(key, voter ? await hashVoter(voter, this.pepper) : null);
  }

  async vote(key: string, voter: string, ip: string, value: -1 | 0 | 1, meta: ItemMeta, now = Date.now()) {
    return this.store.vote(key, await hashVoter(voter, this.pepper), await this.nets(ip, now), value, meta, now);
  }

  async comment(key: string, voter: string, ip: string, name: string, body: string, meta: ItemMeta, now = Date.now()) {
    return this.store.comment(key, await hashVoter(voter, this.pepper), await this.nets(ip, now), name, body, meta, now);
  }

  async report(commentId: string, voter: string, ip: string, now = Date.now()) {
    return this.store.report(commentId, await hashVoter(voter, this.pepper), await this.nets(ip, now), now);
  }

  async deleteOwn(commentId: string, voter: string) {
    return this.store.deleteOwn(commentId, await hashVoter(voter, this.pepper));
  }
}
