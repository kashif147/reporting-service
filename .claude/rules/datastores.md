# Two datastores, two different reliability contracts

- **Postgres (`reporting_db`) is the primary store and is required** — `db/postgres.js` sets
  `search_path TO reports, public` on every connection; nearly everything (ingestion, dashboard,
  listing, analytics) reads/writes here via the `repositories/*.js` layer.
- **MongoDB is optional and only backs one feature: grid filter/column Save-View templates**
  (`models/template.model.js`, `services/grid.filter.template.service.js`, same Save-View convention
  used platform-wide — see the `template-filters-columns` skill). `middlewares/requireMongo.js`
  gates those routes specifically and returns `503` if `MONGO_URI` isn't set or unreachable —
  startup (`bin/reporting-service.js`) deliberately does **not** fail if Mongo is down
  (`REQUIRE_REPORTING_MONGO=true` is the opt-in to make it fatal); the rest of the service (all
  reporting/dashboard APIs) keeps working in that case. Don't assume Mongo availability anywhere
  outside the grid-template code path — check `requireMongo.js` gates the route before adding a new
  Mongo-backed feature elsewhere.

This service's own `Template` model covers its own reporting/dashboard grids only — the Membership
Listing report's Save View templates are owned by profile-service, not here (reporting-service only
supplies the underlying listing data). See `TEMPLATE_IMPLEMENTATION_PLAYBOOK.md` at the repo root
for the full per-grid ownership map before adding a new `Template`-model route here.
