# Worker deployment environments (LOOM-449)

| Environment | Host | Story KV | GitHub feedback token |
|-------------|------|----------|------------------------|
| Production | `loom.ibm.io` | `STORIES` binding (production namespace) | Production secret |
| Preview / `workers.dev` | `*.workers.dev` | Must use preview namespace only | Must not use production token |

Policy:

1. Preview deploys (`wrangler deploy --env preview` or dry-run) must not write production story IDs.
2. Handoff URLs in product copy always use `https://loom.ibm.io`.
3. CI runs `npm run deploy:dry` without production credentials.

Configure separate namespaces in `wrangler.jsonc` before enabling automated preview uploads.
