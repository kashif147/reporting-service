#!/bin/bash

# PostgreSQL Database Export/Import Script
# Exports from local and imports to staging

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Local database configuration (from docker-compose.yml)
LOCAL_HOST="localhost"
LOCAL_PORT="5432"
LOCAL_DB="reporting_db"
LOCAL_USER="reports_admin"
LOCAL_PASSWORD="Letme1nplz!"
LOCAL_CONTAINER="reporting-postgres"

# Check if PostgreSQL tools are available, otherwise use Docker
USE_DOCKER=false
if ! command -v pg_dump &> /dev/null || ! command -v psql &> /dev/null; then
    USE_DOCKER=true
fi

# Staging database configuration (update these with your staging credentials)
STAGING_HOST="${STAGING_DB_HOST:-your-staging-host}"
STAGING_PORT="${STAGING_DB_PORT:-5432}"
STAGING_DB="${STAGING_DB_NAME:-reporting_db}"
STAGING_USER="${STAGING_DB_USER:-reporting_user}"
STAGING_PASSWORD="${STAGING_DB_PASSWORD}"

# Backup file
BACKUP_FILE="reporting_db_backup_$(date +%Y%m%d_%H%M%S).sql"
BACKUP_DIR="./backups"

# Create backups directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

echo -e "${GREEN}=== PostgreSQL Database Export/Import Tool ===${NC}\n"

# Function to export database (schema + data)
export_database() {
    echo -e "${YELLOW}Exporting database (schema + data) from local environment...${NC}"
    
    if [ "$USE_DOCKER" = true ]; then
        echo -e "${YELLOW}Using Docker container (pg_dump not found locally)...${NC}"
        # Check if container is running
        if ! docker ps --format '{{.Names}}' | grep -q "^${LOCAL_CONTAINER}$"; then
            echo -e "${RED}✗ Docker container '$LOCAL_CONTAINER' is not running${NC}"
            echo -e "${YELLOW}Start it with: docker-compose up -d${NC}"
            return 1
        fi
        
        # Export using Docker
        docker exec "$LOCAL_CONTAINER" pg_dump -U "$LOCAL_USER" -d "$LOCAL_DB" \
            --clean --if-exists --create --format=plain \
            > "$BACKUP_DIR/$BACKUP_FILE"
    else
        # Export using local pg_dump
        export PGPASSWORD="$LOCAL_PASSWORD"
        pg_dump -h "$LOCAL_HOST" -p "$LOCAL_PORT" -U "$LOCAL_USER" -d "$LOCAL_DB" \
            --clean --if-exists --create --format=plain \
            --file="$BACKUP_DIR/$BACKUP_FILE"
        unset PGPASSWORD
    fi
    
    if [ $? -eq 0 ] && [ -f "$BACKUP_DIR/$BACKUP_FILE" ]; then
        echo -e "${GREEN}✓ Export successful: $BACKUP_DIR/$BACKUP_FILE${NC}"
        echo -e "${GREEN}File size: $(du -h "$BACKUP_DIR/$BACKUP_FILE" | cut -f1)${NC}\n"
        return 0
    else
        echo -e "${RED}✗ Export failed${NC}"
        return 1
    fi
}

# Function to import database
import_database() {
    echo -e "${YELLOW}Importing database to staging environment...${NC}"
    
    if [ -z "$STAGING_PASSWORD" ]; then
        echo -e "${RED}✗ STAGING_DB_PASSWORD environment variable is not set${NC}"
        echo -e "${YELLOW}Please set it: export STAGING_DB_PASSWORD='your-password'${NC}"
        return 1
    fi
    
    export PGPASSWORD="$STAGING_PASSWORD"
    psql -h "$STAGING_HOST" -p "$STAGING_PORT" -U "$STAGING_USER" -d postgres \
        -f "$BACKUP_DIR/$BACKUP_FILE"
    
    unset PGPASSWORD
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ Import successful${NC}\n"
        return 0
    else
        echo -e "${RED}✗ Import failed${NC}"
        return 1
    fi
}

# Function to export only data (no schema)
export_data_only() {
    echo -e "${YELLOW}Exporting data only from local environment...${NC}"
    
    DATA_FILE="${BACKUP_FILE%.sql}_data_only.sql"
    
    if [ "$USE_DOCKER" = true ]; then
        # Check if container is running
        if ! docker ps --format '{{.Names}}' | grep -q "^${LOCAL_CONTAINER}$"; then
            echo -e "${RED}✗ Docker container '$LOCAL_CONTAINER' is not running${NC}"
            return 1
        fi
        
        # Export using Docker
        docker exec "$LOCAL_CONTAINER" pg_dump -U "$LOCAL_USER" -d "$LOCAL_DB" \
            --data-only --format=plain \
            > "$BACKUP_DIR/$DATA_FILE"
    else
        # Export using local pg_dump
        export PGPASSWORD="$LOCAL_PASSWORD"
        pg_dump -h "$LOCAL_HOST" -p "$LOCAL_PORT" -U "$LOCAL_USER" -d "$LOCAL_DB" \
            --data-only --format=plain \
            --file="$BACKUP_DIR/$DATA_FILE"
        unset PGPASSWORD
    fi
    
    if [ $? -eq 0 ] && [ -f "$BACKUP_DIR/$DATA_FILE" ]; then
        echo -e "${GREEN}✓ Data export successful: $BACKUP_DIR/$DATA_FILE${NC}\n"
        return 0
    else
        echo -e "${RED}✗ Data export failed${NC}"
        return 1
    fi
}

