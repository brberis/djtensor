#!/bin/sh

if [ "$DATABASE" = "postgres" ]
then
    echo "Waiting for postgres..."
    echo "SQL_HOST=$SQL_HOST"
    echo "SQL_PORT=$SQL_PORT"
    echo "SQL_USER=$SQL_USER"
    echo "SQL_DATABASE=$SQL_DATABASE"

    while ! nc -z $SQL_HOST $SQL_PORT; do
      sleep 0.1
    done

    echo "PostgreSQL started"

    # Create the database if it doesn't exist
    PGPASSWORD=$SQL_PASSWORD psql -h $SQL_HOST -U $SQL_USER -d postgres -tc "SELECT 1 FROM pg_database WHERE datname = '$SQL_DATABASE'" | grep -q 1 || \
    PGPASSWORD=$SQL_PASSWORD psql -h $SQL_HOST -U $SQL_USER -d postgres -c "CREATE DATABASE $SQL_DATABASE"
fi

exec "$@"
