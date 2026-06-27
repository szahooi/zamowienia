from __future__ import annotations

import csv
import io
import re
from datetime import date, datetime
from decimal import Decimal
import unicodedata

from flask import Blueprint, jsonify, redirect, render_template, request, url_for
from sqlalchemy import inspect, text


SEED_ORDERS = [
    {"order_no": "ZAM/2026/000", "created": "2026-05-24", "client": "www www", "phone": "000 000 000", "order_type": "Abonament obiadowy", "subscription": "Zestaw", "period": "PrĂłbny 5 dni", "payment_method": "GotĂłwka przy odbiorze", "start_date": "2026-05-25", "portions": 2, "address": "ulica 11, miasto", "notes": "ZadzwoniÄ‡ jeĹ›li problem z dojazdem"},
    ]

SEED_PRICES = [
    ("Zestaw - GĹ‚uszyca, Jedlina", 24), ("Zupa - GĹ‚uszyca, Jedlina", 10), ("II danie - GĹ‚uszyca, Jedlina", 19),
    ("Zestaw - Nowa Ruda, WaĹ‚brzych", 27), ("Zupa - Nowa Ruda, WaĹ‚brzych", 11.5), ("II danie - Nowa Ruda, WaĹ‚brzych", 22),
    ("Zestaw - Jugowice, Walim", 25), ("Zupa - Jugowice, Walim", 10.5), ("II danie - Jugowice, Walim", 20),
    ("Zestaw - Ludwikowice, Ĺšwierki", 25), ("Zupa - Ludwikowice, Ĺšwierki", 10.5), ("II danie - Ludwikowice, Ĺšwierki", 20),
    ("Nie", 0),
]

SEED_PAYMENTS = [
    ("2026-05-28", "ZAM/2026/001", "www www", 236, "GotĂłwka przy odbiorze", "ZapĹ‚acone"),
]

