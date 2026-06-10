let state = null;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const dateFmt = new Intl.DateTimeFormat("pl-PL", { weekday: "long", year: "numeric", month: "2-digit", day: "2-digit" });

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Błąd połączenia" }));
    throw new Error(error.error || "Błąd połączenia");
  }
  return response.json();
}

function iso(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function id(value) {
  return Number(value);
}

function byId(rows, rowId) {
  return rows.find((row) => row.id === Number(rowId));
}

function clientById(clientId) {
  return byId(state.clients, clientId);
}

function nameOf(rows, rowId, fallback) {
  return byId(rows, rowId)?.name || fallback;
}

function isAdmin() {
  return state?.current_user?.role === "admin";
}

function activeDriverId() {
  return isAdmin() ? id($("#driverSelect").value) : state.current_user.driver_id;
}

function statusFor(dateText, orderId) {
  return state.statuses.find((row) => row.date === dateText && row.order_id === orderId)?.status || "Do dostarczenia";
}

function removed(dateText, orderId) {
  return state.removed.some((row) => row.date === dateText && row.order_id === orderId);
}

function defaultClientOrder(driverId) {
  return state.default_order
    .filter((row) => row.driver_id === driverId)
    .sort((a, b) => a.position - b.position)
    .map((row) => row.client_id);
}

function appliesOn(order, dateText) {
  const date = new Date(`${dateText}T12:00:00`);
  const weekday = date.getDay();
  const inRange = dateText >= order.start_date && dateText <= order.end_date;
  const daysFromStart = Math.floor((date - new Date(`${order.start_date}T12:00:00`)) / 86400000);
  const interval = Number(order.interval_days || 0);
  const matchesRegular = inRange && order.days.includes(weekday);
  const matchesInterval = inRange && interval > 1 && daysFromStart % interval === 0;
  const matchesCustom = order.custom_dates.includes(dateText);
  return interval > 1 ? matchesInterval || matchesCustom : matchesRegular || matchesCustom;
}

function deliveriesFor(dateText, filters = {}) {
  return state.orders
    .filter((order) => appliesOn(order, dateText))
    .map((order) => ({ order, client: clientById(order.client_id) }))
    .filter(({ client }) => {
      if (!client || !client.active) return false;
      if (filters.region_id && client.region_id !== filters.region_id) return false;
      if (filters.driver_id && client.driver_id !== filters.driver_id) return false;
      return true;
    });
}

function empty() {
  return $("#emptyTemplate").innerHTML;
}

function renderSelects() {
  const regionOptions = state.regions.map((region) => `<option value="${region.id}">${region.name}</option>`).join("");
  const driverOptions = state.drivers.map((driver) => `<option value="${driver.id}">${driver.name}${driver.phone ? ` - ${driver.phone}` : ""}</option>`).join("");
  $("#clientRegion").innerHTML = regionOptions;
  $("#clientRegionFilter").innerHTML = `<option value="all">Wszystkie rejony</option>${regionOptions}`;
  $("#clientDriver").innerHTML = driverOptions;
  $("#driverSelect").innerHTML = driverOptions;
  $("#orderClient").innerHTML = state.clients.filter((client) => client.active).map((client) => `<option value="${client.id}">${client.name}</option>`).join("");
  $("#orderCategory").innerHTML = state.categories.map((category) => `<option value="${category.id}">${category.name}</option>`).join("");
  $("#catalogCategory").innerHTML = state.categories.map((category) => `<option value="${category.id}">${category.name}</option>`).join("");
  renderMealSelect();
}

function renderMealSelect() {
  const categoryId = id($("#orderCategory").value || state.categories[0]?.id);
  $("#orderMeal").innerHTML = state.meals.filter((meal) => meal.category_id === categoryId).map((meal) => `<option value="${meal.id}">${meal.name}</option>`).join("");
}

function renderAccess() {
  $("#loginScreen").classList.add("hidden");
  $("#appShell").classList.remove("hidden");
  $("#currentUserLabel").textContent = isAdmin() ? state.current_user.name : nameOf(state.drivers, state.current_user.driver_id, "Kierowca");
  $$(".admin-only").forEach((node) => node.classList.toggle("hidden", !isAdmin()));
  if (!isAdmin()) openView("driver");
}

function renderDashboard() {
  const tomorrow = iso(addDays(new Date(), 1));
  $("#clientCount").textContent = state.clients.filter((client) => client.active).length;
  $("#planCount").textContent = state.orders.length;
  $("#tomorrowCount").textContent = deliveriesFor(tomorrow).length;
  $("#regionCount").textContent = state.regions.length;
  renderKitchenInto("#dashboardKitchen", tomorrow);
}

function renderClients() {
  const search = $("#clientSearch").value.trim().toLowerCase();
  const regionFilter = $("#clientRegionFilter").value;
  const statusFilter = $("#clientStatusFilter").value;
  const sortMode = $("#clientSort").value;
  const clients = state.clients
    .filter((client) => {
      const matchesSearch = [client.name, client.phone, client.address].join(" ").toLowerCase().includes(search);
      const matchesRegion = regionFilter === "all" || client.region_id === id(regionFilter);
      const matchesStatus = statusFilter === "all" || (statusFilter === "active" ? client.active : !client.active);
      return matchesSearch && matchesRegion && matchesStatus;
    })
    .sort((a, b) => {
      if (sortMode === "region") return nameOf(state.regions, a.region_id, "").localeCompare(nameOf(state.regions, b.region_id, ""), "pl") || a.name.localeCompare(b.name, "pl");
      if (sortMode === "driver") return nameOf(state.drivers, a.driver_id, "").localeCompare(nameOf(state.drivers, b.driver_id, ""), "pl") || a.name.localeCompare(b.name, "pl");
      return a.name.localeCompare(b.name, "pl");
    });
  $("#clientsList").innerHTML = clients.length ? clients.map((client) => `
    <article class="card app-card bg-base-100 border">
      <div class="card-body">
        <div class="flex justify-between gap-2">
          <div><strong>${client.name}</strong><div class="text-sm opacity-70">${client.address}<br>${client.phone || "Brak telefonu"}</div></div>
          <span class="badge ${client.active ? "badge-success" : "badge-error"}">${client.active ? "Aktywny" : "Nieaktywny"}</span>
        </div>
        <div class="text-sm opacity-70">Rejon: ${nameOf(state.regions, client.region_id, "-")} · Kierowca: ${nameOf(state.drivers, client.driver_id, "-")}</div>
        ${client.notes ? `<div class="text-sm">${client.notes}</div>` : ""}
        <div class="flex flex-wrap gap-2">
          <button class="btn btn-outline btn-sm" data-toggle-client="${client.id}">${client.active ? "Oznacz jako nieaktywnego" : "Przywróć"}</button>
          <button class="btn btn-error btn-outline btn-sm" data-delete-client="${client.id}">Usuń</button>
        </div>
      </div>
    </article>
  `).join("") : empty();
}

function kitchenTotals(dateText) {
  const totals = new Map();
  deliveriesFor(dateText).forEach(({ order, client }) => {
    const key = `${client.region_id}|${order.category_id}|${order.meal_id}`;
    const current = totals.get(key) || { region_id: client.region_id, category_id: order.category_id, meal_id: order.meal_id, quantity: 0 };
    current.quantity += Number(order.quantity || 1);
    totals.set(key, current);
  });
  return Array.from(totals.values());
}

function renderKitchenInto(selector, dateText) {
  const totals = kitchenTotals(dateText);
  if (!totals.length) {
    $(selector).innerHTML = empty();
    return;
  }
  const grouped = Object.groupBy ? Object.groupBy(totals, (row) => row.region_id) : totals.reduce((acc, row) => ((acc[row.region_id] ||= []).push(row), acc), {});
  $(selector).innerHTML = Object.entries(grouped).map(([regionId, rows]) => `
    <article class="card app-card bg-base-100 border"><div class="card-body">
      <h3 class="font-bold">${nameOf(state.regions, regionId, "Bez rejonu")}</h3>
      <div>${rows.map((row) => `${nameOf(state.meals, row.meal_id, "-")}: ${row.quantity}`).join(" · ")}</div>
    </div></article>
  `).join("");
}

function renderKitchen() {
  renderKitchenInto("#kitchenReport", $("#kitchenDate").value);
}

function renderOrders() {
  $("#ordersList").innerHTML = state.orders.length ? state.orders.map((order) => {
    const client = clientById(order.client_id);
    const days = Number(order.interval_days || 0) > 1 ? `co ${order.interval_days} dzień` : order.days.length ? order.days.map((day) => ["Nd", "Pon", "Wt", "Śr", "Czw", "Pt", "Sob"][day]).join(", ") : "daty wybrane";
    return `
      <article class="card app-card bg-base-100 border"><div class="card-body">
        <div class="flex justify-between gap-2">
          <strong>${client?.name || "Klient"} - ${nameOf(state.meals, order.meal_id, "-")} x ${order.quantity}</strong>
          <span class="badge">${client ? nameOf(state.regions, client.region_id, "-") : "-"}</span>
        </div>
        <div class="plan-dates">
          <span>${order.start_date} - ${order.end_date}</span>
          <small>${days}${order.custom_dates.length ? ` · Daty: ${order.custom_dates.join(", ")}` : ""}</small>
        </div>
        ${order.notes ? `<div class="plan-notes">${order.notes}</div>` : ""}
        <div><button class="btn btn-error btn-outline btn-sm compact-delete" data-delete-order="${order.id}">Usuń</button></div>
      </div></article>
    `;
  }).join("") : empty();
}

function deliveryWord(count) {
  if (count === 1) return "dostawa";
  if ([2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100)) return "dostawy";
  return "dostaw";
}

function renderDriver() {
  const driverId = activeDriverId();
  const dateText = $("#driverDate").value;
  const savedOrder = defaultClientOrder(driverId);
  if ($("#driverSelect").value !== String(driverId)) $("#driverSelect").value = driverId;
  const entries = deliveriesFor(dateText, { driver_id: driverId })
    .filter(({ order }) => !removed(dateText, order.id))
    .sort((a, b) => {
      const ai = savedOrder.indexOf(a.client.id);
      const bi = savedOrder.indexOf(b.client.id);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi) || a.client.name.localeCompare(b.client.name, "pl");
    });
  $("#driverDeliveryCount").textContent = `${entries.length} ${deliveryWord(entries.length)}`;
  $("#driverList").innerHTML = entries.length ? entries.map(({ order, client }, index) => {
    const status = statusFor(dateText, order.id);
    return `
      <article class="delivery card driver-card bg-base-100 border p-3" draggable="true" data-order-id="${order.id}">
        <div class="driver-order-buttons grid gap-1">
          <button class="mini-order" data-move-delivery="${order.id}" data-move-direction="up">↑</button>
          <button class="mini-order" data-move-delivery="${order.id}" data-move-direction="down">↓</button>
        </div>
        <div>
          <div class="flex justify-between gap-2"><strong class="driver-name">${index + 1}. ${client.name}</strong><span class="badge status-badge ${statusClass(status)}">${status}</span></div>
          <div class="text-sm opacity-70">${client.address}<br>${client.phone || "Brak telefonu"} · ${nameOf(state.meals, order.meal_id, "-")} x ${order.quantity}</div>
          ${(client.notes || order.notes) ? `<div class="text-sm">${[client.notes, order.notes].filter(Boolean).join(" · ")}</div>` : ""}
        </div>
        <div class="delivery-actions">
          <button class="btn btn-outline action-map" data-map="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(client.address)}">Mapa</button>
          <button class="btn ${status === "Do dostarczenia" ? "btn-primary" : "btn-outline"}" data-set-status="${order.id}" data-status-value="Do dostarczenia">Do dostarczenia</button>
          <button class="btn ${status === "Dostarczone" ? "btn-success" : "btn-outline"}" data-set-status="${order.id}" data-status-value="Dostarczone">Dostarczone</button>
          <button class="btn ${status === "Anulowane" ? "btn-error" : "btn-outline"}" data-set-status="${order.id}" data-status-value="Anulowane">Anulowane</button>
          ${isAdmin() && status !== "Do dostarczenia" ? `<button class="btn btn-error btn-outline" data-remove-delivery="${order.id}">Usuń</button>` : ""}
        </div>
      </article>
    `;
  }).join("") : empty();
}

