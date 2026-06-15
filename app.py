from __future__ import annotations

import json
import os
from datetime import date, datetime, timedelta
from functools import wraps
from pathlib import Path

from flask import Flask, Response, jsonify, render_template, request, session
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import inspect, text
from werkzeug.security import check_password_hash, generate_password_hash

from payments_blueprint import register_payments_blueprint


BASE_DIR = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("OBIADY_DB", BASE_DIR / "instance" / "obiady.sqlite3"))

app = Flask(__name__, instance_path=str(BASE_DIR / "instance"))
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "zmien-to-w-produkcji")
app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{DB_PATH.as_posix()}"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

db = SQLAlchemy(app)
init_payments_db = register_payments_blueprint(app, db, lambda: current_user())


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    name = db.Column(db.String(160), nullable=False)
    role = db.Column(db.String(20), nullable=False)
    driver_id = db.Column(db.Integer, db.ForeignKey("drivers.id"), nullable=True)


class Region(db.Model):
    __tablename__ = "regions"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(160), nullable=False)
    driver_id = db.Column(db.Integer, db.ForeignKey("drivers.id"), nullable=True)


class Driver(db.Model):
    __tablename__ = "drivers"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(160), nullable=False)
    phone = db.Column(db.String(80), default="")


class Category(db.Model):
    __tablename__ = "categories"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(160), nullable=False)


class Meal(db.Model):
    __tablename__ = "meals"

    id = db.Column(db.Integer, primary_key=True)
    category_id = db.Column(db.Integer, db.ForeignKey("categories.id"), nullable=False)
    name = db.Column(db.String(160), nullable=False)


class Client(db.Model):
    __tablename__ = "clients"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    phone = db.Column(db.String(80), default="")
    address = db.Column(db.String(255), nullable=False)
    region_id = db.Column(db.Integer, db.ForeignKey("regions.id"), nullable=False)
    driver_id = db.Column(db.Integer, db.ForeignKey("drivers.id"), nullable=False)
    active = db.Column(db.Boolean, default=True, nullable=False)
    notes = db.Column(db.Text, default="")


class Order(db.Model):
    __tablename__ = "orders"

    id = db.Column(db.Integer, primary_key=True)
    client_id = db.Column(db.Integer, db.ForeignKey("clients.id", ondelete="CASCADE"), nullable=False)
    category_id = db.Column(db.Integer, db.ForeignKey("categories.id"), nullable=False)
    meal_id = db.Column(db.Integer, db.ForeignKey("meals.id"), nullable=False)
    start_date = db.Column(db.String(10), nullable=False)
    end_date = db.Column(db.String(10), nullable=False)
    days_json = db.Column(db.Text, default="[]", nullable=False)
    interval_days = db.Column(db.Integer, default=0, nullable=False)
    custom_dates_json = db.Column(db.Text, default="[]", nullable=False)
    excluded_dates_json = db.Column(db.Text, default="[]", nullable=False)
    quantity = db.Column(db.Integer, default=1, nullable=False)
    notes = db.Column(db.Text, default="")


class DeliveryStatus(db.Model):
    __tablename__ = "delivery_statuses"

    date = db.Column(db.String(10), primary_key=True)
    order_id = db.Column(db.Integer, db.ForeignKey("orders.id", ondelete="CASCADE"), primary_key=True)
    status = db.Column(db.String(40), nullable=False)


class RemovedDelivery(db.Model):
    __tablename__ = "removed_deliveries"

    date = db.Column(db.String(10), primary_key=True)
    order_id = db.Column(db.Integer, db.ForeignKey("orders.id", ondelete="CASCADE"), primary_key=True)


class DriverDefaultOrder(db.Model):
    __tablename__ = "driver_default_order"

    driver_id = db.Column(db.Integer, db.ForeignKey("drivers.id"), primary_key=True)
    client_id = db.Column(db.Integer, db.ForeignKey("clients.id", ondelete="CASCADE"), primary_key=True)
    position = db.Column(db.Integer, nullable=False)