def register_payments_blueprint(app, db, get_current_user):
    bp = Blueprint("platnosci", __name__, url_prefix="/platnosci")

    class PaymentOrder(db.Model):
        __tablename__ = "payment_orders"

        id = db.Column(db.Integer, primary_key=True)
        order_no = db.Column(db.String(40), unique=True, nullable=False, index=True)
        created = db.Column(db.String(20), default="")
        client = db.Column(db.String(180), nullable=False)
        phone = db.Column(db.String(80), default="")
        email = db.Column(db.String(180), default="")
        order_type = db.Column(db.String(180), default="")
        subscription = db.Column(db.String(120), default="")
        period = db.Column(db.String(120), default="")
        payment_method = db.Column(db.String(120), default="")
        start_date = db.Column(db.String(20), default="")
        portions = db.Column(db.Float, default=0)
        address = db.Column(db.Text, default="")
        notes = db.Column(db.Text, default="")

        def to_dict(self):
            return {
                "id": self.id,
                "orderNo": self.order_no,
                "created": self.created,
                "client": self.client,
                "phone": self.phone,
                "email": self.email,
                "type": self.order_type,
                "subscription": self.subscription,
                "period": self.period,
                "paymentMethod": self.payment_method,
                "startDate": self.start_date,
                "portions": self.portions,
                "address": self.address,
                "notes": self.notes,
            }

    class PaymentPrice(db.Model):
        __tablename__ = "payment_prices"

        id = db.Column(db.Integer, primary_key=True)
        name = db.Column(db.String(180), nullable=False)
        price = db.Column(db.Numeric(10, 2), nullable=False, default=0)

        def to_dict(self):
            return {"id": self.id, "name": self.name, "price": float(self.price)}

    class PaymentEntry(db.Model):
        __tablename__ = "payment_entries"

        id = db.Column(db.Integer, primary_key=True)
        payment_date = db.Column(db.String(20), nullable=False)
        order_no = db.Column(db.String(40), nullable=False, index=True)
        client = db.Column(db.String(180), nullable=False)
        amount = db.Column(db.Numeric(10, 2), nullable=False, default=0)
        method = db.Column(db.String(120), default="")
        status = db.Column(db.String(40), nullable=False, default="Oczekuje")
        created_at = db.Column(db.DateTime, default=datetime.utcnow)

        def to_dict(self):
            return {
                "id": self.id,
                "date": self.payment_date,
                "orderNo": self.order_no,
                "client": self.client,
                "amount": float(self.amount),
                "method": self.method,
                "status": self.status,
            }

    class PaymentLog(db.Model):
        __tablename__ = "payment_logs"

        id = db.Column(db.Integer, primary_key=True)
        created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
        action = db.Column(db.String(40), nullable=False)
        payment_id = db.Column(db.Integer, nullable=True)
        order_no = db.Column(db.String(40), default="")
        client = db.Column(db.String(180), default="")
        before = db.Column(db.Text, default="")
        after = db.Column(db.Text, default="")

        def to_dict(self):
            return {
                "id": self.id,
                "createdAt": self.created_at.isoformat(timespec="seconds"),
                "action": self.action,
                "paymentId": self.payment_id,
                "orderNo": self.order_no,
                "client": self.client,
                "before": self.before,
                "after": self.after,
            }

    class PaymentBill(db.Model):
        __tablename__ = "payment_bills"

        id = db.Column(db.Integer, primary_key=True)
        payment_id = db.Column(db.Integer, nullable=False, unique=True, index=True)
        issue_date = db.Column(db.String(20), nullable=False)
        order_no = db.Column(db.String(40), nullable=False, index=True)
        client = db.Column(db.String(180), nullable=False)
        address = db.Column(db.Text, default="")
        method = db.Column(db.String(120), default="")
        paid_until = db.Column(db.String(20), nullable=False, default="")
        discount = db.Column(db.Numeric(10, 2), nullable=False, default=0)
        total = db.Column(db.Numeric(10, 2), nullable=False, default=0)
        created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

        def to_dict(self):
            items = PaymentBillItem.query.filter_by(bill_id=self.id).order_by(PaymentBillItem.id).all()
            return {
                "id": self.id,
                "paymentId": self.payment_id,
                "date": self.issue_date,
                "orderNo": self.order_no,
                "client": self.client,
                "address": self.address or "",
                "method": self.method or "",
                "paidUntil": self.paid_until or "",
                "discount": float(self.discount),
                "total": float(self.total),
                "items": [item.to_dict() for item in items],
            }

    class PaymentBillItem(db.Model):
        __tablename__ = "payment_bill_items"

        id = db.Column(db.Integer, primary_key=True)
        bill_id = db.Column(db.Integer, nullable=False, index=True)
        name = db.Column(db.String(200), nullable=False)
        quantity = db.Column(db.Numeric(10, 2), nullable=False, default=0)
        unit_price = db.Column(db.Numeric(10, 2), nullable=False, default=0)
        amount = db.Column(db.Numeric(10, 2), nullable=False, default=0)

        def to_dict(self):
            return {
                "id": self.id,
                "name": self.name,
                "qty": float(self.quantity),
                "price": float(self.unit_price),
                "amount": float(self.amount),
            }

    def decimal_amount(value) -> Decimal:
        return Decimal(str(value or 0)).quantize(Decimal("0.01"))

    def payment_dict(payment):
        data = payment.to_dict()
        bill = PaymentBill.query.filter_by(payment_id=payment.id).first()
        data["billId"] = bill.id if bill else None
        return data

    def delete_payment_bill(payment_id: int) -> None:
        bill = PaymentBill.query.filter_by(payment_id=payment_id).first()
        if not bill:
            return
        PaymentBillItem.query.filter_by(bill_id=bill.id).delete()
        db.session.delete(bill)

    def save_payment_bill(payment, data: dict) -> PaymentBill:
        bill_data = data.get("bill") or {}
        bill = PaymentBill(
            payment_id=payment.id,
            issue_date=payment.payment_date,
            order_no=payment.order_no,
            client=payment.client,
            address=bill_data.get("address") or "",
            method=payment.method,
            paid_until=bill_data.get("paidUntil") or "",
            discount=decimal_amount(bill_data.get("discount")),
            total=payment.amount,
        )
        db.session.add(bill)
        db.session.flush()
        for raw_item in bill_data.get("items") or []:
            quantity = decimal_amount(raw_item.get("qty"))
            unit_price = decimal_amount(raw_item.get("price"))
            if quantity <= 0:
                continue
            db.session.add(PaymentBillItem(
                bill_id=bill.id,
                name=str(raw_item.get("name") or "Pozycja"),
                quantity=quantity,
                unit_price=unit_price,
                amount=decimal_amount(quantity * unit_price),
            ))
        return bill

    def log_payment(action, payment=None, before="", after=""):
        db.session.add(PaymentLog(
            action=action,
            payment_id=payment.id if payment else None,
            order_no=payment.order_no if payment else "",
            client=payment.client if payment else "",
            before=before,
            after=after,
        ))

    def normalize_header(value) -> str:
        text = unicodedata.normalize("NFKD", str(value or "").strip().lower())
        text = "".join(char for char in text if not unicodedata.combining(char))
        return " ".join(text.replace("/", " ").replace("_", " ").replace("-", " ").split())

    def row_value(row: dict, *names: str) -> str:
        normalized = {}
        for key, value in row.items():
            normalized.setdefault(normalize_header(re.sub(r"__\d+$", "", key)), []).append(value)
        for name in names:
            for value in normalized.get(normalize_header(name), []):
                if value not in (None, ""):
                    return str(value).strip()
        return ""

    def row_last_value(row: dict, *names: str) -> str:
        normalized = {}
        for key, value in row.items():
            normalized.setdefault(normalize_header(re.sub(r"__\d+$", "", key)), []).append(value)
        for name in names:
            values = [value for value in normalized.get(normalize_header(name), []) if value not in (None, "")]
            if values:
                return str(values[-1]).strip()
        return ""

    def fallback_order_no(row: dict) -> str:
        for value in row.values():
            text = str(value or "").strip()
            if re.search(r"\b[A-Z]{2,}/\d{4}/\d+\b", text, flags=re.IGNORECASE):
                return text
        return ""

    def decimal_from_text(value) -> float:
        text = str(value or "").strip().replace(",", ".")
        try:
            return float(text)
        except ValueError:
            return 0

    def cell_text(value) -> str:
        if value is None:
            return ""
        if isinstance(value, (datetime, date)):
            return value.isoformat()
        return str(value).strip()

    def parse_csv_rows(raw: bytes) -> list[dict]:
        try:
            text = raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = raw.decode("cp1250")
        sample = text[:4096]
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
        except csv.Error:
            dialect = csv.excel
        reader = csv.reader(io.StringIO(text), dialect=dialect)
        rows = list(reader)
        if not rows:
            return []
        headers = [cell_text(header) for header in rows[0]]
        parsed = []
        for raw_row in rows[1:]:
            row = {}
            for index, header in enumerate(headers):
                if not header:
                    continue
                key = header
                if key in row:
                    suffix = 2
                    while f"{key}__{suffix}" in row:
                        suffix += 1
                    key = f"{key}__{suffix}"
                row[key] = cell_text(raw_row[index]) if index < len(raw_row) else ""
            if any(row.values()):
                parsed.append(row)
        return parsed

    def import_order_rows(rows: list[dict]) -> int:
        imported = 0
        for row in rows:
            order_no = row_value(row, "Nr Zamówienia", "Numer zamówienia", "Nr zamowienia", "Zamówienie", "ID zamówienia") or fallback_order_no(row)
            client = row_value(row, "Imię i nazwisko / Nazwa firmy", "Imię i nazwisko", "Nazwa firmy", "Klient")
            if not order_no or not client:
                continue
            if order_no.upper().startswith("RE/"):
                continue
            order = PaymentOrder.query.filter_by(order_no=order_no).first() or PaymentOrder(order_no=order_no, client=client)
            order.client = client
            order.created = row_value(row, "Sygnatura czasowa", "Data utworzenia")
            order.phone = row_value(row, "Numer telefonu kontaktowego", "Telefon", "Numer telefonu")
            order.email = row_value(row, "Adres e-mail", "Email", "E-mail")
            order.order_type = row_last_value(row, "Rodzaj zamówienia", "Typ zamówienia", "Rodzaj zamówienia lub proszę opisać zapotrzebowanie w odpowiedzi inne")
            order.subscription = row_value(row, "Rodzaj Zamówienia / Abonamentu", "Rodzaj abonamentu", "Abonament")
            order.period = row_value(row, "Okres zamówienia / rozliczenia", "Okres zamówienia", "Okres rozliczenia", "Okres")
            order.payment_method = row_value(row, "Forma rozliczenia", "Forma płatności", "Metoda płatności")
            order.start_date = row_value(row, "Data rozpoczęcia abonamentu", "Data rozpoczęcia zamówienia", "Data startu")
            order.portions = decimal_from_text(row_last_value(row, "Ilość porcji", "Proszę podać przybliżoną ilość osób / porcji", "Liczba porcji", "Porcje"))
            order.address = row_last_value(row, "Adres dostawy", "Adres")
            order.notes = row_value(row, "Dodatkowe uwagi do zamówienia", "Uwagi", "Notatki")
            db.session.add(order)
            imported += 1
        db.session.commit()
        return imported

    def next_manual_order_no() -> str:
        year = date.today().year
        prefix = f"RE/{year}/"
        highest = 0
        rows = PaymentOrder.query.filter(PaymentOrder.order_no.like(f"{prefix}%")).all()
        for row in rows:
            suffix = row.order_no.rsplit("/", 1)[-1]
            if suffix.isdigit():
                highest = max(highest, int(suffix))
        return f"{prefix}{highest + 1:03d}"

    @bp.before_request
    def guard():
        user = get_current_user()
        if not user:
            if request.path.startswith("/platnosci/api/"):
                return jsonify({"error": "unauthorized"}), 401
            return redirect(url_for("index"))
        if user.role != "admin":
            if request.path.startswith("/platnosci/api/"):
                return jsonify({"error": "forbidden"}), 403
            return "Brak uprawnieĹ„ do moduĹ‚u pĹ‚atnoĹ›ci", 403

    @bp.route("/")
    def index():
        return render_template("platnosci/index.html", app_root=url_for(".index").rstrip("/"))

    @bp.route("/api/bootstrap")
    def bootstrap():
        return jsonify({
            "orders": [row.to_dict() for row in PaymentOrder.query.order_by(PaymentOrder.order_no).all()],
            "prices": [row.to_dict() for row in PaymentPrice.query.order_by(PaymentPrice.id).all()],
            "payments": [payment_dict(row) for row in PaymentEntry.query.order_by(PaymentEntry.payment_date.desc(), PaymentEntry.id.desc()).all()],
        })

    @bp.route("/api/prices", methods=["POST"])
    def add_price():
        data = request.get_json()
        item = PaymentPrice(name=data.get("name") or "Nowa pozycja", price=decimal_amount(data.get("price")))
        db.session.add(item)
        db.session.commit()
        return jsonify(item.to_dict())

    @bp.route("/api/prices/<int:price_id>", methods=["PATCH", "DELETE"])
    def price_detail(price_id):
        item = db.session.get(PaymentPrice, price_id)
        if not item:
            return jsonify({"error": "not found"}), 404
        if request.method == "DELETE":
            db.session.delete(item)
            db.session.commit()
            return jsonify({"ok": True})
        data = request.get_json()
        item.name = data.get("name", item.name)
        if "price" in data:
            item.price = decimal_amount(data.get("price"))
        db.session.commit()
        return jsonify(item.to_dict())

    @bp.route("/api/orders/manual", methods=["POST"])
    def add_manual_order():
        data = request.get_json() or {}
        client = (data.get("client") or "").strip()
        if not client:
            return jsonify({"error": "Podaj klienta."}), 400
        order = PaymentOrder(
            order_no=next_manual_order_no(),
            created=date.today().isoformat(),
            client=client,
            phone=(data.get("phone") or "").strip(),
            email=(data.get("email") or "").strip(),
            order_type="Ręczne",
            subscription=(data.get("subscription") or "").strip(),
            period=(data.get("period") or "").strip(),
            payment_method=(data.get("paymentMethod") or "").strip(),
            start_date=(data.get("startDate") or "").strip(),
            portions=decimal_from_text(data.get("portions")),
            address=(data.get("address") or "").strip(),
            notes=(data.get("notes") or "").strip(),
        )
        db.session.add(order)
        db.session.commit()
        return jsonify(order.to_dict())

    @bp.route("/api/payments", methods=["POST"])
    def add_payment():
        data = request.get_json()
        item = PaymentEntry(
            payment_date=data.get("date") or date.today().isoformat(),
            order_no=data.get("orderNo") or "",
            client=data.get("client") or "",
            amount=decimal_amount(data.get("amount")),
            method=data.get("method") or "",
            status=data.get("status") or "Oczekuje",
        )
        db.session.add(item)
        db.session.flush()
        save_payment_bill(item, data)
        log_payment("create", item, after=str(item.to_dict()))
        db.session.commit()
        return jsonify(payment_dict(item))

    @bp.route("/api/payments/<int:payment_id>/bill")
    def payment_bill(payment_id):
        bill = PaymentBill.query.filter_by(payment_id=payment_id).first()
        if not bill:
            return jsonify({"error": "Rachunek nie jest dostępny"}), 404
        return jsonify(bill.to_dict())

    @bp.route("/api/payments/<int:payment_id>", methods=["PATCH", "DELETE"])
    def payment_detail(payment_id):
        item = db.session.get(PaymentEntry, payment_id)
        if not item:
            return jsonify({"error": "not found"}), 404
        before = str(item.to_dict())
        if request.method == "DELETE":
            log_payment("delete", item, before=before)
            delete_payment_bill(item.id)
            db.session.delete(item)
            db.session.commit()
            return jsonify({"ok": True})
        data = request.get_json()
        if "status" in data:
            item.status = data["status"]
        if "amount" in data:
            item.amount = decimal_amount(data["amount"])
        log_payment("update", item, before=before, after=str(item.to_dict()))
        db.session.commit()
        return jsonify(payment_dict(item))

    @bp.route("/api/payments/delete-paid", methods=["POST"])
    def delete_paid():
        data = request.get_json() or {}
        query = PaymentEntry.query.filter_by(status="ZapĹ‚acone")
        if data.get("from"):
            query = query.filter(PaymentEntry.payment_date >= data["from"])
        if data.get("to"):
            query = query.filter(PaymentEntry.payment_date <= data["to"])
        items = query.all()
        for item in items:
            log_payment("delete-paid", item, before=str(item.to_dict()))
            delete_payment_bill(item.id)
            db.session.delete(item)
        db.session.commit()
        return jsonify({"deleted": len(items)})

    @bp.route("/api/payment-logs")
    def payment_logs():
        return jsonify([row.to_dict() for row in PaymentLog.query.order_by(PaymentLog.created_at.desc()).limit(1000).all()])

    @bp.route("/api/import/orders", methods=["POST"])
    def import_orders():
        uploaded = request.files.get("file")
        if not uploaded:
            return jsonify({"error": "Wybierz plik CSV."}), 400
        try:
            rows = parse_csv_rows(uploaded.read())
            imported = import_order_rows(rows)
        except UnicodeDecodeError:
            return jsonify({"error": "Nie udało się odczytać pliku CSV. Zapisz arkusz jako CSV UTF-8."}), 400
        return jsonify({"imported": imported})

    def init_payments_db():
        inspector = inspect(db.engine)
        if "payment_bills" in inspector.get_table_names():
            columns = {column["name"] for column in inspector.get_columns("payment_bills")}
            if "paid_until" not in columns:
                db.session.execute(text("ALTER TABLE payment_bills ADD COLUMN paid_until VARCHAR(20) NOT NULL DEFAULT ''"))
                db.session.commit()
        if not PaymentOrder.query.first():
            db.session.add_all(PaymentOrder(**row) for row in SEED_ORDERS)
        if not PaymentPrice.query.first():
            db.session.add_all(PaymentPrice(name=name, price=decimal_amount(price)) for name, price in SEED_PRICES)
        if not PaymentEntry.query.first():
            for payment_date, order_no, client, amount, method, status in SEED_PAYMENTS:
                db.session.add(PaymentEntry(payment_date=payment_date, order_no=order_no, client=client, amount=decimal_amount(amount), method=method, status=status))
        db.session.commit()

    app.register_blueprint(bp)
    return init_payments_db