function renderSettings() {
  $("#regionsList").innerHTML = state.regions.map((region) => `<div class="badge">${region.name}</div>`).join("");
  $("#driversList").innerHTML = state.drivers.map((driver) => `<div class="badge">${driver.name}</div>`).join("");
  $("#catalogList").innerHTML = state.categories.map((category) => `<div><strong>${category.name}</strong><br><span class="text-sm opacity-70">${state.meals.filter((meal) => meal.category_id === category.id).map((meal) => meal.name).join(" · ")}</span></div>`).join("");
}

function statusClass(status) {
  if (status === "Dostarczone") return "badge-success";
  if (status === "Anulowane") return "badge-error";
  return "badge-warning";
}

function renderAll() {
  renderSelects();
  renderAccess();
  renderDashboard();
  renderClients();
  renderOrders();
  renderKitchen();
  renderDriver();
  renderSettings();
}

function openView(viewId) {
  if (!isAdmin()) viewId = "driver";
  $$(".tab, .view").forEach((node) => node.classList.remove("tab-active", "active"));
  document.querySelector(`.tab[data-view="${viewId}"]`)?.classList.add("tab-active");
  $(`#${viewId}`).classList.add("active");
}

async function loadState() {
  state = await api("/api/state");
  renderAll();
}

function formData(form) {
  return Object.fromEntries(new FormData(form));
}

