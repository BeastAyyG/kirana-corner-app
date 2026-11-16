# AGENTS.md — working in this repo

Two agents share this repo: a **backend agent** and **Z code** (frontend). The coordination contract — file lanes, request channel, dev workflow, verification, git etiquette — is **[FRONTEND-HANDOFF.md](FRONTEND-HANDOFF.md). Read it first.**

## Lanes (summary)

- Backend: `src/**`, `test/**`, `scripts/**`, `docs/**`, infra files, `package.json`, `README.md`.
- Frontend (Z code): `public/**`, `tools/**`, new `apps/**`.
- Never edit outside your lane; request changes via `docs/FRONTEND-REQUESTS.md`. Stage only your lane's files when committing.

## Commands

```bash
npm run dev      # dev server, auto-restart, seeded demo data (Node ≥ 24, zero deps)
npm start        # production-style start (set NODE_ENV + secrets, see .env.example)
npm run check    # syntax check + full test suite — must pass before any commit
npm run smoke    # live end-to-end delivery lifecycle against a real server
npm run seed     # print DB counts + demo phones
npm run backup   # VACUUM INTO snapshots of both DBs (keeps 14)
```

## Map

- `src/v2/` — delivery platform (Blinkit/BigBasket-style): auth, catalogue, cart, orders, dispatch, payments, SSE, admin.
- `src/server.js` + v1 modules — original pickup API at `/api/v1`, serves `public/`.
- `docs/03-API-REFERENCE.md` — the API contract. `docs/05-APP-INTEGRATION-GUIDE.md` — screen→API maps.
- `data/` — SQLite files (gitignored). `backups/` — snapshots (gitignored).

## Rules

- No runtime dependencies without a documented decision; Node built-ins only.
- Money is integer paise; never float math.
- Feature branch, local commits, no push unless the user asks. Secret-scan before anything public.
- Never weaken a test to make it pass; fix the code or coordinate the invariant change.