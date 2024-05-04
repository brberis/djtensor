# djtensor

.env.deb example:

DEBUG=1
SECRET_KEY=<DJANGO SECRET>
DJANGO_ALLOWED_HOSTS=localhost web 127.0.0.1 [::1]
NEXT_PUBLIC_API_BASE_URL=http://frontend:3000
DJANGO_API_BASE_URL=http://web:8000
SQL_ENGINE=django.db.backends.postgresql
SQL_DATABASE=backend_dev
SQL_USER=backend
SQL_PASSWORD=backend
SQL_HOST=db
SQL_PORT=5432
DATABASE=postgres