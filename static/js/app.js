let state = null;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const dateFmt = new Intl.DateTimeFormat("pl-PL", { weekday: "long", year: "numeric", month: "2-digit", day: "2-digit" });

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    cache: "no-store",
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

function localDate(dateText) {
  return new Date(`${dateText}T12:00:00`);
}

function daysUntil(dateText) {
  const today = localDate(iso(new Date()));
  const target = localDate(dateText);
  return Math.round((target - today) / 86400000);
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

function escapeAttr(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" }[char]));
}

function clientSearchLabel(client) {
  return [client.name, client.address].filter(Boolean).join(" - ");
}

function orderItems(order) {
  return order.items?.length ? order.items : [{ category_id: order.category_id, meal_id: order.meal_id, quantity: order.quantity }];
}

function mealItemsLabel(items) {
  return items.map((item) => `${nameOf(state.meals, item.meal_id, "-")} x ${item.quantity}`).join(" · ");
}

function normalizeSearch(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+]+/gu, " ")
    .trim();
}

function uniqueRows(rows) {
  return rows.filter((row, index) => rows.findIndex((item) => item.id === row.id) === index);
}

function nameOf(rows, rowId, fallback) {
  return byId(rows, rowId)?.name || fallback;
}

function userForDriver(driverId) {
  return state.users?.find((user) => user.role === "driver" && user.driver_id === Number(driverId));
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

function driverNoteFor(driverId, clientId) {
  return state.driver_notes?.find((row) => row.driver_id === driverId && row.client_id === clientId)?.note || "";
}

function defaultClientOrder(driverId) {
  return state.default_order
    .filter((row) => row.driver_id === driverId)
    .sort((a, b) => a.position - b.position)
    .map((row) => row.client_id);
}

function uniqueClientIds(entries) {
  const ids = [];
  entries.forEach(({ client }) => {
    if (!ids.includes(client.id)) ids.push(client.id);
  });
  return ids;
}

function orderedDriverEntries(driverId, dateText) {
  const savedOrder = defaultClientOrder(driverId);
  return deliveriesFor(dateText, { driver_id: driverId })
    .filter(({ order }) => !removed(dateText, order.id))
    .sort((a, b) => {
      const ai = savedOrder.indexOf(a.client.id);
      const bi = savedOrder.indexOf(b.client.id);
      if (ai === -1 && bi === -1) return a.client.name.localeCompare(b.client.name, "pl");
      if (ai === -1) return -1;
      if (bi === -1) return 1;
      return ai - bi || a.client.name.localeCompare(b.client.name, "pl");
    });
}

function mergeDefaultOrder(driverId, visibleClientIds) {
  const savedOrder = defaultClientOrder(driverId);
  const newClientIds = visibleClientIds.filter((clientId) => !savedOrder.includes(clientId));
  const baseOrder = [...newClientIds, ...savedOrder];
  const visibleSet = new Set(visibleClientIds);
  let visibleIndex = 0;
  const merged = baseOrder.map((clientId) => {
    if (!visibleSet.has(clientId)) return clientId;
    const replacement = visibleClientIds[visibleIndex];
    visibleIndex += 1;
    return replacement;
  });
  visibleClientIds.slice(visibleIndex).forEach((clientId) => merged.push(clientId));
  return merged.filter((clientId, index) => merged.indexOf(clientId) === index);
}

function appliesOn(order, dateText) {
  if ((order.excluded_dates || []).includes(dateText)) return false;
  const date = new Date(`${dateText}T12:00:00`);
  const weekday = date.getDay();
  const inRange = dateText >= order.start_date && dateText <= order.end_date;
  const daysFromStart = Math.floor((date - new Date(`${order.start_date}T12:00:00`)) / 86400000);
  const interval = Number(order.interval_days || 0);
  const matchesRegular = inRange && order.days.includes(weekday);
  const matchesInterval = inRange && interval > 1 && daysFromStart % interval === 0;
  const matchesCustom = (order.custom_dates || []).includes(dateText);
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
  const selectedDriver = $("#driverSelect")?.value;
  const regionOptions = state.regions.map((region) => `<option value="${region.id}">${region.name}</option>`).join("");
  const driverOptions = state.drivers.map((driver) => `<option value="${driver.id}">${driver.name}${driver.phone ? ` - ${driver.phone}` : ""}</option>`).join("");
  $("#clientRegion").innerHTML = regionOptions;
  $("#clientRegionFilter").innerHTML = `<option value="all">Wszystkie rejony</option>${regionOptions}`;
  $("#clientDriver").innerHTML = driverOptions;
  $("#driverSelect").innerHTML = driverOptions;
  if (selectedDriver && state.drivers.some((driver) => String(driver.id) === selectedDriver)) $("#driverSelect").value = selectedDriver;
  $("#orderClientOptions").innerHTML = state.clients
    .filter((client) => client.active)
    .map((client) => `<option value="${escapeAttr(clientSearchLabel(client))}"></option>`)
    .join("");
  $("#catalogCategory").innerHTML = state.categories.map((category) => `<option value="${category.id}">${category.name}</option>`).join("");
  if (!$("#orderItems").children.length) renderOrderItems([{}]);
  renderOrderItemMealSelects();
}

function categoryOptions(selectedId) {
  return state.categories.map((category) => `<option value="${category.id}" ${category.id === Number(selectedId) ? "selected" : ""}>${category.name}</option>`).join("");
}

function mealOptions(categoryId, selectedId) {
  return state.meals
    .filter((meal) => meal.category_id === Number(categoryId))
    .map((meal) => `<option value="${meal.id}" ${meal.id === Number(selectedId) ? "selected" : ""}>${meal.name}</option>`)
    .join("");
}

function renderOrderItemMealSelect(row) {
  const categorySelect = row.querySelector("[data-order-item-category]");
  const mealSelect = row.querySelector("[data-order-item-meal]");
  const previousMeal = mealSelect.value;
  mealSelect.innerHTML = mealOptions(categorySelect.value, previousMeal);
  if (!mealSelect.value) mealSelect.value = state.meals.find((meal) => meal.category_id === Number(categorySelect.value))?.id || "";
}

function renderOrderItemMealSelects() {
  $$("#orderItems .order-item-row").forEach(renderOrderItemMealSelect);
}

function updateOrderItemRemoveButtons() {
  const rows = $$("#orderItems .order-item-row");
  rows.forEach((row) => {
    row.querySelector("[data-remove-order-item]").classList.toggle("hidden", rows.length === 1);
  });
}

function addOrderItemRow(item = {}) {
  const categoryId = item.category_id || state.categories[0]?.id || "";
  const mealId = item.meal_id || state.meals.find((meal) => meal.category_id === Number(categoryId))?.id || "";
  const row = document.createElement("div");
  row.className = "order-item-row";
  row.innerHTML = `
    <label class="form-control">
      <span class="label-text">Kategoria</span>
      <select class="select select-bordered" data-order-item-category required>${categoryOptions(categoryId)}</select>
    </label>
    <label class="form-control">
      <span class="label-text">Pozycja</span>
      <select class="select select-bordered" data-order-item-meal required></select>
    </label>
    <label class="form-control">
      <span class="label-text">Ilość</span>
      <input class="input input-bordered" type="number" min="1" value="${Number(item.quantity || 1)}" data-order-item-quantity required />
    </label>
    <button class="btn btn-error btn-outline btn-sm order-item-remove" type="button" data-remove-order-item>Usuń</button>
  `;
  $("#orderItems").appendChild(row);
  renderOrderItemMealSelect(row);
  row.querySelector("[data-order-item-meal]").value = mealId;
  updateOrderItemRemoveButtons();
}

function renderOrderItems(items = [{}]) {
  $("#orderItems").innerHTML = "";
  (items.length ? items : [{}]).forEach(addOrderItemRow);
  updateOrderItemRemoveButtons();
}

function syncClientDriverToRegion() {
  const region = byId(state.regions, $("#clientRegion").value);
  if (region?.driver_id) $("#clientDriver").value = region.driver_id;
}

function findOrderClientFromSearch() {
  const value = normalizeSearch($("#orderClientSearch").value);
  if (!value) return null;
  const activeClients = state.clients.filter((row) => row.active);
  const exact = activeClients.filter((row) => [clientSearchLabel(row), row.name, row.phone].some((field) => normalizeSearch(field) === value));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const startsWith = activeClients.filter((row) => [clientSearchLabel(row), row.name].some((field) => normalizeSearch(field).startsWith(value)));
  if (startsWith.length === 1) return startsWith[0];
  const contains = activeClients.filter((row) => [clientSearchLabel(row), row.name, row.phone, row.address].some((field) => normalizeSearch(field).includes(value)));
  const unique = uniqueRows(contains);
  return unique.length === 1 ? unique[0] : null;
}

function syncOrderClientFromSearch() {
  const client = findOrderClientFromSearch();
  $("#orderClient").value = client?.id || "";
  return client;
}

function finalizeOrderClientSearch() {
  const client = syncOrderClientFromSearch();
  if (client) setOrderClient(client.id);
}

function setOrderClient(clientId) {
  const client = clientById(clientId);
  $("#orderClient").value = client?.id || "";
  $("#orderClientSearch").value = client ? clientSearchLabel(client) : "";
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
  $("#planCount").textContent = state.orders.filter((order) => clientById(order.client_id)?.active).length;
  $("#tomorrowCount").textContent = deliveriesFor(tomorrow).length;
  $("#regionCount").textContent = state.regions.length;
  renderKitchenInto("#dashboardKitchen", tomorrow);
  renderExpiringPlans();
}

function renderExpiringPlans() {
  const expiring = state.orders
    .map((order) => ({ order, client: clientById(order.client_id), daysLeft: daysUntil(order.end_date) }))
    .filter(({ client, daysLeft }) => client?.active && daysLeft >= 0 && daysLeft <= 3)
    .sort((a, b) => a.daysLeft - b.daysLeft || a.client.name.localeCompare(b.client.name, "pl"));

  $("#expiringPlans").innerHTML = expiring.length ? expiring.map(({ order, client, daysLeft }) => {
    const leftText = daysLeft === 0 ? "kończy się dzisiaj" : daysLeft === 1 ? "został 1 dzień" : `zostały ${daysLeft} dni`;
    return `
      <article class="expiring-plan">
        <div>
          <strong>${client.name}</strong>
          <div class="text-sm opacity-70">${mealItemsLabel(orderItems(order))}</div>
        </div>
        <div class="expiring-plan-meta">
          <span>${leftText}</span>
          <span>${order.end_date}</span>
        </div>
      </article>
    `;
  }).join("") : `<div class="alert">Brak planów kończących się w ciągu 3 dni.</div>`;
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
    <article class="client-row bg-base-100 border">
      <div class="client-row-main">
        <div><strong>${client.name}</strong><div class="text-sm opacity-70">${client.address}</div></div>
        <span class="badge ${client.active ? "badge-success" : "badge-error"}">${client.active ? "Aktywny" : "Nieaktywny"}</span>
      </div>
      <div class="client-row-meta">
        <span>${client.phone || "Brak telefonu"}</span>
        <span>Rejon: ${nameOf(state.regions, client.region_id, "-")}</span>
        <span>Kierowca: ${nameOf(state.drivers, client.driver_id, "-")}</span>
      </div>
      ${client.notes ? `<div class="text-sm">${client.notes}</div>` : ""}
      <div class="client-row-actions">
        <button class="btn btn-outline btn-sm" data-edit-client="${client.id}">Edytuj</button>
        <button class="btn btn-outline btn-sm" data-toggle-client="${client.id}">${client.active ? "Nieaktywny" : "Przywróć"}</button>
        <button class="btn btn-error btn-outline btn-sm" data-delete-client="${client.id}">Usuń</button>
      </div>
    </article>
  `).join("") : empty();
}

function kitchenTotals(dateText) {
  const totals = new Map();
  deliveriesFor(dateText).forEach(({ order, client }) => {
    orderItems(order).forEach((item) => {
      const key = `${client.region_id}|${item.category_id}|${item.meal_id}`;
      const current = totals.get(key) || { region_id: client.region_id, category_id: item.category_id, meal_id: item.meal_id, quantity: 0 };
      current.quantity += Number(item.quantity || 1);
      totals.set(key, current);
    });
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
  const dateText = $("#kitchenDate").value;
  $("#kitchenPrintDate").textContent = dateText;
  renderKitchenInto("#kitchenReport", dateText);
}

function renderOrders() {
  const search = ($("#orderSearch")?.value || "").trim().toLowerCase();
  const endedCount = state.orders.filter((order) => order.end_date < iso(new Date())).length;
  $("#deleteEndedOrders").disabled = endedCount === 0;
  $("#deleteEndedOrders").title = endedCount ? `Zakończone plany: ${endedCount}` : "Brak zakończonych planów";
  const orders = state.orders.filter((order) => {
    const client = clientById(order.client_id);
    return !search || (client?.name || "").toLowerCase().includes(search);
  });
  $("#ordersList").innerHTML = orders.length ? orders.map((order) => {
    const client = clientById(order.client_id);
    const items = orderItems(order);
    const suspended = !client?.active;
    const days = Number(order.interval_days || 0) > 1 ? `co ${order.interval_days} dzień` : order.days.length ? order.days.map((day) => ["Nd", "Pon", "Wt", "Śr", "Czw", "Pt", "Sob"][day]).join(", ") : "daty wybrane";
    return `
      <article class="card app-card bg-base-100 border"><div class="card-body">
        <div class="flex justify-between gap-2">
          <strong>${client?.name || "Klient"} - ${mealItemsLabel(items)}</strong>
          <div class="flex flex-wrap gap-2">
            ${suspended ? `<span class="badge badge-error">Plan zawieszony</span>` : `<span class="badge badge-success">Plan aktywny</span>`}
            <span class="badge">${client ? nameOf(state.regions, client.region_id, "-") : "-"}</span>
          </div>
        </div>
        <div class="plan-dates">
          <span>${order.start_date} - ${order.end_date}</span>
          <small>${days}${order.custom_dates.length ? ` · Daty: ${order.custom_dates.join(", ")}` : ""}${(order.excluded_dates || []).length ? ` · Bez obiadu: ${order.excluded_dates.join(", ")}` : ""}</small>
        </div>
        ${order.notes ? `<div class="plan-notes">${order.notes}</div>` : ""}
        <div class="flex flex-wrap gap-2">
          <button class="btn btn-outline btn-sm" data-edit-order="${order.id}">Edytuj</button>
          <button class="btn btn-error btn-outline btn-sm compact-delete" data-delete-order="${order.id}">Usuń</button>
        </div>
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
  if ($("#driverSelect").value !== String(driverId)) $("#driverSelect").value = driverId;
  const entries = orderedDriverEntries(driverId, dateText);
  $("#driverDeliveryCount").textContent = `${entries.length} ${deliveryWord(entries.length)}`;
  $("#driverList").innerHTML = entries.length ? entries.map(({ order, client }, index) => {
    const status = statusFor(dateText, order.id);
    const phoneHref = (client.phone || "").replace(/[^\d+]/g, "");
    const note = driverNoteFor(driverId, client.id);
    return `
      <article class="delivery card driver-card bg-base-100 border p-3" draggable="true" data-order-id="${order.id}">
        <div class="driver-order-buttons grid gap-1">
          <label class="route-position-control">
            <span>Nr</span>
            <input class="input input-bordered input-sm route-position-input" type="number" min="1" max="${entries.length}" value="${index + 1}" data-order-position="${order.id}" aria-label="Numer kolejności" />
          </label>
          <button class="mini-order" data-move-delivery="${order.id}" data-move-direction="up">↑</button>
          <button class="mini-order" data-move-delivery="${order.id}" data-move-direction="down">↓</button>
        </div>
        <div class="driver-delivery-info">
          <div class="flex justify-between gap-2"><strong class="driver-name">${index + 1}. ${client.name}</strong><span class="badge status-badge ${statusClass(status)}">${status}</span></div>
          <div class="driver-address-line">
            <span class="driver-address">${client.address}</span>
            <button class="btn btn-xs btn-outline action-map" data-map="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(client.address)}">Mapa</button>
          </div>
          <div class="driver-phone-line">
            <span>${client.phone || "Brak telefonu"}</span>
            ${phoneHref ? `<a class="btn btn-xs btn-outline" href="tel:${phoneHref}">Dzwoń</a>` : ""}
          </div>
          <div class="driver-meal-list">
            ${orderItems(order).map((item) => `<div class="driver-meal"><strong>${nameOf(state.meals, item.meal_id, "-")}</strong><span>x ${item.quantity}</span></div>`).join("")}
          </div>
          ${(client.notes || order.notes) ? `<div class="text-sm">${[client.notes, order.notes].filter(Boolean).join(" · ")}</div>` : ""}
          <textarea class="textarea textarea-bordered driver-note" data-driver-note-client="${client.id}" placeholder="Notatka kierowcy">${note}</textarea>
        </div>
        <div class="delivery-actions">
          <button class="btn status-action ${status === "Do dostarczenia" ? "btn-warning" : "btn-outline"}" title="Do dostarczenia" data-set-status="${order.id}" data-status-value="Do dostarczenia">○</button>
          <button class="btn status-action ${status === "Dostarczone" ? "btn-success" : "btn-outline"}" title="Dostarczone" data-set-status="${order.id}" data-status-value="Dostarczone">✓</button>
          <button class="btn status-action ${status === "Anulowane" ? "btn-error" : "btn-outline"}" title="Anulowane" data-set-status="${order.id}" data-status-value="Anulowane">×</button>
          ${isAdmin() && status !== "Do dostarczenia" ? `<button class="btn btn-error btn-outline" data-remove-delivery="${order.id}">Usuń</button>` : ""}
        </div>
      </article>
    `;
  }).join("") : empty();
}

function renderSettings() {
  $("#regionsList").innerHTML = state.regions.map((region) => `
    <div class="settings-row region-assign-row">
      <span><strong>${region.name}</strong></span>
      <div class="region-assign-controls">
        <select class="select select-bordered select-sm" data-region-driver="${region.id}">
          ${state.drivers.map((driver) => `<option value="${driver.id}" ${driver.id === (region.driver_id || state.drivers[0]?.id) ? "selected" : ""}>${driver.name}</option>`).join("")}
        </select>
        <button class="btn btn-xs btn-outline" data-assign-region="${region.id}">Przypisz kierowcę</button>
        <button class="btn btn-xs btn-outline" data-edit-region="${region.id}">Edytuj</button>
        <button class="btn btn-xs btn-error btn-outline" data-delete-region="${region.id}">Usuń</button>
      </div>
    </div>
  `).join("");
  $("#driversList").innerHTML = state.drivers.map((driver) => {
    const user = userForDriver(driver.id);
    return `
      <div class="settings-row">
        <span><strong>${driver.name}</strong>${driver.phone ? ` · ${driver.phone}` : ""} · login: ${user?.username || "brak"}</span>
        <div class="settings-actions">
          <button class="btn btn-xs btn-outline" data-edit-driver="${driver.id}">Edytuj</button>
          <button class="btn btn-xs btn-error btn-outline" data-delete-driver="${driver.id}">Usuń</button>
        </div>
      </div>
    `;
  }).join("");
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

function orderPayload(form) {
  const data = new FormData(form);
  const items = $$("#orderItems .order-item-row").map((row) => ({
    category_id: id(row.querySelector("[data-order-item-category]").value),
    meal_id: id(row.querySelector("[data-order-item-meal]").value),
    quantity: Number(row.querySelector("[data-order-item-quantity]").value || 1)
  }));
  const firstItem = items[0] || {};
  return {
    client_id: id(data.get("client_id")),
    category_id: firstItem.category_id,
    meal_id: firstItem.meal_id,
    start_date: data.get("start_date"),
    end_date: data.get("end_date"),
    days: data.getAll("days").map(Number),
    interval_days: data.get("every_other_day") ? 2 : 0,
    custom_dates: customDates(data.get("custom_dates") || ""),
    excluded_dates: customDates(data.get("excluded_dates") || ""),
    quantity: firstItem.quantity || 1,
    items,
    notes: data.get("notes") || ""
  };
}

async function saveDefaultOrder(orderId, direction) {
  const driverId = activeDriverId();
  const dateText = $("#driverDate").value;
  const entries = orderedDriverEntries(driverId, dateText);
  const ordered = uniqueClientIds(entries);
  const movedClient = entries.find(({ order }) => order.id === id(orderId))?.client.id;
  const from = ordered.indexOf(movedClient);
  const to = direction === "up" ? from - 1 : from + 1;
  if (from === -1 || to < 0 || to >= ordered.length) return;
  ordered.splice(from, 1);
  ordered.splice(to, 0, movedClient);
  await api("/api/default-order", { method: "POST", body: JSON.stringify({ driver_id: driverId, client_ids: mergeDefaultOrder(driverId, ordered) }) });
  await loadState();
}

async function saveDefaultOrderPosition(orderId, position) {
  const driverId = activeDriverId();
  const dateText = $("#driverDate").value;
  const entries = orderedDriverEntries(driverId, dateText);
  const ordered = uniqueClientIds(entries);
  const movedClient = entries.find(({ order }) => order.id === id(orderId))?.client.id;
  const from = ordered.indexOf(movedClient);
  const to = Math.max(0, Math.min(Number(position) - 1, ordered.length - 1));
  if (from === -1 || Number.isNaN(to) || from === to) {
    renderDriver();
    return;
  }
  ordered.splice(from, 1);
  ordered.splice(to, 0, movedClient);
  await api("/api/default-order", { method: "POST", body: JSON.stringify({ driver_id: driverId, client_ids: mergeDefaultOrder(driverId, ordered) }) });
  await loadState();
}

function setDefaults() {
  const today = new Date();
  $("#kitchenDate").value = iso(addDays(today, 1));
  $("#driverDate").value = iso(today);
  $("#cleanupDate").value = iso(today);
  $("#orderForm [name='start_date']").value = iso(today);
  $("#orderForm [name='end_date']").value = iso(addDays(today, 30));
}

function resetClientForm() {
  $("#clientForm").reset();
  $("#clientForm [name='id']").value = "";
  $("#clientForm [name='active']").value = "true";
  $("#clientFormTitle").textContent = "Dodaj klienta";
  $("#clientSubmitButton").textContent = "Dodaj klienta";
  $("#clientCancelEdit").classList.add("hidden");
}

function resetOrderForm() {
  $("#orderForm").reset();
  $("#orderForm [name='id']").value = "";
  $("#orderClient").value = "";
  $("#orderFormMessage").textContent = "";
  renderOrderItems([{}]);
  $$(`#orderForm [name='days']`).forEach((box) => {
    box.checked = ["1", "2", "3", "4", "5"].includes(box.value);
  });
  setDefaults();
  $("#orderSubmitButton").textContent = "Dodaj plan";
  $("#orderCancelEdit").classList.add("hidden");
}

function resetDriverForm() {
  $("#driverForm").reset();
  $("#driverForm [name='driver_id']").value = "";
  $("#driverForm [name='user_id']").value = "";
  $("#driverFormTitle").textContent = "Kierowcy";
  $("#driverSubmitButton").textContent = "Dodaj kierowcę";
  $("#driverCancelEdit").classList.add("hidden");
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
  $("#clientRegion").addEventListener("change", syncClientDriverToRegion);
  $("#clientSearch").addEventListener("input", renderClients);
  $("#clientRegionFilter").addEventListener("change", renderClients);
  $("#clientStatusFilter").addEventListener("change", renderClients);
  $("#clientSort").addEventListener("change", renderClients);
  $("#orderClientSearch").addEventListener("input", syncOrderClientFromSearch);
  $("#orderClientSearch").addEventListener("change", finalizeOrderClientSearch);
  $("#orderSearch").addEventListener("input", renderOrders);
  $("#kitchenDate").addEventListener("change", renderKitchen);
  $("#driverSelect").addEventListener("change", renderDriver);
  $("#driverDate").addEventListener("change", renderDriver);
  $("#printKitchen").addEventListener("click", () => window.print());
  $("#clientCancelEdit").addEventListener("click", resetClientForm);
  $("#orderCancelEdit").addEventListener("click", resetOrderForm);
  $("#driverCancelEdit").addEventListener("click", resetDriverForm);
  $("#addOrderItem").addEventListener("click", () => addOrderItemRow({}));
  $("#deleteEndedOrders").addEventListener("click", async () => {
    const endedCount = state.orders.filter((order) => order.end_date < iso(new Date())).length;
    if (!endedCount) return;
    if (!confirm(`Czy na pewno usunąć wszystkie zakończone plany (${endedCount})? Tej operacji nie można cofnąć.`)) return;
    const result = await api("/api/orders/cleanup-ended", { method: "POST", body: "{}" });
    await loadState();
    alert(`Usunięto zakończone plany: ${result.deleted}.`);
  });
  $("#cleanupDeliveries").addEventListener("click", async () => {
    const dateTo = $("#cleanupDate").value;
    if (!dateTo) return;
    if (!confirm(`Usunąć historię dostaw do dnia ${dateTo}?`)) return;
    await api("/api/delivery-history/cleanup", { method: "POST", body: JSON.stringify({ date_to: dateTo }) });
    await loadState();
  });

  $("#clientForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = formData(event.currentTarget);
    payload.region_id = id(payload.region_id);
    payload.driver_id = id(payload.driver_id);
    payload.active = payload.active === "true";
    const clientId = payload.id;
    delete payload.id;
    await api(clientId ? `/api/clients/${clientId}` : "/api/clients", { method: clientId ? "PUT" : "POST", body: JSON.stringify(payload) });
    resetClientForm();
    await loadState();
  });
  $("#orderForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const selectedClient = syncOrderClientFromSearch();
    if (!selectedClient) {
      alert("Wybierz klienta z listy podpowiedzi albo wpisz nazwę tak, żeby pasowała tylko do jednego klienta.");
      $("#orderClientSearch").focus();
      return;
    }
    setOrderClient(selectedClient.id);
    const orderId = event.currentTarget.elements.id.value;
    await api(orderId ? `/api/orders/${orderId}` : "/api/orders", { method: orderId ? "PUT" : "POST", body: JSON.stringify(orderPayload(event.currentTarget)) });
    resetOrderForm();
    await loadState();
    $("#orderFormMessage").textContent = orderId ? "Plan został zapisany." : "Plan został dodany.";
  });
  $("#regionForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await api("/api/regions", { method: "POST", body: JSON.stringify(formData(event.currentTarget)) });
    event.currentTarget.reset();
    await loadState();
    openView("settings");
  });
  $("#driverForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = formData(event.currentTarget);
    const driverId = payload.driver_id;
    delete payload.driver_id;
    delete payload.user_id;
    if (!driverId && !payload.password) {
      alert("Podaj hasło dla nowego kierowcy.");
      return;
    }
    await api(driverId ? `/api/drivers/${driverId}` : "/api/drivers", { method: driverId ? "PUT" : "POST", body: JSON.stringify(payload) });
    resetDriverForm();
    await loadState();
  });
  $("#adminPasswordForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = formData(event.currentTarget);
    if (payload.new_password !== payload.repeat_password) {
      $("#adminPasswordMessage").textContent = "Nowe hasła nie są takie same.";
      return;
    }
    try {
      await api("/api/admin-password", { method: "POST", body: JSON.stringify(payload) });
      event.currentTarget.reset();
      $("#adminPasswordMessage").textContent = "Hasło administratora zostało zmienione.";
    } catch (error) {
      $("#adminPasswordMessage").textContent = error.message;
    }
  });
  $("#catalogForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await api("/api/catalog", { method: "POST", body: JSON.stringify(formData(event.currentTarget)) });
    event.currentTarget.reset();
    await loadState();
  });

  document.body.addEventListener("click", async (event) => {
    const target = event.target;
    if ("removeOrderItem" in target.dataset) {
      target.closest(".order-item-row")?.remove();
      updateOrderItemRemoveButtons();
      return;
    }
    if (target.dataset?.map) window.open(target.dataset.map, "_blank", "noopener");
    if (target.dataset?.moveDelivery) await saveDefaultOrder(target.dataset.moveDelivery, target.dataset.moveDirection);
    if (target.dataset?.assignRegion) {
      const regionId = target.dataset.assignRegion;
      const driverId = document.querySelector(`[data-region-driver="${regionId}"]`).value;
      await api(`/api/regions/${regionId}/assign-driver`, { method: "POST", body: JSON.stringify({ driver_id: id(driverId) }) });
      await loadState();
    }
    if (target.dataset?.editRegion) {
      const region = byId(state.regions, target.dataset.editRegion);
      const name = prompt("Nazwa rejonu", region.name);
      if (name === null) return;
      try {
        await api(`/api/regions/${region.id}`, { method: "PUT", body: JSON.stringify({ name }) });
        await loadState();
      } catch (error) {
        alert(error.message);
      }
    }
    if (target.dataset?.deleteRegion) {
      const region = byId(state.regions, target.dataset.deleteRegion);
      if (!confirm(`Usunąć rejon "${region.name}"?`)) return;
      try {
        await api(`/api/regions/${region.id}`, { method: "DELETE" });
        await loadState();
      } catch (error) {
        alert(error.message);
      }
    }
    if (target.dataset?.editClient) {
      const client = byId(state.clients, target.dataset.editClient);
      const form = $("#clientForm");
      form.elements.id.value = client.id;
      form.elements.name.value = client.name;
      form.elements.phone.value = client.phone;
      form.elements.address.value = client.address;
      form.elements.region_id.value = client.region_id;
      form.elements.driver_id.value = client.driver_id;
      form.elements.active.value = String(client.active);
      form.elements.notes.value = client.notes;
      $("#clientFormTitle").textContent = "Edytuj klienta";
      $("#clientSubmitButton").textContent = "Zapisz zmiany";
      $("#clientCancelEdit").classList.remove("hidden");
      form.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    if (target.dataset?.editOrder) {
      const order = byId(state.orders, target.dataset.editOrder);
      const form = $("#orderForm");
      form.elements.id.value = order.id;
      setOrderClient(order.client_id);
      renderOrderItems(orderItems(order));
      form.elements.start_date.value = order.start_date;
      form.elements.end_date.value = order.end_date;
      form.elements.every_other_day.checked = Number(order.interval_days || 0) > 1;
      $$(`#orderForm [name='days']`).forEach((box) => { box.checked = order.days.includes(Number(box.value)); });
      form.elements.custom_dates.value = (order.custom_dates || []).join(", ");
      form.elements.excluded_dates.value = (order.excluded_dates || []).join(", ");
      form.elements.notes.value = order.notes;
      $("#orderSubmitButton").textContent = "Zapisz plan";
      $("#orderCancelEdit").classList.remove("hidden");
      $("#orderFormMessage").textContent = "";
      form.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    if (target.dataset?.editDriver) {
      const driver = byId(state.drivers, target.dataset.editDriver);
      const user = userForDriver(driver.id);
      const form = $("#driverForm");
      form.elements.driver_id.value = driver.id;
      form.elements.user_id.value = user?.id || "";
      form.elements.name.value = driver.name;
      form.elements.phone.value = driver.phone || "";
      form.elements.username.value = user?.username || "";
      form.elements.password.value = "";
      $("#driverFormTitle").textContent = "Edytuj kierowcę";
      $("#driverSubmitButton").textContent = "Zapisz kierowcę";
      $("#driverCancelEdit").classList.remove("hidden");
      $("#driverFormTitle").scrollIntoView({ behavior: "smooth", block: "center" });
    }
    if (target.dataset?.deleteDriver) {
      const driver = byId(state.drivers, target.dataset.deleteDriver);
      if (!confirm(`Usunąć kierowcę "${driver.name}" razem z jego kontem logowania?`)) return;
      try {
        await api(`/api/drivers/${driver.id}`, { method: "DELETE" });
        await loadState();
      } catch (error) {
        alert(error.message);
      }
    }
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
      const client = byId(state.clients, target.dataset.deleteClient);
      if (!confirm(`Czy na pewno usunąć klienta "${client?.name || "wybranego klienta"}"?`)) return;
      await api(`/api/clients/${target.dataset.deleteClient}`, { method: "DELETE" });
      await loadState();
    }
    if (target.dataset?.deleteOrder) {
      const order = byId(state.orders, target.dataset.deleteOrder);
      const client = order ? clientById(order.client_id) : null;
      const meal = order ? mealItemsLabel(orderItems(order)) : "plan";
      if (!confirm(`Czy na pewno usunąć plan: ${client?.name || "Klient"} - ${meal}?`)) return;
      await api(`/api/orders/${target.dataset.deleteOrder}`, { method: "DELETE" });
      await loadState();
    }
  });

  document.body.addEventListener("change", async (event) => {
    const target = event.target;
    if ("orderItemCategory" in target.dataset) {
      renderOrderItemMealSelect(target.closest(".order-item-row"));
    }
    if (target.dataset?.orderPosition) {
      await saveDefaultOrderPosition(target.dataset.orderPosition, target.value);
    }
    if (target.dataset?.driverNoteClient) {
      await api("/api/driver-notes", {
        method: "POST",
        body: JSON.stringify({ driver_id: activeDriverId(), client_id: id(target.dataset.driverNoteClient), note: target.value })
      });
      state.driver_notes = state.driver_notes.filter((row) => !(row.driver_id === activeDriverId() && row.client_id === id(target.dataset.driverNoteClient)));
      state.driver_notes.push({ driver_id: activeDriverId(), client_id: id(target.dataset.driverNoteClient), note: target.value });
    }
  });
}

setDefaults();
bindEvents();
loadState().catch(() => {});