class DriverClientNote(db.Model):
    __tablename__ = "driver_client_notes"

    driver_id = db.Column(db.Integer, db.ForeignKey("drivers.id"), primary_key=True)
    client_id = db.Column(db.Integer, db.ForeignKey("clients.id", ondelete="CASCADE"), primary_key=True)
    note = db.Column(db.Text, default="")


def today_iso(offset: int = 0) -> str:
    return (date.today() + timedelta(days=offset)).isoformat()


def json_load(value: str | None, default):
    if not value:
        return default
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return default


def json_dump(value) -> str:
    return json.dumps(value, ensure_ascii=False)


def seed_data() -> None:
    regions = [Region(name="Centrum"), Region(name="Północ"), Region(name="Południe")]
    drivers = [Driver(name="Kierowca Centrum"), Driver(name="Kierowca Północ"), Driver(name="Kierowca Południe")]
    db.session.add_all(regions + drivers)
    db.session.flush()
    for region, driver in zip(regions, drivers):
        region.driver_id = driver.id

    category = Category(name="Obiady standardowe")
    db.session.add(category)
    db.session.flush()
    meals = {
        "Zestaw": Meal(category_id=category.id, name="Zestaw"),
        "II danie": Meal(category_id=category.id, name="II danie"),
        "Zupa": Meal(category_id=category.id, name="Zupa"),
    }
    db.session.add_all(meals.values())

    db.session.add(
        User(
            username="admin",
            password_hash=generate_password_hash("admin123"),
            name="Administrator",
            role="admin",
        )
    )
    for index, driver in enumerate(drivers, start=1):
        db.session.add(
            User(
                username=f"kierowca{index}",
                password_hash=generate_password_hash("kierowca123"),
                name=driver.name,
                role="driver",
                driver_id=driver.id,
            )
        )

    clients = [
        Client(name="Anna Kowalska", phone="501 222 333", address="ul. Długa 4", region_id=regions[0].id, driver_id=drivers[0].id, notes="Dzwonić przed dostawą"),
        Client(name="Jan Nowak", phone="601 111 222", address="ul. Leśna 12", region_id=regions[0].id, driver_id=drivers[0].id),
        Client(name="Firma Alfa", phone="733 444 555", address="ul. Przemysłowa 8", region_id=regions[2].id, driver_id=drivers[2].id, notes="Recepcja, parter"),
    ]
    db.session.add_all(clients)
    db.session.flush()

    db.session.add_all(
        [
            Order(client_id=clients[0].id, category_id=category.id, meal_id=meals["Zestaw"].id, start_date=today_iso(-2), end_date=today_iso(20), days_json=json_dump([1, 2, 3, 4, 5]), quantity=1),
            Order(client_id=clients[1].id, category_id=category.id, meal_id=meals["Zupa"].id, start_date=today_iso(-2), end_date=today_iso(20), days_json=json_dump([1, 2, 3, 4, 5]), quantity=2, notes="Bez koperku"),
            Order(client_id=clients[2].id, category_id=category.id, meal_id=meals["II danie"].id, start_date=today_iso(), end_date=today_iso(30), days_json=json_dump([]), interval_days=2, quantity=6, notes="Dostawa do 12:00"),
        ]
    )
    db.session.commit()


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db.create_all()
    migrate_db()
    if User.query.count() == 0:
        seed_data()
    init_payments_db()


def migrate_db() -> None:
    inspector = inspect(db.engine)
    if "regions" in inspector.get_table_names():
        columns = {column["name"] for column in inspector.get_columns("regions")}
        if "driver_id" not in columns:
            db.session.execute(text("ALTER TABLE regions ADD COLUMN driver_id INTEGER"))
            db.session.commit()
        for region in Region.query.all():
            if region.driver_id is None:
                client = Client.query.filter_by(region_id=region.id).first()
                if client:
                    region.driver_id = client.driver_id
        db.session.commit()
    if "orders" in inspector.get_table_names():
        columns = {column["name"] for column in inspector.get_columns("orders")}
        if "excluded_dates_json" not in columns:
            db.session.execute(text("ALTER TABLE orders ADD COLUMN excluded_dates_json TEXT NOT NULL DEFAULT '[]'"))
            db.session.commit()


