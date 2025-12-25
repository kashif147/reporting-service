# PostgreSQL Backup and Restore Guide

## Quick Start

### Step 1: Take a Backup

```bash
cd reporting-service
./scripts/export-import-db.sh export
```

This creates a backup file in `backups/` directory with timestamp:

- Example: `backups/reporting_db_backup_20241215_143022.sql`

### Step 2: Restore the Backup

#### Option A: Restore to Local Database

```bash
# Restore to local database using script
./scripts/export-import-db.sh restore-local backups/reporting_db_backup_20241215_143022.sql

# Or manually
PGPASSWORD='Letme1nplz!' psql -h localhost -p 5432 -U reports_admin -d postgres \
  -f backups/reporting_db_backup_20241215_143022.sql
```

#### Option B: Restore to Staging Database

```bash
# Set staging credentials
export STAGING_DB_HOST="your-staging-host"
export STAGING_DB_PASSWORD="your-password"

# Restore using script
./scripts/export-import-db.sh import backups/reporting_db_backup_20241215_143022.sql
```

## Detailed Examples

### Backup Examples

#### 1. Simple Backup (Schema + Data)

```bash
cd reporting-service
./scripts/export-import-db.sh export
```

#### 2. Manual Backup Command

```bash
PGPASSWORD='Letme1nplz!' pg_dump -h localhost -p 5432 -U reports_admin -d reporting_db \
  --clean --if-exists --create --format=plain \
  -f my_backup.sql
```

#### 3. Backup from Docker Container

```bash
docker exec reporting-postgres pg_dump -U reports_admin -d reporting_db \
  --clean --if-exists --create --format=plain > backup.sql
```

#### 4. Compressed Backup (for large databases)

```bash
PGPASSWORD='Letme1nplz!' pg_dump -h localhost -p 5432 -U reports_admin -d reporting_db \
  --format=custom -f backup.dump
```

### Restore Examples

#### 1. Restore to Local Database (Plain SQL)

```bash
PGPASSWORD='Letme1nplz!' psql -h localhost -p 5432 -U reports_admin -d postgres \
  -f backups/reporting_db_backup_20241215_143022.sql
```

#### 2. Restore to Staging Database

```bash
# Set environment variables
export STAGING_DB_HOST="staging.example.com"
export STAGING_DB_PORT="5432"
export STAGING_DB_NAME="reporting_db"
export STAGING_DB_USER="reporting_user"
export STAGING_DB_PASSWORD="your-password"

# Restore
./scripts/export-import-db.sh import backups/reporting_db_backup_20241215_143022.sql
```

#### 3. Restore to Docker Container

```bash
docker exec -i reporting-postgres psql -U reports_admin -d reporting_db < backup.sql
```

#### 4. Restore Compressed Backup

```bash
PGPASSWORD='Letme1nplz!' pg_restore -h localhost -p 5432 -U reports_admin \
  -d reporting_db --clean --if-exists backup.dump
```

## Complete Workflow

### Backup Local → Restore to Staging

```bash
# 1. Navigate to service directory
cd reporting-service

# 2. Take backup from local
./scripts/export-import-db.sh export

# 3. Set staging credentials
export STAGING_DB_HOST="staging.example.com"
export STAGING_DB_PASSWORD="staging-password"

# 4. Restore to staging
./scripts/export-import-db.sh import backups/reporting_db_backup_YYYYMMDD_HHMMSS.sql
```

### Backup Staging → Restore to Local

```bash
# 1. Backup from staging
export STAGING_DB_HOST="staging.example.com"
export STAGING_DB_PASSWORD="staging-password"
PGPASSWORD="$STAGING_DB_PASSWORD" pg_dump -h "$STAGING_DB_HOST" -p 5432 \
  -U reporting_user -d reporting_db --clean --if-exists --create \
  --format=plain -f staging_backup.sql

# 2. Restore to local
PGPASSWORD='Letme1nplz!' psql -h localhost -p 5432 -U reports_admin -d postgres \
  -f staging_backup.sql
```

## Common Scenarios

### Scenario 1: Backup Before Making Changes

```bash
# Create timestamped backup
./scripts/export-import-db.sh export

# Make your changes...

# If something goes wrong, restore:
PGPASSWORD='Letme1nplz!' psql -h localhost -p 5432 -U reports_admin -d postgres \
  -f backups/reporting_db_backup_YYYYMMDD_HHMMSS.sql
```

### Scenario 2: Copy Local Data to Staging

```bash
# Export from local
./scripts/export-import-db.sh export

# Import to staging
export STAGING_DB_HOST="staging.example.com"
export STAGING_DB_PASSWORD="staging-password"
./scripts/export-import-db.sh import backups/reporting_db_backup_YYYYMMDD_HHMMSS.sql
```

### Scenario 3: Restore Specific Backup File

```bash
# List available backups
ls -lh backups/

# Restore specific file
./scripts/export-import-db.sh import backups/reporting_db_backup_20241215_143022.sql
```

## Troubleshooting

### Backup Issues

**Error: "connection refused"**

- Check if PostgreSQL is running: `docker ps` or `pg_isready`
- Verify port 5432 is accessible

**Error: "authentication failed"**

- Verify credentials in docker-compose.yml
- Check password is correct

### Restore Issues

**Error: "database already exists"**

- The script uses `--clean --if-exists` which should handle this
- If still failing, manually drop database first:

```bash
PGPASSWORD='Letme1nplz!' psql -h localhost -p 5432 -U reports_admin -d postgres \
  -c "DROP DATABASE IF EXISTS reporting_db;"
```

**Error: "permission denied"**

- Ensure user has CREATE DATABASE privilege
- For staging, verify user has necessary permissions

**Error: "relation already exists"**

- Use `--clean --if-exists` flag (already included in script)
- Or drop existing tables before restore

## File Locations

- **Backup files**: `reporting-service/backups/`
- **Script**: `reporting-service/scripts/export-import-db.sh`
- **Documentation**: `reporting-service/scripts/DB_EXPORT_IMPORT.md`

## Quick Reference

| Action            | Command                                                  |
| ----------------- | -------------------------------------------------------- |
| Backup            | `./scripts/export-import-db.sh export`                   |
| Restore (local)   | `./scripts/export-import-db.sh restore-local backup.sql` |
| Restore (staging) | `./scripts/export-import-db.sh import backup.sql`        |
| List backups      | `ls -lh backups/`                                        |
