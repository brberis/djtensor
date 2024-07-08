#!/bin/sh

if [ "$DATABASE" = "postgres" ]
then
    echo "Waiting for postgres..."

    while ! nc -z $SQL_HOST $SQL_PORT; do
      sleep 0.1
    done

    echo "PostgreSQL started"

    # Create the database if it doesn't exist
    psql -h $SQL_HOST -U $SQL_USER -tc "SELECT 1 FROM pg_database WHERE datname = '$SQL_DATABASE'" | grep -q 1 || \
    psql -h $SQL_HOST -U $SQL_USER -c "CREATE DATABASE $SQL_DATABASE"
fi

exec "$@"