function customDates(value) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

async function saveDefaultOrder(orderId, direction) {
  const driverId = activeDriverId();
  const dateText = $("#driverDate").value;
  const entries = deliveriesFor(dateText, { driver_id: driverId }).filter(({ order }) => !removed(dateText, order.id));
  const current = entries.map(({ client }) => client.id);
  const ordered = defaultClientOrder(driverId).filter((clientId) => current.includes(clientId));
  current.forEach((clientId) => {
    if (!ordered.includes(clientId)) ordered.push(clientId);
  });
  const movedClient = entries.find(({ order }) => order.id === id(orderId))?.client.id;
  const from = ordered.indexOf(movedClient);
  const to = direction === "up" ? from - 1 : from + 1;
  if (from === -1 || to < 0 || to >= ordered.length) return;
  ordered.splice(from, 1);
  ordered.splice(to, 0, movedClient);
  await api("/api/default-order", { method: "POST", body: JSON.stringify({ driver_id: driverId, client_ids: ordered }) });
  await loadState();
}

function setDefaults() {
  const today = new Date();
  $("#kitchenDate").value = iso(addDays(today, 1));
  $("#driverDate").value = iso(today);
  $("#orderForm [name='start_date']").value = iso(today);
  $("#orderForm [name='end_date']").value = iso(addDays(today, 30));
}