def current_user() -> User | None:
    user_id = session.get("user_id")
    if not user_id:
        return None
    return db.session.get(User, user_id)


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not current_user():
            return jsonify({"error": "Wymagane logowanie"}), 401
        return fn(*args, **kwargs)

    return wrapper


def admin_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user = current_user()
        if not user:
            return jsonify({"error": "Wymagane logowanie"}), 401
        if user.role != "admin":
            return jsonify({"error": "Brak uprawnień"}), 403
        return fn(*args, **kwargs)

    return wrapper


def user_can_access_order(user: User, order_id: int) -> bool:
    if user.role == "admin":
        return True
    order = db.session.get(Order, order_id)
    if not order:
        return False
    client = db.session.get(Client, order.client_id)
    return bool(client and client.driver_id == user.driver_id)


def user_can_access_client(user: User, client_id: int) -> bool:
    if user.role == "admin":
        return True
    client = db.session.get(Client, client_id)
    return bool(client and client.driver_id == user.driver_id)


def order_dict(order: Order) -> dict:
    return {
        "id": order.id,
        "client_id": order.client_id,
        "category_id": order.category_id,
        "meal_id": order.meal_id,
        "start_date": order.start_date,
        "end_date": order.end_date,
        "days": json_load(order.days_json, []),
        "interval_days": order.interval_days,
        "custom_dates": json_load(order.custom_dates_json, []),
        "excluded_dates": json_load(order.excluded_dates_json, []),
        "quantity": order.quantity,
        "notes": order.notes or "",
    }


def applies_on(order: dict, date_text: str) -> bool:
    if date_text in order.get("excluded_dates", []):
        return False
    day = datetime.strptime(date_text, "%Y-%m-%d").date()
    start = datetime.strptime(order["start_date"], "%Y-%m-%d").date()
    in_range = order["start_date"] <= date_text <= order["end_date"]
    days_from_start = (day - start).days
    weekday = 0 if day.weekday() == 6 else day.weekday() + 1
    if int(order["interval_days"] or 0) > 1:
        return (in_range and days_from_start % int(order["interval_days"]) == 0) or date_text in order["custom_dates"]
    return (in_range and weekday in order["days"]) or date_text in order["custom_dates"]


