# How to Restore Backup to reporting-postgres Container

## Quick Restore

### Step 1: List Available Backups
```bash
cd reporting-service
ls -lh backups/
```

### Step 2: Restore Using Script
```bash
./scripts/export-import-db.sh restore-local backups/reporting_db_backup_YYYYMMDD_HHMMSS.sql
```

**Example:**
```bash
./scripts/export-import-db.sh restore-local backups/reporting_db_backup_20241215_143022.sql
```

## Manual Restore (Docker)

If you prefer to restore manually:

### Option 1: Restore via Docker exec
```bash
# Make sure container is running
docker ps | grep reporting-postgres

# Restore the backup
docker exec -i reporting-postgres psql -U reports_admin -d postgres \
  backup/reporting_db_backup_20251221_093749.sql
```

### Option 2: Copy file to container and restore
```bash
# Copy backup file to container
docker cp backups/reporting_db_backup_YYYYMMDD_HHMMSS.sql reporting-postgres:/tmp/backup.sql

# Restore inside container
docker exec reporting-postgres psql -U reports_admin -d postgres -f /tmp/backup.sql

# Clean up
docker exec reporting-postgres rm /tmp/backup.sql
```

## Verify Restore

After restoring, verify the data:

```bash
# Connect to database
docker exec -it reporting-postgres psql -U reports_admin -d reporting_db

# Check tables
\dt

# Check row counts
SELECT COUNT(*) FROM your_table_name;

# Exit
\q
```

## Troubleshooting

### Container Not Running
```bash
# Start the container
cd reporting-service/postgres
docker-compose up -d

# Verify it's running
docker ps | grep reporting-postgres
```

### Database Already Exists Error
The backup includes `--clean --if-exists` flags, so it should handle existing databases. If you still get errors:

```bash
# Drop and recreate database manually
docker exec -it reporting-postgres psql -U reports_admin -d postgres -c "DROP DATABASE IF EXISTS reporting_db;"
docker exec -it reporting-postgres psql -U reports_admin -d postgres -c "CREATE DATABASE reporting_db;"

# Then restore
./scripts/export-import-db.sh restore-local backups/reporting_db_backup_YYYYMMDD_HHMMSS.sql
```

### Permission Denied
Make sure you're using the correct user (`reports_admin`) and the container has proper permissions.

## Complete Example

```bash
# 1. Navigate to service directory
cd reporting-service

# 2. Check available backups
ls -lh backups/

# 3. Verify container is running
docker ps | grep reporting-postgres

# 4. Restore backup
./scripts/export-import-db.sh restore-local backups/reporting_db_backup_20241215_143022.sql

# 5. Verify restore
docker exec -it reporting-postgres psql -U reports_admin -d reporting_db -c "\dt"
```