# Function to import only data
import_data_only() {
    echo -e "${YELLOW}Importing data only to staging environment...${NC}"
    
    DATA_FILE="${BACKUP_FILE%.sql}_data_only.sql"
    
    if [ -z "$STAGING_PASSWORD" ]; then
        echo -e "${RED}✗ STAGING_DB_PASSWORD environment variable is not set${NC}"
        return 1
    fi
    
    export PGPASSWORD="$STAGING_PASSWORD"
    psql -h "$STAGING_HOST" -p "$STAGING_PORT" -U "$STAGING_USER" -d "$STAGING_DB" \
        -f "$BACKUP_DIR/$DATA_FILE"
    
    unset PGPASSWORD
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ Data import successful${NC}\n"
        return 0
    else
        echo -e "${RED}✗ Data import failed${NC}"
        return 1
    fi
}

# Function to restore to local database
restore_local() {
    echo -e "${YELLOW}Restoring database to local environment (reporting-postgres container)...${NC}"
    
    if [ -z "$2" ]; then
        echo -e "${RED}Please provide backup file path${NC}"
        echo "Usage: $0 restore-local <backup_file.sql>"
        exit 1
    fi
    
    RESTORE_FILE="$2"
    
    if [ ! -f "$RESTORE_FILE" ]; then
        echo -e "${RED}✗ Backup file not found: $RESTORE_FILE${NC}"
        return 1
    fi
    
    if [ "$USE_DOCKER" = true ]; then
        echo -e "${YELLOW}Using Docker container (psql not found locally)...${NC}"
        # Check if container is running
        if ! docker ps --format '{{.Names}}' | grep -q "^${LOCAL_CONTAINER}$"; then
            echo -e "${RED}✗ Docker container '$LOCAL_CONTAINER' is not running${NC}"
            echo -e "${YELLOW}Start it with: cd postgres && docker-compose up -d${NC}"
            return 1
        fi
        
        # Restore using Docker - connect to postgres db to allow CREATE DATABASE
        echo -e "${YELLOW}Restoring to reporting-postgres container...${NC}"
        docker exec -i "$LOCAL_CONTAINER" psql -U "$LOCAL_USER" -d postgres \
            < "$RESTORE_FILE"
    else
        # Restore using local psql
        export PGPASSWORD="$LOCAL_PASSWORD"
        psql -h "$LOCAL_HOST" -p "$LOCAL_PORT" -U "$LOCAL_USER" -d postgres \
            -f "$RESTORE_FILE"
        unset PGPASSWORD
    fi
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ Restore successful to reporting_db${NC}\n"
        return 0
    else
        echo -e "${RED}✗ Restore failed${NC}"
        return 1
    fi
}

# Main menu
case "${1:-menu}" in
    export)
        export_database
        ;;
    import)
        if [ -z "$2" ]; then
            echo -e "${RED}Please provide backup file path${NC}"
            echo "Usage: $0 import <backup_file.sql>"
            exit 1
        fi
        BACKUP_FILE=$(basename "$2")
        import_database
        ;;
    export-data)
        export_data_only
        ;;
    import-data)
        if [ -z "$2" ]; then
            echo -e "${RED}Please provide backup file path${NC}"
            echo "Usage: $0 import-data <backup_file.sql>"
            exit 1
        fi
        BACKUP_FILE=$(basename "$2")
        import_data_only
        ;;
    full)
        export_database && import_database
        ;;
    restore-local)
        restore_local "$@"
        ;;
    *)
        echo "Usage: $0 {export|import|restore-local|export-data|import-data|full}"
        echo ""
        echo "Commands:"
        echo "  export              - Export database (schema + data) from local"
        echo "  import <file>       - Import database to staging"
        echo "  restore-local <file> - Restore database to local"
        echo "  export-data         - Export data only from local"
        echo "  import-data <file>  - Import data only to staging"
        echo "  full                - Export from local and import to staging"
        echo ""
        echo "Environment variables for staging:"
        echo "  STAGING_DB_HOST     - Staging database host"
        echo "  STAGING_DB_PORT     - Staging database port (default: 5432)"
        echo "  STAGING_DB_NAME     - Staging database name"
        echo "  STAGING_DB_USER     - Staging database user"
        echo "  STAGING_DB_PASSWORD - Staging database password"
        echo ""
        echo "Example:"
        echo "  export STAGING_DB_HOST=staging.example.com"
        echo "  export STAGING_DB_PASSWORD='your-password'"
        echo "  $0 full"
        ;;
esac