def serialize_state(user: User) -> dict:
    clients_query = Client.query
    orders_query = Order.query
    visible_order_ids = None
    default_order_query = DriverDefaultOrder.query
    driver_notes_query = DriverClientNote.query
    if user.role == "driver":
        clients_query = clients_query.filter(Client.driver_id == user.driver_id)
        orders_query = orders_query.join(Client, Client.id == Order.client_id).filter(Client.driver_id == user.driver_id)
        visible_order_ids = [row.id for row in orders_query.all()]
        default_order_query = default_order_query.filter(DriverDefaultOrder.driver_id == user.driver_id)
        driver_notes_query = driver_notes_query.filter(DriverClientNote.driver_id == user.driver_id)

    status_query = DeliveryStatus.query
    removed_query = RemovedDelivery.query
    if visible_order_ids is not None:
        if visible_order_ids:
            status_query = status_query.filter(DeliveryStatus.order_id.in_(visible_order_ids))
            removed_query = removed_query.filter(RemovedDelivery.order_id.in_(visible_order_ids))
        else:
            status_query = status_query.filter(DeliveryStatus.order_id == -1)
            removed_query = removed_query.filter(RemovedDelivery.order_id == -1)

    return {
        "current_user": {
            "id": user.id,
            "username": user.username,
            "name": user.name,
            "role": user.role,
            "driver_id": user.driver_id,
        },
        "regions": [{"id": row.id, "name": row.name, "driver_id": row.driver_id} for row in Region.query.order_by(Region.name).all()],
        "drivers": [
            {"id": row.id, "name": row.name, "phone": row.phone or ""}
            for row in (Driver.query.order_by(Driver.name).all() if user.role == "admin" else Driver.query.filter_by(id=user.driver_id).all())
        ],
        "users": [
            {"id": row.id, "username": row.username, "name": row.name, "role": row.role, "driver_id": row.driver_id}
            for row in (User.query.order_by(User.role, User.name).all() if user.role == "admin" else [])
        ],
        "categories": [{"id": row.id, "name": row.name} for row in Category.query.order_by(Category.name).all()],
        "meals": [{"id": row.id, "category_id": row.category_id, "name": row.name} for row in Meal.query.order_by(Meal.name).all()],
        "clients": [
            {
                "id": row.id,
                "name": row.name,
                "phone": row.phone or "",
                "address": row.address,
                "region_id": row.region_id,
                "driver_id": row.driver_id,
                "active": row.active,
                "notes": row.notes or "",
            }
            for row in clients_query.order_by(Client.name).all()
        ],
        "orders": [order_dict(row) for row in orders_query.order_by(Order.id).all()],
        "statuses": [{"date": row.date, "order_id": row.order_id, "status": row.status} for row in status_query.all()],
        "removed": [{"date": row.date, "order_id": row.order_id} for row in removed_query.all()],
        "default_order": [
            {"driver_id": row.driver_id, "client_id": row.client_id, "position": row.position}
            for row in default_order_query.order_by(DriverDefaultOrder.driver_id, DriverDefaultOrder.position).all()
        ],
        "driver_notes": [
            {"driver_id": row.driver_id, "client_id": row.client_id, "note": row.note or ""}
            for row in driver_notes_query.all()
        ],
    }


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/robots.txt")
def robots_txt():
    return Response("User-agent: *\nDisallow: /\n", mimetype="text/plain")


@app.post("/api/login")
def login():
    payload = request.get_json(force=True)
    user = User.query.filter_by(username=payload.get("username")).first()
    if not user or not check_password_hash(user.password_hash, payload.get("password", "")):
        return jsonify({"error": "Nieprawidłowy login lub hasło"}), 401
    session["user_id"] = user.id
    return jsonify({"ok": True})


@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify({"ok": True})


@app.get("/api/state")
@login_required
def state():
    return jsonify(serialize_state(current_user()))


@app.post("/api/admin-password")
@admin_required
def change_admin_password():
    user = current_user()
    payload = request.get_json(force=True)
    current_password = payload.get("current_password", "")
    new_password = payload.get("new_password", "")
    if not check_password_hash(user.password_hash, current_password):
        return jsonify({"error": "Obecne hasło jest nieprawidłowe"}), 400
    if len(new_password) < 8:
        return jsonify({"error": "Nowe hasło musi mieć co najmniej 8 znaków"}), 400
    user.password_hash = generate_password_hash(new_password)
    db.session.commit()
    return jsonify({"ok": True})


@app.post("/api/clients")
@admin_required
def add_client():
    payload = request.get_json(force=True)
    db.session.add(
        Client(
            name=payload["name"],
            phone=payload.get("phone", ""),
            address=payload["address"],
            region_id=payload["region_id"],
            driver_id=payload["driver_id"],
            notes=payload.get("notes", ""),
        )
    )
    db.session.commit()
    return jsonify({"ok": True})


@app.put("/api/clients/<int:client_id>")
@admin_required
def update_client(client_id: int):
    client = db.session.get(Client, client_id)
    if not client:
        return jsonify({"error": "Nie znaleziono klienta"}), 404
    payload = request.get_json(force=True)
    client.name = payload["name"]
    client.phone = payload.get("phone", "")
    client.address = payload["address"]
    client.region_id = payload["region_id"]
    client.driver_id = payload["driver_id"]
    client.active = bool(payload.get("active", client.active))
    client.notes = payload.get("notes", "")
    db.session.commit()
    return jsonify({"ok": True})


@app.post("/api/clients/<int:client_id>/toggle")
@admin_required
def toggle_client(client_id: int):
    client = db.session.get(Client, client_id)
    if client:
        client.active = not client.active
        db.session.commit()
    return jsonify({"ok": True})


