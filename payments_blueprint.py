from __future__ import annotations

import csv
import io
from datetime import date, datetime
from decimal import Decimal

from flask import Blueprint, jsonify, redirect, render_template, request, url_for


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

    def decimal_amount(value) -> Decimal:
        return Decimal(str(value or 0)).quantize(Decimal("0.01"))

    def log_payment(action, payment=None, before="", after=""):
        db.session.add(PaymentLog(
            action=action,
            payment_id=payment.id if payment else None,
            order_no=payment.order_no if payment else "",
            client=payment.client if payment else "",
            before=before,
            after=after,
        ))

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
            "payments": [row.to_dict() for row in PaymentEntry.query.order_by(PaymentEntry.payment_date.desc(), PaymentEntry.id.desc()).all()],
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
        log_payment("create", item, after=str(item.to_dict()))
        db.session.commit()
        return jsonify(item.to_dict())

    @bp.route("/api/payments/<int:payment_id>", methods=["PATCH", "DELETE"])
    def payment_detail(payment_id):
        item = db.session.get(PaymentEntry, payment_id)
        if not item:
            return jsonify({"error": "not found"}), 404
        before = str(item.to_dict())
        if request.method == "DELETE":
            log_payment("delete", item, before=before)
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
        return jsonify(item.to_dict())

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
            return jsonify({"error": "missing file"}), 400
        text = uploaded.read().decode("utf-8-sig")
        dialect = csv.Sniffer().sniff(text[:2048], delimiters=",;\t")
        rows = list(csv.DictReader(io.StringIO(text), dialect=dialect))
        imported = 0
        for row in rows:
            order_no = row.get("Nr ZamĂłwienia") or row.get("Numer zamĂłwienia") or ""
            client = row.get("ImiÄ™ i nazwisko / Nazwa firmy") or ""
            if not order_no or not client:
                continue
            order = PaymentOrder.query.filter_by(order_no=order_no).first() or PaymentOrder(order_no=order_no, client=client)
            order.client = client
            order.phone = row.get("Numer telefonu kontaktowego") or ""
            order.email = row.get("Adres e-mail") or ""
            order.order_type = row.get("Rodzaj zamĂłwienia") or ""
            order.subscription = row.get("Rodzaj ZamĂłwienia / Abonamentu") or ""
            order.period = row.get("Okres zamĂłwienia / rozliczenia") or ""
            order.payment_method = row.get("Forma rozliczenia") or ""
            order.start_date = row.get("Data rozpoczÄ™cia abonamentu") or row.get("Data rozpoczÄ™cia zamĂłwienia") or ""
            order.address = row.get("Adres dostawy") or ""
            order.notes = row.get("Dodatkowe uwagi do zamĂłwienia") or ""
            db.session.add(order)
            imported += 1
        db.session.commit()
        return jsonify({"imported": imported})

    def init_payments_db():
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

