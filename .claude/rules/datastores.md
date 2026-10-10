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

## Data owned by other services: HTTP only

reporting-service never connects to another service's MongoDB. Work-location hierarchy and
officer display fields (`reports.membership_location_lookup`) come from user-service via
`lib/userServiceClient.js` (`GET /api/lookuptype`, `GET /api/lookup/by-type/:id/hierarchy`),
forwarding the caller's identity, with rows written only under the caller's trusted
`req.tenantId` (`services/locationLookupSync.service.js`). `USER_SERVICE_MONGO_URI` is no
longer read anywhere; base URL is `USER_SERVICE_URL` (falls back to `POLICY_SERVICE_URL`).
Operator scripts (`scripts/sync-location-lookups.js`, `scripts/seedMembershipDashboard.js`)
use `OPERATOR_BEARER_TOKEN` (see `scripts/lib/operatorRequest.js`). Lookups are still
platform-global inside user-service — per-tenant lookups are a separate user-service change.