@app.delete("/api/clients/<int:client_id>")
@admin_required
def delete_client(client_id: int):
    client = db.session.get(Client, client_id)
    if client:
        order_ids = [row.id for row in Order.query.filter_by(client_id=client_id).all()]
        if order_ids:
            DeliveryStatus.query.filter(DeliveryStatus.order_id.in_(order_ids)).delete(synchronize_session=False)
            RemovedDelivery.query.filter(RemovedDelivery.order_id.in_(order_ids)).delete(synchronize_session=False)
            Order.query.filter(Order.id.in_(order_ids)).delete(synchronize_session=False)
        DriverDefaultOrder.query.filter_by(client_id=client_id).delete()
        db.session.delete(client)
        db.session.commit()
    return jsonify({"ok": True})


@app.post("/api/orders")
@admin_required
def add_order():
    payload = request.get_json(force=True)
    db.session.add(
        Order(
            client_id=payload["client_id"],
            category_id=payload["category_id"],
            meal_id=payload["meal_id"],
            start_date=payload["start_date"],
            end_date=payload["end_date"],
            days_json=json_dump(payload.get("days", [])),
            interval_days=payload.get("interval_days", 0),
            custom_dates_json=json_dump(payload.get("custom_dates", [])),
            excluded_dates_json=json_dump(payload.get("excluded_dates", [])),
            quantity=payload.get("quantity", 1),
            notes=payload.get("notes", ""),
        )
    )
    db.session.commit()
    return jsonify({"ok": True})


@app.put("/api/orders/<int:order_id>")
@admin_required
def update_order(order_id: int):
    order = db.session.get(Order, order_id)
    if not order:
        return jsonify({"error": "Nie znaleziono planu"}), 404
    payload = request.get_json(force=True)
    order.client_id = payload["client_id"]
    order.category_id = payload["category_id"]
    order.meal_id = payload["meal_id"]
    order.start_date = payload["start_date"]
    order.end_date = payload["end_date"]
    order.days_json = json_dump(payload.get("days", []))
    order.interval_days = payload.get("interval_days", 0)
    order.custom_dates_json = json_dump(payload.get("custom_dates", []))
    order.excluded_dates_json = json_dump(payload.get("excluded_dates", []))
    order.quantity = payload.get("quantity", 1)
    order.notes = payload.get("notes", "")
    db.session.commit()
    return jsonify({"ok": True})


@app.delete("/api/orders/<int:order_id>")
@admin_required
def delete_order(order_id: int):
    order = db.session.get(Order, order_id)
    if order:
        DeliveryStatus.query.filter_by(order_id=order_id).delete()
        RemovedDelivery.query.filter_by(order_id=order_id).delete()
        db.session.delete(order)
        db.session.commit()
    return jsonify({"ok": True})


@app.post("/api/regions")
@admin_required
def add_region():
    payload = request.get_json(force=True)
    first_driver = Driver.query.order_by(Driver.name).first()
    region = Region(name=payload["name"], driver_id=payload.get("driver_id") or (first_driver.id if first_driver else None))
    db.session.add(region)
    db.session.commit()
    return jsonify({"id": region.id, "name": region.name, "driver_id": region.driver_id})


@app.put("/api/regions/<int:region_id>")
@admin_required
def update_region(region_id: int):
    region = db.session.get(Region, region_id)
    if not region:
        return jsonify({"error": "Nie znaleziono rejonu"}), 404
    payload = request.get_json(force=True)
    region.name = payload["name"]
    db.session.commit()
    return jsonify({"ok": True})


@app.delete("/api/regions/<int:region_id>")
@admin_required
def delete_region(region_id: int):
    region = db.session.get(Region, region_id)
    if not region:
        return jsonify({"error": "Nie znaleziono rejonu"}), 404
    if Client.query.filter_by(region_id=region_id).count():
        return jsonify({"error": "Nie można usunąć rejonu, do którego są przypisani klienci"}), 400
    db.session.delete(region)
    db.session.commit()
    return jsonify({"ok": True})


