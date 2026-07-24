# Shared Postgres infra

This service's `docker-compose.yml` **owns** the `reporting-postgres` container (image `postgres:16`,
port 5432, `reporting_db` database). `audit-service` and `communication-service` connect to that same
container as clients, each with its own separate database (`audit_db`, etc.) on the shared instance —
this is not cross-database access across service boundaries, since each service still owns a distinct
database, not another service's tables.

If you change this container's config, credentials, or startup order, check `audit-service`'s and
`communication-service`'s compose files too — they explicitly document "start `reporting-postgres`
first" as a startup dependency; if either fails to connect on boot in local/VM setups, check that
`reporting-postgres` is up first.

`RUN_REPORTING_MIGRATIONS=true` and `ENABLE_REPORTING_CRON=true` are set in this compose file, so
both run automatically in staging — `npm run migrate` is normally only needed manually for local dev.
