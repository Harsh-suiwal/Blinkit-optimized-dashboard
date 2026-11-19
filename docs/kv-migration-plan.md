# Persistence plan: Supabase key-value store

Problem: Render wipes data/*.json on every deploy. Blinkit Excel columns keep changing, so I don't want to design relational tables yet.
Idea: keep the existing JSON shapes, store each JSON document as one row in Supabase.

1. db/schema.sql: kv_store(key text primary key, value jsonb not null, updated_at timestamptz default now()).
2. store/kv.js:
   - async init(): load all rows into an in-memory Map. If it fails, throw so the server exits. Never start with an empty Map.
   - get(key, default): sync, returns structuredClone of the cached value.
   - async set(key, value): upsert to Supabase FIRST, update the Map only on success. Serialize per key.
   - async delete(key).
3. Keys: latest, history, salesLatest, salesByProduct, salesHistory, campaignData, brandAliases.
   Replace every fs read/write/unlink/exists of data/*.json in server.js, parser/snapshotHistory.js, parser/salesHistory.js, parser/campaignStore.js, parser/brandResolver.js.
4. All mutating routes (upload, delete, restore, clear, brand-alias) become async, await the writes, return 500 on failure.
5. Remove the campaignData.v1.json legacy rename logic.
6. scripts/migrate-json-to-kv.js: one-time upload of local data/*.json. Warn if kv_store already has rows.
7. Audit every place that mutates rows returned from a load function.
8. await kv.init() before app.listen.
9. Update README + AGENTS.md.

Known limits: single server instance only. Whole document is rewritten on each save. No SQL querying of contents.