@app.post("/api/regions/<int:region_id>/assign-driver")
@admin_required
def assign_region_driver(region_id: int):
    payload = request.get_json(force=True)
    region = db.session.get(Region, region_id)
    driver = db.session.get(Driver, payload.get("driver_id"))
    if not region or not driver:
        return jsonify({"error": "Nie znaleziono rejonu albo kierowcy"}), 404
    region.driver_id = driver.id
    Client.query.filter_by(region_id=region_id).update({"driver_id": driver.id})
    db.session.commit()
    return jsonify({"ok": True})


@app.post("/api/drivers")
@admin_required
def add_driver():
    payload = request.get_json(force=True)
    if not payload.get("username"):
        return jsonify({"error": "Login jest wymagany"}), 400
    if not payload.get("password"):
        return jsonify({"error": "Hasło jest wymagane"}), 400
    if User.query.filter_by(username=payload["username"]).first():
        return jsonify({"error": "Taki login już istnieje"}), 400
    driver = Driver(name=payload["name"], phone=payload.get("phone", ""))
    db.session.add(driver)
    db.session.flush()
    db.session.add(
        User(
            username=payload["username"],
            password_hash=generate_password_hash(payload["password"]),
            name=payload["name"],
            role="driver",
            driver_id=driver.id,
        )
    )
    db.session.commit()
    return jsonify({"ok": True})


@app.put("/api/drivers/<int:driver_id>")
@admin_required
def update_driver(driver_id: int):
    driver = db.session.get(Driver, driver_id)
    if not driver:
        return jsonify({"error": "Nie znaleziono kierowcy"}), 404
    payload = request.get_json(force=True)
    driver.name = payload["name"]
    driver.phone = payload.get("phone", "")
    user = User.query.filter_by(driver_id=driver_id, role="driver").first()
    username = payload.get("username", "").strip()
    if username:
        duplicate = User.query.filter(User.username == username, User.id != (user.id if user else 0)).first()
        if duplicate:
            return jsonify({"error": "Taki login już istnieje"}), 400
    if user:
        if username:
            user.username = username
        user.name = payload["name"]
        if payload.get("password"):
            user.password_hash = generate_password_hash(payload["password"])
    elif username:
        if not payload.get("password"):
            return jsonify({"error": "Hasło jest wymagane dla nowego konta kierowcy"}), 400
        db.session.add(
            User(
                username=username,
                password_hash=generate_password_hash(payload["password"]),
                name=payload["name"],
                role="driver",
                driver_id=driver.id,
            )
        )
    db.session.commit()
    return jsonify({"ok": True})


@app.delete("/api/drivers/<int:driver_id>")
@admin_required
def delete_driver(driver_id: int):
    driver = db.session.get(Driver, driver_id)
    if not driver:
        return jsonify({"error": "Nie znaleziono kierowcy"}), 404
    if Client.query.filter_by(driver_id=driver_id).count():
        return jsonify({"error": "Nie można usunąć kierowcy, który ma przypisanych klientów"}), 400
    User.query.filter_by(driver_id=driver_id, role="driver").delete()
    DriverDefaultOrder.query.filter_by(driver_id=driver_id).delete()
    DriverClientNote.query.filter_by(driver_id=driver_id).delete()
    db.session.delete(driver)
    db.session.commit()
    return jsonify({"ok": True})


@app.post("/api/users")
@admin_required
def add_user():
    payload = request.get_json(force=True)
    if not payload.get("password"):
        return jsonify({"error": "Hasło jest wymagane"}), 400
    if User.query.filter_by(username=payload["username"]).first():
        return jsonify({"error": "Taki login już istnieje"}), 400
    db.session.add(
        User(
            username=payload["username"],
            password_hash=generate_password_hash(payload["password"]),
            name=payload["name"],
            role=payload.get("role", "driver"),
            driver_id=payload.get("driver_id") or None,
        )
    )
    db.session.commit()
    return jsonify({"ok": True})