function bindEvents() {
  $$(".tab").forEach((tab) => tab.addEventListener("click", () => openView(tab.dataset.view)));
  $("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/login", { method: "POST", body: JSON.stringify(formData(event.currentTarget)) });
      await loadState();
    } catch (error) {
      $("#loginMessage").textContent = error.message;
    }
  });
  $("#logoutButton").addEventListener("click", async () => {
    await api("/api/logout", { method: "POST", body: "{}" });
    $("#loginScreen").classList.remove("hidden");
    $("#appShell").classList.add("hidden");
  });
  $("#orderCategory").addEventListener("change", renderMealSelect);
  $("#clientSearch").addEventListener("input", renderClients);
  $("#clientRegionFilter").addEventListener("change", renderClients);
  $("#clientStatusFilter").addEventListener("change", renderClients);
  $("#clientSort").addEventListener("change", renderClients);
  $("#kitchenDate").addEventListener("change", renderKitchen);
  $("#driverSelect").addEventListener("change", renderDriver);
  $("#driverDate").addEventListener("change", renderDriver);
  $("#printKitchen").addEventListener("click", () => window.print());

  $("#clientForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await api("/api/clients", { method: "POST", body: JSON.stringify(formData(event.currentTarget)) });
    event.currentTarget.reset();
    await loadState();
  });
  $("#orderForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await api("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        client_id: id(data.get("client_id")),
        category_id: id(data.get("category_id")),
        meal_id: id(data.get("meal_id")),
        start_date: data.get("start_date"),
        end_date: data.get("end_date"),
        days: data.getAll("days").map(Number),
        interval_days: data.get("every_other_day") ? 2 : 0,
        custom_dates: customDates(data.get("custom_dates") || ""),
        quantity: Number(data.get("quantity") || 1),
        notes: data.get("notes") || ""
      })
    });
    event.currentTarget.reset();
    setDefaults();
    await loadState();
  });
  $("#regionForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await api("/api/regions", { method: "POST", body: JSON.stringify(formData(event.currentTarget)) });
    event.currentTarget.reset();
    await loadState();
  });
  $("#driverForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await api("/api/drivers", { method: "POST", body: JSON.stringify(formData(event.currentTarget)) });
    event.currentTarget.reset();
    await loadState();
  });
  $("#catalogForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await api("/api/catalog", { method: "POST", body: JSON.stringify(formData(event.currentTarget)) });
    event.currentTarget.reset();
    await loadState();
  });

  document.body.addEventListener("click", async (event) => {
    const target = event.target;
    if (target.dataset?.map) window.open(target.dataset.map, "_blank", "noopener");
    if (target.dataset?.moveDelivery) await saveDefaultOrder(target.dataset.moveDelivery, target.dataset.moveDirection);
    if (target.dataset?.setStatus) {
      await api("/api/delivery-status", { method: "POST", body: JSON.stringify({ date: $("#driverDate").value, order_id: id(target.dataset.setStatus), status: target.dataset.statusValue }) });
      await loadState();
    }
    if (target.dataset?.removeDelivery) {
      await api("/api/removed-deliveries", { method: "POST", body: JSON.stringify({ date: $("#driverDate").value, order_id: id(target.dataset.removeDelivery) }) });
      await loadState();
    }
    if (target.dataset?.toggleClient) {
      await api(`/api/clients/${target.dataset.toggleClient}/toggle`, { method: "POST", body: "{}" });
      await loadState();
    }
    if (target.dataset?.deleteClient) {
      await api(`/api/clients/${target.dataset.deleteClient}`, { method: "DELETE" });
      await loadState();
    }
    if (target.dataset?.deleteOrder) {
      await api(`/api/orders/${target.dataset.deleteOrder}`, { method: "DELETE" });
      await loadState();
    }
  });
}

setDefaults();
bindEvents();
loadState().catch(() => {});
