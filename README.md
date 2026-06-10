# Plan obiadów - Flask + SQLite + Bun/DaisyUI

Wersja przygotowana pod VPS:

- Python 3 + Flask,
- SQLite przez SQLAlchemy ORM,
- Bun do budowania Tailwind/DaisyUI,
- role: administrator i kierowca,
- domyślna trasa kierowcy zapisywana na kolejne dni.

## Lokalnie

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

bun install
bun run build:css

export SECRET_KEY="zmien-na-losowy-sekret"
flask --app app run --host 0.0.0.0 --port 5000
```

Wejdź na:

```text
http://localhost:5000
```

Konta startowe:

- `admin` / `admin123`
- `kierowca1` / `kierowca123`
- `kierowca2` / `kierowca123`
- `kierowca3` / `kierowca123`

## Dane

Domyślna baza:

```text
instance/obiady.sqlite3
```

Możesz wskazać inną lokalizację:

```bash
export OBIADY_DB="/var/lib/obiady/obiady.sqlite3"
```

## Gunicorn

```bash
gunicorn -w 2 -b 127.0.0.1:5000 wsgi:app
```

## Przykładowy systemd

`/etc/systemd/system/obiady.service`

```ini
[Unit]
Description=Plan obiadow Flask
After=network.target

[Service]
User=www-data
Group=www-data
WorkingDirectory=/var/www/obiady
Environment="SECRET_KEY=tu_wstaw_dlugi_losowy_sekret"
Environment="OBIADY_DB=/var/lib/obiady/obiady.sqlite3"
ExecStart=/var/www/obiady/.venv/bin/gunicorn -w 2 -b 127.0.0.1:5000 wsgi:app
Restart=always

[Install]
WantedBy=multi-user.target
```

## Przykładowy Nginx

```nginx
server {
    server_name zamowienia.twojadomena.pl;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Potem HTTPS:

```bash
certbot --nginx -d zamowienia.twojadomena.pl
```

## Ważne przed produkcją

- zmień hasła startowe,
- ustaw mocny `SECRET_KEY`,
- rób kopie pliku SQLite,
- po testach warto dodać ekran zarządzania kontami kierowców.