@app.put("/api/users/<int:user_id>")
@admin_required
def update_user(user_id: int):
    user = db.session.get(User, user_id)
    if not user:
        return jsonify({"error": "Nie znaleziono konta"}), 404
    payload = request.get_json(force=True)
    duplicate = User.query.filter(User.username == payload["username"], User.id != user_id).first()
    if duplicate:
        return jsonify({"error": "Taki login już istnieje"}), 400
    user.username = payload["username"]
    user.name = payload["name"]
    user.role = payload.get("role", user.role)
    user.driver_id = payload.get("driver_id") or None
    if payload.get("password"):
        user.password_hash = generate_password_hash(payload["password"])
    db.session.commit()
    return jsonify({"ok": True})


@app.post("/api/catalog")
@admin_required
def add_catalog():
    payload = request.get_json(force=True)
    category_id = payload.get("category_id")
    if payload.get("category"):
        category = Category(name=payload["category"])
        db.session.add(category)
        db.session.flush()
        category_id = category.id
    if payload.get("meal") and category_id:
        db.session.add(Meal(category_id=category_id, name=payload["meal"]))
    db.session.commit()
    return jsonify({"ok": True})


@app.post("/api/delivery-status")
@login_required
def set_delivery_status():
    user = current_user()
    payload = request.get_json(force=True)
    if not user_can_access_order(user, payload["order_id"]):
        return jsonify({"error": "Brak dostępu do tej dostawy"}), 403
    status = db.session.get(DeliveryStatus, (payload["date"], payload["order_id"]))
    if not status:
        status = DeliveryStatus(date=payload["date"], order_id=payload["order_id"], status=payload["status"])
        db.session.add(status)
    else:
        status.status = payload["status"]
    db.session.commit()
    return jsonify({"ok": True})


@app.post("/api/default-order")
@login_required
def set_default_order():
    user = current_user()
    payload = request.get_json(force=True)
    driver_id = user.driver_id if user.role == "driver" else int(payload["driver_id"])
    if not db.session.get(Driver, driver_id):
        return jsonify({"error": "Nie znaleziono kierowcy"}), 404
    DriverDefaultOrder.query.filter_by(driver_id=driver_id).delete()
    for position, client_id in enumerate(payload.get("client_ids", [])):
        db.session.add(DriverDefaultOrder(driver_id=driver_id, client_id=int(client_id), position=position))
    db.session.commit()
    return jsonify({"ok": True})


@app.post("/api/driver-notes")
@login_required
def set_driver_note():
    user = current_user()
    payload = request.get_json(force=True)
    driver_id = user.driver_id if user.role == "driver" else payload["driver_id"]
    if not user_can_access_client(user, payload["client_id"]):
        return jsonify({"error": "Brak dostępu do tego klienta"}), 403
    note = db.session.get(DriverClientNote, (driver_id, payload["client_id"]))
    if not note:
        note = DriverClientNote(driver_id=driver_id, client_id=payload["client_id"], note=payload.get("note", ""))
        db.session.add(note)
    else:
        note.note = payload.get("note", "")
    db.session.commit()
    return jsonify({"ok": True})


@app.post("/api/delivery-history/cleanup")
@admin_required
def cleanup_delivery_history():
    payload = request.get_json(force=True)
    date_to = payload.get("date_to")
    if not date_to:
        return jsonify({"error": "Wybierz datę"}), 400
    DeliveryStatus.query.filter(DeliveryStatus.date <= date_to).delete(synchronize_session=False)
    RemovedDelivery.query.filter(RemovedDelivery.date <= date_to).delete(synchronize_session=False)
    db.session.commit()
    return jsonify({"ok": True})


@app.post("/api/removed-deliveries")
@admin_required
def remove_delivery():
    payload = request.get_json(force=True)
    exists = db.session.get(RemovedDelivery, (payload["date"], payload["order_id"]))
    if not exists:
        db.session.add(RemovedDelivery(date=payload["date"], order_id=payload["order_id"]))
        db.session.commit()
    return jsonify({"ok": True})


with app.app_context():
    init_db()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "5000")), debug=True)
