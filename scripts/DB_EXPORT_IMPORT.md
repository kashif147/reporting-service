# PostgreSQL Database Export/Import Guide

## Quick Commands

### Export from Local (Schema + Data)

```bash
# Using pg_dump - exports both schema and data by default
PGPASSWORD='Letme1nplz!' pg_dump -h localhost -p 5432 -U reports_admin -d reporting_db \
  --clean --if-exists --create --format=plain \
  -f reporting_db_backup.sql

# Or using the script (exports schema + data)
./scripts/export-import-db.sh export
```

### Export Data Only (No Schema)

```bash
PGPASSWORD='Letme1nplz!' pg_dump -h localhost -p 5432 -U reports_admin -d reporting_db \
  --data-only --format=plain \
  -f reporting_db_data_only.sql

# Or using the script
./scripts/export-import-db.sh export-data
```

### Import to Staging (Schema + Data)

```bash
# Set staging credentials
export STAGING_DB_HOST="your-staging-host"
export STAGING_DB_PORT="5432"
export STAGING_DB_NAME="reporting_db"
export STAGING_DB_USER="reporting_user"
export STAGING_DB_PASSWORD="your-staging-password"

# Import
PGPASSWORD="$STAGING_DB_PASSWORD" psql -h "$STAGING_DB_HOST" -p "$STAGING_DB_PORT" \
  -U "$STAGING_DB_USER" -d postgres -f reporting_db_backup.sql

# Or using the script
./scripts/export-import-db.sh import reporting_db_backup.sql
```

### Import Data Only

```bash
PGPASSWORD="$STAGING_DB_PASSWORD" psql -h "$STAGING_DB_HOST" -p "$STAGING_DB_PORT" \
  -U "$STAGING_DB_USER" -d reporting_db -f reporting_db_data_only.sql

# Or using the script
./scripts/export-import-db.sh import-data reporting_db_data_only.sql
```

## Using Docker

If your local database is running in Docker:

### Export from Docker Container

```bash
docker exec reporting-postgres pg_dump -U reports_admin -d reporting_db \
  --clean --if-exists --create --format=plain > reporting_db_backup.sql
```

### Import to Docker Container (Staging)

```bash
docker exec -i reporting-postgres psql -U reporting_user -d reporting_db < reporting_db_backup.sql
```

## Custom Format (Compressed)

For larger databases, use custom format for compression:

### Export (Custom Format)

```bash
PGPASSWORD='Letme1nplz!' pg_dump -h localhost -p 5432 -U reports_admin -d reporting_db \
  --format=custom -f reporting_db_backup.dump
```

### Import (Custom Format)

```bash
PGPASSWORD="$STAGING_DB_PASSWORD" pg_restore -h "$STAGING_DB_HOST" -p "$STAGING_DB_PORT" \
  -U "$STAGING_DB_USER" -d reporting_db --clean --if-exists reporting_db_backup.dump
```

## Important Notes

1. **Backup First**: Always backup staging database before importing
2. **Connection**: Ensure you can connect to staging database (firewall, VPN, etc.)
3. **Permissions**: User must have CREATE DATABASE privilege for full import
4. **Data Only**: Use `--data-only` if schema already exists in staging
5. **Clean Import**: Use `--clean --if-exists` to drop existing objects before import

## Troubleshooting

- **Connection refused**: Check if database is accessible and port is open
- **Authentication failed**: Verify credentials
- **Permission denied**: Check user privileges
- **Database exists**: Use `--clean --if-exists` or drop database first
