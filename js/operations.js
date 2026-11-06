/* CampusFix operations desk: booking review, inventory, and preventive maintenance. */
(function () {
    "use strict";

    const App = window.CampusFix;
    const I18N = window.CampusFixI18n;
    const Shell = window.CampusFixShell;

    if (!App || !I18N || !Shell) {
        return;
    }

    const SECTIONS = ["bookings", "inventory", "maintenance"];
    const PAGE_SIZE = 15;
    const SEARCH_DELAY = 300;
    const BOOKING_STATUSES = [
        "Pending",
        "Approved",
        "Rejected",
        "Cancelled",
        "Completed"
    ];
    const MAINTENANCE_STATUSES = [
        "Scheduled",
        "In Progress",
        "Completed",
        "Cancelled"
    ];
    const FREQUENCIES = [
        "once",
        "daily",
        "weekly",
        "monthly",
        "quarterly",
        "yearly"
    ];
    const REASONS = [
        "restock",
        "issue",
        "return",
        "adjustment",
        "write_off"
    ];

    const container = document.getElementById("adminOperations");

    const state = {
        user: null,
        isAdmin: false,
        canManage: false,
        section: "bookings",
        departments: [],
        departmentsLoaded: false,
        staff: [],
        staffLoaded: false,
        configPromise: null,
        bookings: {
            items: [],
            pagination: null,
            page: 1,
            status: "",
            search: "",
            loading: false,
            loaded: false,
            error: false,
            timer: null
        },
        inventory: {
            items: [],
            pagination: null,
            summary: { total: 0, lowStock: 0, outOfStock: 0 },
            page: 1,
            search: "",
            lowOnly: false,
            loading: false,
            loaded: false,
            error: false,
            timer: null
        },
        maintenance: {
            tasks: [],
            pagination: null,
            summary: { total: 0, overdue: 0, dueSoon: 0 },
            page: 1,
            search: "",
            status: "",
            overdue: false,
            dueSoon: false,
            loading: false,
            loaded: false,
            error: false,
            timer: null
        }
    };

    let elements = null;
    let bound = false;

    const escape = App.escapeHTML;
    const icon = (name) => App.icon(name);
    const t = (key, vars) => I18N.t(key, vars);
    const count = (value) => I18N.formatNumber(value);

    /* Shared helpers ------------------------------------------------------- */

    function pad(value) {
        return String(value).padStart(2, "0");
    }

    function toLocalInput(value) {
        const date = value instanceof Date ? value : new Date(value);

        if (Number.isNaN(date.getTime())) {
            return "";
        }

        return (
            date.getFullYear() +
            "-" +
            pad(date.getMonth() + 1) +
            "-" +
            pad(date.getDate()) +
            "T" +
            pad(date.getHours()) +
            ":" +
            pad(date.getMinutes())
        );
    }

    function defaultDueDate() {
        const date = new Date();
        date.setDate(date.getDate() + 7);
        date.setHours(9, 0, 0, 0);
        return date;
    }

    function bookingStatusTone(status) {
        return {
            Pending: "pending",
            Approved: "resolved",
            Rejected: "rejected",
            Cancelled: "neutral",
            Completed: "assigned"
        }[status] || "neutral";
    }

    function maintenanceStatusTone(status) {
        return {
            Scheduled: "assigned",
            "In Progress": "progress",
            Completed: "resolved",
            Cancelled: "neutral"
        }[status] || "neutral";
    }

    function statusBadge(label, tone) {
        return (
            '<span class="badge" data-tone="' +
            escape(tone) +
            '"><span class="badge-dot"></span>' +
            escape(label) +
            "</span>"
        );
    }

    function bookingBadge(status) {
        return statusBadge(
            t("bookingStatus." + status),
            bookingStatusTone(status)
        );
    }

    function maintenanceBadge(status) {
        return statusBadge(
            t("maintenanceStatus." + status),
            maintenanceStatusTone(status)
        );
    }

    function canReviewBooking(booking) {
        if (state.isAdmin) {
            return true;
        }

        return Boolean(
            state.user.role === "department_manager" &&
                state.user.departmentId &&
                booking.facility &&
                booking.facility.departmentId === state.user.departmentId
        );
    }

    function canHandleTask(task) {
        if (state.canManage) {
            return true;
        }

        return Boolean(
            task.assignedTo && task.assignedTo.id === state.user.id
        );
    }

    function skeletonRows(columns, rows) {
        let markup = "";

        for (let index = 0; index < rows; index += 1) {
            let cells = "";

            for (let cell = 0; cell < columns; cell += 1) {
                cells +=
                    '<td><span class="skeleton skeleton-line" style="width:' +
                    (52 + ((index + cell) % 4) * 11) +
                    '%"></span></td>';
            }

            markup += "<tr aria-hidden=\"true\">" + cells + "</tr>";
        }

        return '<div class="table-wrap"><table class="table"><tbody>' +
            markup +
            "</tbody></table></div>";
    }

    function errorMarkup(message, retry) {
        return (
            '<div class="error-state"><span aria-hidden="true">' +
            icon("alert-circle") +
            "</span><div><strong>" +
            escape(t("common.errorTitle")) +
            "</strong><p>" +
            escape(message) +
            '</p><button type="button" class="btn btn-secondary btn-sm" data-ops-retry="' +
            escape(retry) +
            '" style="margin-top:9px">' +
            escape(t("common.retry")) +
            "</button></div></div>"
        );
    }

    function emptyMarkup(iconName, title, body) {
        return (
            '<div class="empty-state"><span class="empty-icon">' +
            icon(iconName) +
            "</span><h3>" +
            escape(title) +
            "</h3><p>" +
            escape(body) +
            "</p></div>"
        );
    }

    function paginationMarkup(kind, pagination) {
        if (!pagination || !pagination.total) {
            return "";
        }

        const from = (pagination.page - 1) * pagination.pageSize + 1;
        const to = Math.min(
            pagination.page * pagination.pageSize,
            pagination.total
        );
        const pages = pagination.totalPages || 1;

        return (
            '<div class="pagination"><span>' +
            escape(
                t("common.showing", {
                    from: count(from),
                    to: count(to),
                    total: count(pagination.total)
                })
            ) +
            '</span><div class="pagination-buttons">' +
            '<button type="button" class="page-btn" data-ops-page="' +
            (pagination.page - 1) +
            '" data-ops-kind="' +
            kind +
            '" aria-label="' +
            escape(t("common.previous")) +
            '"' +
            (pagination.page <= 1 ? " disabled" : "") +
            ">" +
            icon("chevron-left") +
            "</button>" +
            '<span class="page-btn is-current" aria-current="page">' +
            escape(count(pagination.page)) +
            " / " +
            escape(count(pages)) +
            "</span>" +
            '<button type="button" class="page-btn" data-ops-page="' +
            (pagination.page + 1) +
            '" data-ops-kind="' +
            kind +
            '" aria-label="' +
            escape(t("common.next")) +
            '"' +
            (pagination.page >= pages ? " disabled" : "") +
            ">" +
            icon("chevron-right") +
            "</button></div></div>"
        );
    }

    function metric(label, value, tone, iconName) {
        return (
            '<div class="panel ops-metric" data-tone="' +
            escape(tone) +
            '"><span class="ops-metric-icon" aria-hidden="true">' +
            icon(iconName) +
            '</span><div><span class="ops-metric-label">' +
            escape(label) +
            '</span><strong class="ops-metric-value">' +
            escape(count(value)) +
            "</strong></div></div>"
        );
    }

    function fieldErrorMarkup(input, message) {
        App.fieldError(input, message);
    }

    function applyServerErrors(form, error) {
        App.clearFieldErrors(form);

        const issues = (error && error.errors) || [];
        let shown = 0;

        issues.forEach((issue) => {
            const name = String(issue.path || "").split(".")[0];
            const input = name ? form.elements.namedItem(name) : null;

            if (
                input &&
                typeof input.setAttribute === "function" &&
                input.closest
            ) {
                fieldErrorMarkup(
                    input,
                    issue.message || t("common.requiredField")
                );
                shown += 1;
            }
        });

        if (!shown) {
            App.toast(
                issues.length && issues[0].message
                    ? issues[0].message
                    : App.friendlyError(error),
                "error"
            );
        }
    }

    function departmentOptions(selectedId) {
        return state.departments
            .map((department) => {
                return (
                    '<option value="' +
                    escape(department.id) +
                    '"' +
                    (department.id === selectedId ? " selected" : "") +
                    ">" +
                    escape(department.name) +
                    "</option>"
                );
            })
            .join("");
    }

    function staffOptions(selectedId, departmentId) {
        return state.staff
            .filter((person) => {
                if (!departmentId) {
                    return true;
                }

                return (
                    !person.departmentId ||
                    person.departmentId === departmentId
                );
            })
            .map((person) => {
                return (
                    '<option value="' +
                    escape(person.id) +
                    '"' +
                    (person.id === selectedId ? " selected" : "") +
                    ">" +
                    escape(
                        person.name +
                            " · " +
                            I18N.roleLabel(person.role)
                    ) +
                    "</option>"
                );
            })
            .join("");
    }

    async function ensureConfig() {
        if (state.departmentsLoaded && state.staffLoaded) {
            return;
        }

        if (state.configPromise) {
            return state.configPromise;
        }

        state.configPromise = Promise.all([
            App.api.get("/admin/departments"),
            App.api.get("/admin/staff")
        ])
            .then((results) => {
                state.departments = results[0].departments || [];
                state.staff = results[1].staff || [];
                state.departmentsLoaded = true;
                state.staffLoaded = true;
            })
            .finally(() => {
                state.configPromise = null;
            });

        return state.configPromise;
    }

    /* Dialog infrastructure ------------------------------------------------ */

    function openDialog(options) {
        const dialog = document.createElement("dialog");
        const wide = options.wide ? " wide" : "";

        dialog.className = wide.trim();
        dialog.innerHTML =
            '<form class="dialog-form" novalidate>' +
            '<div class="dialog-header"><div><h2>' +
            escape(options.title) +
            "</h2>" +
            (options.subtitle
                ? "<p>" + escape(options.subtitle) + "</p>"
                : "") +
            '</div><button type="button" class="btn btn-ghost btn-icon" data-ops-dialog-close aria-label="' +
            escape(t("common.close")) +
            '">' +
            icon("close") +
            "</button></div>" +
            '<div class="dialog-body">' +
            options.body +
            "</div>" +
            '<div class="dialog-footer">' +
            '<button type="button" class="btn btn-secondary" data-ops-dialog-close>' +
            escape(t("common.cancel")) +
            "</button>" +
            (options.submitLabel
                ? '<button type="submit" class="btn btn-primary" data-ops-dialog-submit data-icon="check">' +
                  escape(options.submitLabel) +
                  "</button>"
                : "") +
            "</div></form>";

        document.body.appendChild(dialog);

        const form = dialog.querySelector("form");
        const submit = dialog.querySelector("[data-ops-dialog-submit]");

        dialog
            .querySelectorAll("[data-ops-dialog-close]")
            .forEach((button) => {
                button.addEventListener("click", () => dialog.close());
            });

        dialog.addEventListener("cancel", (event) => {
            event.preventDefault();
            dialog.close();
        });

        dialog.addEventListener("close", () => {
            if (dialog.parentNode) {
                dialog.parentNode.removeChild(dialog);
            }
        });

        if (form && submit) {
            form.addEventListener("submit", async (event) => {
                event.preventDefault();
                App.clearFieldErrors(form);

                const restore = App.buttonLoading(
                    submit,
                    t("common.saving")
                );

                try {
                    const result = await options.onSubmit(form);

                    dialog.close();

                    if (typeof options.onSuccess === "function") {
                        await options.onSuccess(result);
                    }
                } catch (error) {
                    applyServerErrors(form, error);
                } finally {
                    if (dialog.isConnected) {
                        restore();
                    }
                }
            });
        }

        dialog.showModal();

        const first = form
            ? form.querySelector(
                  "input:not([type=hidden]):not([disabled]), select, textarea"
              )
            : null;

        if (first) {
            first.focus();
        }

        return { dialog, form };
    }

    function valueOf(form, name) {
        const field = form.elements.namedItem(name);
        return field ? String(field.value || "").trim() : "";
    }

    function checkedOf(form, name) {
        const field = form.elements.namedItem(name);
        return Boolean(field && field.checked);
    }

    /* UI shell ------------------------------------------------------------- */

    function buildUi() {
        if (!container) {
            return;
        }

        const addItem = state.canManage
            ? '<button type="button" class="btn btn-primary btn-sm" data-ops-add-item>' +
              icon("plus") +
              escape(t("ops.addItem")) +
              "</button>"
            : "";
        const addTask = state.canManage
            ? '<button type="button" class="btn btn-primary btn-sm" data-ops-add-task>' +
              icon("plus") +
              escape(t("ops.addTask")) +
              "</button>"
            : "";

        container.innerHTML =
            '<div class="ops-intro"><p class="text-sm subtle" data-ops-scope></p></div>' +
            '<div class="tabs tabs-inline" role="tablist" aria-label="' +
            escape(t("admin.tabOperations")) +
            '">' +
            '<button type="button" class="tab is-active" role="tab" data-ops-section="bookings" aria-selected="true">' +
            icon("calendar") +
            "<span>" +
            escape(t("ops.bookingsTab")) +
            "</span></button>" +
            '<button type="button" class="tab" role="tab" data-ops-section="inventory" aria-selected="false" tabindex="-1">' +
            icon("package") +
            "<span>" +
            escape(t("ops.inventoryTab")) +
            "</span></button>" +
            '<button type="button" class="tab" role="tab" data-ops-section="maintenance" aria-selected="false" tabindex="-1">' +
            icon("wrench") +
            "<span>" +
            escape(t("ops.maintenanceTab")) +
            "</span></button></div>" +
            '<section class="ops-panel" data-ops-panel="bookings">' +
            '<section class="panel"><div class="panel-header"><div><h2>' +
            escape(t("ops.bookingsTitle")) +
            "</h2><p>" +
            escape(t("ops.bookingsSubtitle")) +
            '</p></div><button type="button" class="btn btn-secondary btn-sm" data-ops-refresh="bookings">' +
            icon("refresh") +
            escape(t("common.refresh")) +
            "</button></div>" +
            '<div class="toolbar" role="search"><label class="search-field">' +
            '<span class="sr-only">' +
            escape(t("common.search")) +
            "</span>" +
            icon("search") +
            '<input type="search" data-ops-search="bookings" placeholder="' +
            escape(t("ops.searchBookings")) +
            '" autocomplete="off"></label>' +
            '<label class="sr-only" for="opsBookingStatus">' +
            escape(t("common.status")) +
            '</label><select id="opsBookingStatus" data-ops-filter="booking-status">' +
            '<option value="">' +
            escape(t("ops.allStatuses")) +
            "</option>" +
            BOOKING_STATUSES.map((status) => {
                return (
                    '<option value="' +
                    escape(status) +
                    '">' +
                    escape(t("bookingStatus." + status)) +
                    "</option>"
                );
            }).join("") +
            "</select></div>" +
            '<div data-ops-list="bookings" aria-live="polite" aria-busy="false"></div>' +
            '<div data-ops-pagination="bookings"></div></section></section>' +
            '<section class="ops-panel" data-ops-panel="inventory" hidden>' +
            '<section class="panel"><div class="panel-header"><div><h2>' +
            escape(t("ops.inventoryTitle")) +
            "</h2><p>" +
            escape(t("ops.inventorySubtitle")) +
            "</p></div>" +
            addItem +
            "</div>" +
            '<div class="ops-metrics" data-ops-summary="inventory"></div>' +
            '<div class="toolbar" role="search"><label class="search-field">' +
            '<span class="sr-only">' +
            escape(t("common.search")) +
            "</span>" +
            icon("search") +
            '<input type="search" data-ops-search="inventory" placeholder="' +
            escape(t("ops.searchInventory")) +
            '" autocomplete="off"></label>' +
            '<label class="checkbox"><input type="checkbox" data-ops-filter="low-only"><span>' +
            escape(t("ops.lowStock")) +
            "</span></label></div>" +
            '<div data-ops-list="inventory" aria-live="polite" aria-busy="false"></div>' +
            '<div data-ops-pagination="inventory"></div></section></section>' +
            '<section class="ops-panel" data-ops-panel="maintenance" hidden>' +
            '<section class="panel"><div class="panel-header"><div><h2>' +
            escape(t("ops.maintenanceTitle")) +
            "</h2><p>" +
            escape(t("ops.maintenanceSubtitle")) +
            "</p></div>" +
            addTask +
            "</div>" +
            '<div class="ops-metrics" data-ops-summary="maintenance"></div>' +
            '<div class="toolbar" role="search"><label class="search-field">' +
            '<span class="sr-only">' +
            escape(t("common.search")) +
            "</span>" +
            icon("search") +
            '<input type="search" data-ops-search="maintenance" placeholder="' +
            escape(t("ops.searchMaintenance")) +
            '" autocomplete="off"></label>' +
            '<label class="sr-only" for="opsMaintenanceStatus">' +
            escape(t("common.status")) +
            '</label><select id="opsMaintenanceStatus" data-ops-filter="maintenance-status">' +
            '<option value="">' +
            escape(t("ops.allStatuses")) +
            "</option>" +
            MAINTENANCE_STATUSES.map((status) => {
                return (
                    '<option value="' +
                    escape(status) +
                    '">' +
                    escape(t("maintenanceStatus." + status)) +
                    "</option>"
                );
            }).join("") +
            "</select>" +
            '<label class="checkbox"><input type="checkbox" data-ops-filter="overdue"><span>' +
            escape(t("ops.filterOverdue")) +
            '</span></label><label class="checkbox"><input type="checkbox" data-ops-filter="due-soon"><span>' +
            escape(t("ops.filterDueSoon")) +
            "</span></label></div>" +
            '<div data-ops-list="maintenance" aria-live="polite" aria-busy="false"></div>' +
            '<div data-ops-pagination="maintenance"></div></section></section>';

        elements = {
            scope: container.querySelector("[data-ops-scope]"),
            sectionButtons: Array.prototype.slice.call(
                container.querySelectorAll("[data-ops-section]")
            ),
            panels: Array.prototype.slice.call(
                container.querySelectorAll("[data-ops-panel]")
            ),
            bookingList: container.querySelector(
                '[data-ops-list="bookings"]'
            ),
            bookingPagination: container.querySelector(
                '[data-ops-pagination="bookings"]'
            ),
            bookingSearch: container.querySelector(
                '[data-ops-search="bookings"]'
            ),
            bookingStatus: document.getElementById("opsBookingStatus"),
            inventoryList: container.querySelector(
                '[data-ops-list="inventory"]'
            ),
            inventoryPagination: container.querySelector(
                '[data-ops-pagination="inventory"]'
            ),
            inventorySearch: container.querySelector(
                '[data-ops-search="inventory"]'
            ),
            inventorySummary: container.querySelector(
                '[data-ops-summary="inventory"]'
            ),
            lowOnly: container.querySelector(
                '[data-ops-filter="low-only"]'
            ),
            maintenanceList: container.querySelector(
                '[data-ops-list="maintenance"]'
            ),
            maintenancePagination: container.querySelector(
                '[data-ops-pagination="maintenance"]'
            ),
            maintenanceSearch: container.querySelector(
                '[data-ops-search="maintenance"]'
            ),
            maintenanceSummary: container.querySelector(
                '[data-ops-summary="maintenance"]'
            ),
            maintenanceStatus: document.getElementById("opsMaintenanceStatus"),
            overdue: container.querySelector('[data-ops-filter="overdue"]'),
            dueSoon: container.querySelector('[data-ops-filter="due-soon"]')
        };

        if (elements.scope) {
            elements.scope.textContent = state.isAdmin
                ? t("ops.scopeAll")
                : state.user.role === "department_manager"
                  ? t("ops.bookingScope")
                  : t("ops.staffHint");
        }

        renderInventorySummary();
        renderMaintenanceSummary();
    }

    function activateSection(section, options) {
        const settings = options || {};
        const target = SECTIONS.includes(section) ? section : "bookings";

        state.section = target;

        elements.sectionButtons.forEach((button) => {
            const active =
                button.getAttribute("data-ops-section") === target;
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-selected", String(active));
            button.tabIndex = active ? 0 : -1;
        });

        elements.panels.forEach((panel) => {
            panel.hidden =
                panel.getAttribute("data-ops-panel") !== target;
        });

        if (settings.skipLoad) {
            return Promise.resolve();
        }

        return loadSection(target, true);
    }

    function loadSection(section, force) {
        if (section === "bookings") {
            return loadBookings(force);
        }

        if (section === "inventory") {
            return loadInventory(force);
        }

        if (section === "maintenance") {
            return loadMaintenance(force);
        }

        return Promise.resolve();
    }

    /* Bookings ------------------------------------------------------------- */

    function renderBookings() {
        if (!elements.bookingList) {
            return;
        }

        const bookingState = state.bookings;

        elements.bookingList.setAttribute("aria-busy", "false");

        if (!bookingState.items.length) {
            elements.bookingList.innerHTML = emptyMarkup(
                "calendar",
                t("ops.noBookingsTitle"),
                t("ops.emptyBookingBody")
            );
            elements.bookingPagination.innerHTML = "";
            return;
        }

        const rows = bookingState.items
            .map((booking) => {
                const review = canReviewBooking(booking)
                    ? '<button type="button" class="btn btn-secondary btn-sm" data-ops-review="' +
                      escape(booking.id) +
                      '">' +
                      escape(t("ops.review")) +
                      "</button>"
                    : "";
                const note = booking.decisionNote
                    ? '<span class="cell-muted">' +
                      escape(booking.decisionNote) +
                      "</span>"
                    : "";

                return (
                    "<tr>" +
                    '<td><div class="cell-main"><strong>' +
                    escape(booking.facility.name) +
                    "</strong><span>" +
                    escape(booking.facility.location) +
                    "</span></div></td>" +
                    "<td>" +
                    escape(booking.title) +
                    "</td>" +
                    '<td><div class="cell-main"><strong>' +
                    escape(booking.bookedBy.name) +
                    "</strong><span>" +
                    escape(booking.bookedBy.email || "") +
                    "</span></div></td>" +
                    '<td><div class="cell-main"><span>' +
                    escape(I18N.formatDateTime(booking.startsAt)) +
                    "</span><span>" +
                    escape(I18N.formatDateTime(booking.endsAt)) +
                    "</span></div></td>" +
                    "<td>" +
                    escape(count(booking.attendees)) +
                    "</td>" +
                    "<td>" +
                    bookingBadge(booking.status) +
                    note +
                    "</td>" +
                    '<td><div class="table-actions">' +
                    review +
                    "</div></td></tr>"
                );
            })
            .join("");

        elements.bookingList.innerHTML =
            '<div class="table-wrap"><table class="table"><thead><tr>' +
            "<th>" +
            escape(t("ops.facility")) +
            "</th><th>" +
            escape(t("services.eventTitle")) +
            "</th><th>" +
            escape(t("ops.requester")) +
            "</th><th>" +
            escape(t("ops.when")) +
            "</th><th>" +
            escape(t("ops.attendees")) +
            "</th><th>" +
            escape(t("common.status")) +
            "</th><th>" +
            escape(t("ops.actions")) +
            "</th></tr></thead><tbody>" +
            rows +
            "</tbody></table></div>";

        elements.bookingPagination.innerHTML = paginationMarkup(
            "bookings",
            bookingState.pagination
        );
    }

    async function loadBookings(force) {
        const bookingState = state.bookings;

        if (bookingState.loading) {
            return;
        }

        if (bookingState.loaded && !force) {
            renderBookings();
            return;
        }

        bookingState.loading = true;
        bookingState.error = false;

        if (elements.bookingList) {
            elements.bookingList.setAttribute("aria-busy", "true");
            elements.bookingList.innerHTML = skeletonRows(7, 5);
        }

        const params = new URLSearchParams({
            page: String(bookingState.page),
            pageSize: String(PAGE_SIZE)
        });

        if (bookingState.status) {
            params.set("status", bookingState.status);
        }

        if (bookingState.search.trim()) {
            params.set("search", bookingState.search.trim());
        }

        try {
            const data = await App.api.get(
                "/facilities/bookings?" + params.toString()
            );

            bookingState.items = Array.isArray(data.bookings)
                ? data.bookings
                : [];
            bookingState.pagination = data.pagination || null;
            bookingState.loaded = true;
            renderBookings();
        } catch (error) {
            bookingState.items = [];
            bookingState.pagination = null;
            bookingState.error = true;

            if (elements.bookingList) {
                elements.bookingList.setAttribute("aria-busy", "false");
                elements.bookingList.innerHTML = errorMarkup(
                    App.friendlyError(error, t("ops.bookingsError")),
                    "bookings"
                );
            }

            if (elements.bookingPagination) {
                elements.bookingPagination.innerHTML = "";
            }
        } finally {
            bookingState.loading = false;
        }
    }

    function openBookingReview(booking) {
        openDialog({
            title: t("ops.reviewTitle"),
            subtitle: t("ops.reviewSubtitle"),
            submitLabel: t("ops.saveDecision"),
            body:
                '<div class="alert-item" style="margin-bottom:4px"><span class="alert-icon" data-icon="calendar" aria-hidden="true"></span>' +
                '<div class="alert-copy"><strong>' +
                escape(booking.facility.name) +
                " · " +
                escape(booking.title) +
                "</strong><p>" +
                escape(I18N.formatDateTime(booking.startsAt)) +
                " → " +
                escape(I18N.formatDateTime(booking.endsAt)) +
                " · " +
                escape(
                    t("services.capacityValue", {
                        count: count(booking.attendees)
                    })
                ) +
                "</p></div></div>" +
                '<div class="field"><label for="opsDecision">' +
                escape(t("ops.decision")) +
                '</label><select id="opsDecision" name="status" required>' +
                '<option value="Approved">' +
                escape(t("ops.approve")) +
                '</option><option value="Rejected">' +
                escape(t("ops.reject")) +
                "</option></select>" +
                '<span class="field-error" aria-live="polite"></span></div>' +
                '<div class="field"><label for="opsDecisionNote">' +
                escape(t("ops.decisionNote")) +
                '</label><textarea id="opsDecisionNote" name="note" maxlength="1000"></textarea>' +
                '<span class="field-hint">' +
                escape(t("ops.decisionNoteHint")) +
                '</span><span class="field-error" aria-live="polite"></span></div>',
            async onSubmit(form) {
                const status = valueOf(form, "status");
                const note = valueOf(form, "note");

                if (status === "Rejected" && note.length < 3) {
                    throw {
                        errors: [
                            {
                                path: "note",
                                message: t("ops.decisionNoteHint")
                            }
                        ]
                    };
                }

                const data = await App.api.patch(
                    "/facilities/bookings/" +
                        encodeURIComponent(booking.id) +
                        "/review",
                    { status, note }
                );

                return data;
            },
            async onSuccess() {
                App.toast(t("ops.bookingUpdated"), "success");
                await loadBookings(true);
            }
        });

        if (container) {
            I18N.apply(container);
        }
    }

    /* Inventory ------------------------------------------------------------ */

    function renderInventorySummary() {
        if (!elements || !elements.inventorySummary) {
            return;
        }

        const summary = state.inventory.summary;

        elements.inventorySummary.innerHTML =
            metric(
                t("ops.inventoryTotal"),
                summary.total,
                "brand",
                "package"
            ) +
            metric(
                t("ops.lowStock"),
                summary.lowStock,
                "warning",
                "alert-triangle"
            ) +
            metric(
                t("ops.outOfStock"),
                summary.outOfStock,
                "danger",
                "alert-circle"
            );
    }

    function renderInventory() {
        if (!elements.inventoryList) {
            return;
        }

        const inventoryState = state.inventory;

        elements.inventoryList.setAttribute("aria-busy", "false");
        renderInventorySummary();

        if (!inventoryState.items.length) {
            elements.inventoryList.innerHTML = emptyMarkup(
                "package",
                t("ops.noInventoryTitle"),
                t("ops.emptyInventoryBody")
            );
            elements.inventoryPagination.innerHTML = "";
            return;
        }

        const rows = inventoryState.items
            .map((item) => {
                const stockTone = item.quantity === 0
                    ? "critical"
                    : item.lowStock
                      ? "high"
                      : "resolved";
                const stockLabel =
                    item.quantity === 0
                        ? t("ops.outOfStock")
                        : item.lowStock
                          ? t("ops.lowStock")
                          : t("ops.healthy");
                const edit = state.canManage
                    ? '<button type="button" class="btn btn-ghost btn-sm" data-ops-edit-item="' +
                      escape(item.id) +
                      '">' +
                      escape(t("common.edit")) +
                      "</button>"
                    : "";
                const adjust = state.canManage ||
                    state.user.role === "staff"
                    ? '<button type="button" class="btn btn-secondary btn-sm" data-ops-adjust="' +
                      escape(item.id) +
                      '">' +
                      escape(t("ops.adjust")) +
                      "</button>"
                    : "";

                return (
                    "<tr>" +
                    '<td><div class="cell-main"><strong>' +
                    escape(item.name) +
                    "</strong><span>" +
                    escape(item.sku || item.category) +
                    "</span></div></td>" +
                    "<td>" +
                    escape(item.departmentName || t("ops.noDepartment")) +
                    "</td>" +
                    '<td><div class="cell-main"><strong>' +
                    escape(count(item.quantity)) +
                    " " +
                    escape(item.unit) +
                    "</strong><span>" +
                    escape(
                        t("ops.reorderLevel") +
                            " " +
                            count(item.reorderLevel)
                    ) +
                    "</span></div></td>" +
                    "<td>" +
                    statusBadge(stockLabel, stockTone) +
                    "</td>" +
                    "<td>" +
                    escape(item.location || "—") +
                    "</td>" +
                    '<td><div class="table-actions">' +
                    adjust +
                    edit +
                    '<button type="button" class="btn btn-ghost btn-sm" data-ops-ledger="' +
                    escape(item.id) +
                    '">' +
                    escape(t("ops.ledger")) +
                    "</button></div></td></tr>"
                );
            })
            .join("");

        elements.inventoryList.innerHTML =
            '<div class="table-wrap"><table class="table"><thead><tr>' +
            "<th>" +
            escape(t("ops.item")) +
            "</th><th>" +
            escape(t("ops.department")) +
            "</th><th>" +
            escape(t("ops.stock")) +
            "</th><th>" +
            escape(t("common.status")) +
            "</th><th>" +
            escape(t("ops.location")) +
            "</th><th>" +
            escape(t("ops.actions")) +
            "</th></tr></thead><tbody>" +
            rows +
            "</tbody></table></div>";

        elements.inventoryPagination.innerHTML = paginationMarkup(
            "inventory",
            inventoryState.pagination
        );
    }

    async function loadInventory(force) {
        const inventoryState = state.inventory;

        if (inventoryState.loading) {
            return;
        }

        if (inventoryState.loaded && !force) {
            renderInventory();
            return;
        }

        inventoryState.loading = true;
        inventoryState.error = false;

        if (elements.inventoryList) {
            elements.inventoryList.setAttribute("aria-busy", "true");
            elements.inventoryList.innerHTML = skeletonRows(6, 5);
        }

        const params = new URLSearchParams({
            page: String(inventoryState.page),
            pageSize: String(PAGE_SIZE)
        });

        if (inventoryState.search.trim()) {
            params.set("search", inventoryState.search.trim());
        }

        if (inventoryState.lowOnly) {
            params.set("lowOnly", "true");
        }

        try {
            const data = await App.api.get(
                "/operations/inventory?" + params.toString()
            );

            inventoryState.items = Array.isArray(data.items)
                ? data.items
                : [];
            inventoryState.summary = data.summary || {
                total: 0,
                lowStock: 0,
                outOfStock: 0
            };
            inventoryState.pagination = data.pagination || null;
            inventoryState.loaded = true;
            renderInventory();
        } catch (error) {
            inventoryState.items = [];
            inventoryState.pagination = null;
            inventoryState.error = true;

            if (elements.inventoryList) {
                elements.inventoryList.setAttribute("aria-busy", "false");
                elements.inventoryList.innerHTML = errorMarkup(
                    App.friendlyError(error, t("ops.inventoryError")),
                    "inventory"
                );
            }

            if (elements.inventoryPagination) {
                elements.inventoryPagination.innerHTML = "";
            }
        } finally {
            inventoryState.loading = false;
        }
    }

    async function openInventoryDialog(item) {
        try {
            await ensureConfig();
        } catch (error) {
            App.toast(App.friendlyError(error), "error");
            return;
        }

        const editing = Boolean(item);
        const departmentField = state.isAdmin
            ? '<div class="field"><label for="opsInventoryDepartment">' +
              escape(t("ops.department")) +
              '</label><select id="opsInventoryDepartment" name="departmentId">' +
              '<option value="">' +
              escape(t("ops.noDepartment")) +
              "</option>" +
              departmentOptions(item ? item.departmentId : "") +
              '</select><span class="field-error" aria-live="polite"></span></div>'
            : "";

        const body =
            '<div class="field-row"><div class="field"><label for="opsInventoryName">' +
            escape(t("ops.itemName")) +
            '</label><input type="text" id="opsInventoryName" name="name" maxlength="160" required value="' +
            escape(item ? item.name : "") +
            '"><span class="field-error" aria-live="polite"></span></div>' +
            '<div class="field"><label for="opsInventorySku">' +
            escape(t("ops.sku")) +
            '</label><input type="text" id="opsInventorySku" name="sku" maxlength="50" autocomplete="off" value="' +
            escape(item ? item.sku || "" : "") +
            '"><span class="field-error" aria-live="polite"></span></div></div>' +
            '<div class="field-row"><div class="field"><label for="opsInventoryCategory">' +
            escape(t("ops.category")) +
            '</label><input type="text" id="opsInventoryCategory" name="category" maxlength="80" value="' +
            escape(item ? item.category : "General") +
            '"><span class="field-error" aria-live="polite"></span></div>' +
            departmentField +
            "</div>" +
            '<div class="field-row"><div class="field"><label for="opsInventoryLocation">' +
            escape(t("ops.location")) +
            '</label><input type="text" id="opsInventoryLocation" name="location" maxlength="160" value="' +
            escape(item ? item.location || "" : "") +
            '"><span class="field-error" aria-live="polite"></span></div>' +
            '<div class="field"><label for="opsInventoryUnit">' +
            escape(t("ops.unit")) +
            '</label><input type="text" id="opsInventoryUnit" name="unit" maxlength="30" value="' +
            escape(item ? item.unit : "units") +
            '"><span class="field-error" aria-live="polite"></span></div></div>' +
            '<div class="field-row">' +
            (editing
                ? ""
                : '<div class="field"><label for="opsInventoryQuantity">' +
                  escape(t("ops.quantity")) +
                  '</label><input type="number" id="opsInventoryQuantity" name="quantity" min="0" max="1000000" step="1" value="0"><span class="field-error" aria-live="polite"></span></div>') +
            '<div class="field"><label for="opsInventoryReorder">' +
            escape(t("ops.reorderLevel")) +
            '</label><input type="number" id="opsInventoryReorder" name="reorderLevel" min="0" max="1000000" step="1" value="' +
            escape(item ? item.reorderLevel : 0) +
            '"><span class="field-error" aria-live="polite"></span></div>' +
            '<div class="field"><label for="opsInventoryCost">' +
            escape(t("ops.unitCost")) +
            '</label><input type="number" id="opsInventoryCost" name="unitCost" min="0" max="100000000" step="0.01" value="' +
            escape(item && item.unitCost !== null ? item.unitCost : "") +
            '"><span class="field-error" aria-live="polite"></span></div></div>' +
            '<div class="field"><label for="opsInventoryNotes">' +
            escape(t("ops.notes")) +
            '</label><textarea id="opsInventoryNotes" name="notes" maxlength="500">' +
            escape(item ? item.notes || "" : "") +
            '</textarea><span class="field-error" aria-live="polite"></span></div>' +
            (editing
                ? '<label class="checkbox"><input type="checkbox" name="isActive"' +
                  (item.isActive ? " checked" : "") +
                  "><span>" +
                  escape(t("common.active")) +
                  "</span></label>"
                : "");

        openDialog({
            title: editing ? t("ops.editItem") : t("ops.addItem"),
            subtitle: t("ops.inventoryDialogSubtitle"),
            submitLabel: t("ops.saveItem"),
            body,
            async onSubmit(form) {
                const payload = {
                    sku: valueOf(form, "sku"),
                    name: valueOf(form, "name"),
                    category: valueOf(form, "category") || "General",
                    location: valueOf(form, "location"),
                    unit: valueOf(form, "unit") || "units",
                    reorderLevel: Number(valueOf(form, "reorderLevel") || 0),
                    notes: valueOf(form, "notes")
                };

                if (state.isAdmin) {
                    payload.departmentId = valueOf(form, "departmentId");
                }

                if (valueOf(form, "unitCost") !== "") {
                    payload.unitCost = Number(valueOf(form, "unitCost"));
                } else if (editing) {
                    payload.unitCost = null;
                }

                if (editing) {
                    payload.isActive = checkedOf(form, "isActive");

                    return App.api.patch(
                        "/operations/inventory/" +
                            encodeURIComponent(item.id),
                        payload
                    );
                }

                payload.quantity = Number(
                    valueOf(form, "quantity") || 0
                );
                payload.isActive = true;

                return App.api.post("/operations/inventory", payload);
            },
            async onSuccess() {
                App.toast(t("ops.itemSaved"), "success");
                await loadInventory(true);
            }
        });
    }

    function openAdjustDialog(item) {
        openDialog({
            title: t("ops.adjustTitle"),
            subtitle: t("ops.adjustFor", { name: item.name }),
            submitLabel: t("ops.applyAdjustment"),
            body:
                '<div class="alert-item" style="margin-bottom:4px"><span class="alert-icon" data-icon="package" aria-hidden="true"></span>' +
                '<div class="alert-copy"><strong>' +
                escape(item.name) +
                "</strong><p>" +
                escape(
                    t("ops.onHand") +
                        ": " +
                        count(item.quantity) +
                        " " +
                        item.unit
                ) +
                "</p></div></div>" +
                '<div class="field"><label for="opsAdjustDelta">' +
                escape(t("ops.adjustment")) +
                '</label><input type="number" id="opsAdjustDelta" name="delta" step="1" required value="1"><span class="field-hint">' +
                escape(t("ops.adjustmentHint")) +
                '</span><span class="field-error" aria-live="polite"></span></div>' +
                '<div class="field"><label for="opsAdjustReason">' +
                escape(t("ops.reason")) +
                '</label><select id="opsAdjustReason" name="reason">' +
                REASONS.map((reason) => {
                    return (
                        '<option value="' +
                        escape(reason) +
                        '">' +
                        escape(t("inventoryReason." + reason)) +
                        "</option>"
                    );
                }).join("") +
                '</select><span class="field-error" aria-live="polite"></span></div>' +
                '<div class="field"><label for="opsAdjustNote">' +
                escape(t("ops.reasonNote")) +
                '</label><textarea id="opsAdjustNote" name="note" maxlength="500"></textarea><span class="field-error" aria-live="polite"></span></div>',
            async onSubmit(form) {
                return App.api.post(
                    "/operations/inventory/" +
                        encodeURIComponent(item.id) +
                        "/adjust",
                    {
                        delta: Number(valueOf(form, "delta")),
                        reason: valueOf(form, "reason"),
                        note: valueOf(form, "note")
                    }
                );
            },
            async onSuccess() {
                App.toast(t("ops.stockAdjusted"), "success");
                await loadInventory(true);
            }
        });
    }

    async function openLedger(item) {
        const modal = openDialog({
            title: t("ops.ledgerTitle"),
            subtitle: item.name,
            body:
                '<div data-ops-ledger-body aria-live="polite">' +
                skeletonRows(4, 4) +
                "</div>"
        });
        const target = modal.dialog.querySelector(
            "[data-ops-ledger-body]"
        );

        try {
            const data = await App.api.get(
                "/operations/inventory/" +
                    encodeURIComponent(item.id) +
                    "/transactions"
            );
            const transactions = Array.isArray(data.transactions)
                ? data.transactions
                : [];

            if (!transactions.length) {
                target.innerHTML = emptyMarkup(
                    "list",
                    t("ops.ledgerTitle"),
                    t("ops.ledgerEmpty")
                );
                return;
            }

            target.innerHTML =
                '<div class="table-wrap"><table class="table"><thead><tr><th>' +
                escape(t("common.date")) +
                "</th><th>" +
                escape(t("ops.adjustment")) +
                "</th><th>" +
                escape(t("ops.reason")) +
                "</th><th>" +
                escape(t("ops.note")) +
                "</th><th>" +
                escape(t("ops.requester")) +
                "</th></tr></thead><tbody>" +
                transactions
                    .map((entry) => {
                        return (
                            "<tr><td>" +
                            escape(I18N.formatDateTime(entry.createdAt)) +
                            "</td><td>" +
                            escape(
                                (entry.delta > 0 ? "+" : "") +
                                    count(entry.delta)
                            ) +
                            "</td><td>" +
                            escape(
                                t("inventoryReason." + entry.reason)
                            ) +
                            "</td><td>" +
                            escape(entry.note || "—") +
                            "</td><td>" +
                            escape(entry.actorName || t("common.system")) +
                            "</td></tr>"
                        );
                    })
                    .join("") +
                "</tbody></table></div>";
        } catch (error) {
            target.innerHTML = errorMarkup(
                App.friendlyError(error, t("ops.ledgerError")),
                "ledger"
            );
        }
    }

    /* Maintenance ---------------------------------------------------------- */

    function renderMaintenanceSummary() {
        if (!elements || !elements.maintenanceSummary) {
            return;
        }

        const summary = state.maintenance.summary;

        elements.maintenanceSummary.innerHTML =
            metric(
                t("ops.maintenanceTotal"),
                summary.total,
                "brand",
                "wrench"
            ) +
            metric(
                t("ops.overdue"),
                summary.overdue,
                "danger",
                "alert-triangle"
            ) +
            metric(
                t("ops.dueSoon"),
                summary.dueSoon,
                "warning",
                "clock"
            );
    }

    function renderMaintenance() {
        if (!elements.maintenanceList) {
            return;
        }

        const maintenanceState = state.maintenance;

        elements.maintenanceList.setAttribute("aria-busy", "false");
        renderMaintenanceSummary();

        if (!maintenanceState.tasks.length) {
            elements.maintenanceList.innerHTML = emptyMarkup(
                "wrench",
                t("ops.noMaintenanceTitle"),
                t("ops.emptyMaintenanceBody")
            );
            elements.maintenancePagination.innerHTML = "";
            return;
        }

        const rows = maintenanceState.tasks
            .map((task) => {
                const allowed = canHandleTask(task);
                const actions = [];

                if (allowed && task.status === "Scheduled") {
                    actions.push(
                        '<button type="button" class="btn btn-secondary btn-sm" data-ops-start-task="' +
                            escape(task.id) +
                            '">' +
                            escape(t("ops.startTask")) +
                            "</button>"
                    );
                }

                if (
                    allowed &&
                    ["Scheduled", "In Progress"].includes(task.status)
                ) {
                    actions.push(
                        '<button type="button" class="btn btn-primary btn-sm" data-ops-complete-task="' +
                            escape(task.id) +
                            '">' +
                            escape(t("ops.completeTask")) +
                            "</button>"
                    );
                }

                if (state.canManage) {
                    actions.push(
                        '<button type="button" class="btn btn-ghost btn-sm" data-ops-edit-task="' +
                            escape(task.id) +
                            '">' +
                            escape(t("common.edit")) +
                            "</button>"
                    );
                }

                actions.push(
                    '<button type="button" class="btn btn-ghost btn-sm" data-ops-logs-task="' +
                        escape(task.id) +
                        '">' +
                        escape(t("ops.logs")) +
                        "</button>"
                );

                return (
                    "<tr" +
                    (task.isOverdue ? ' class="is-overdue"' : "") +
                    '><td><div class="cell-main"><strong>' +
                    escape(task.title) +
                    "</strong><span>" +
                    escape(
                        [task.assetName, task.location]
                            .filter(Boolean)
                            .join(" · ")
                    ) +
                    "</span></div></td>" +
                    '<td><div class="cell-main"><span>' +
                    escape(
                        task.nextDueAt
                            ? I18N.formatDateTime(task.nextDueAt)
                            : t("common.unknown")
                    ) +
                    "</span>" +
                    (task.isOverdue
                        ? '<span class="text-xs" style="color:var(--danger-600)">' +
                          escape(t("ops.overdue")) +
                          "</span>"
                        : "") +
                    "</div></td>" +
                    "<td>" +
                    escape(t("frequency." + task.frequency)) +
                    "</td>" +
                    "<td>" +
                    escape(
                        task.assignedTo
                            ? task.assignedTo.name
                            : t("ops.unassigned")
                    ) +
                    "</td>" +
                    "<td>" +
                    maintenanceBadge(task.status) +
                    "</td>" +
                    '<td><div class="table-actions">' +
                    actions.join("") +
                    "</div></td></tr>"
                );
            })
            .join("");

        elements.maintenanceList.innerHTML =
            '<div class="table-wrap"><table class="table"><thead><tr>' +
            "<th>" +
            escape(t("ops.task")) +
            "</th><th>" +
            escape(t("ops.nextDue")) +
            "</th><th>" +
            escape(t("ops.frequency")) +
            "</th><th>" +
            escape(t("ops.assignee")) +
            "</th><th>" +
            escape(t("common.status")) +
            "</th><th>" +
            escape(t("ops.actions")) +
            "</th></tr></thead><tbody>" +
            rows +
            "</tbody></table></div>";

        elements.maintenancePagination.innerHTML = paginationMarkup(
            "maintenance",
            maintenanceState.pagination
        );
    }

    async function loadMaintenance(force) {
        const maintenanceState = state.maintenance;

        if (maintenanceState.loading) {
            return;
        }

        if (maintenanceState.loaded && !force) {
            renderMaintenance();
            return;
        }

        maintenanceState.loading = true;
        maintenanceState.error = false;

        if (elements.maintenanceList) {
            elements.maintenanceList.setAttribute("aria-busy", "true");
            elements.maintenanceList.innerHTML = skeletonRows(6, 5);
        }

        const params = new URLSearchParams({
            page: String(maintenanceState.page),
            pageSize: String(PAGE_SIZE)
        });

        if (maintenanceState.search.trim()) {
            params.set("search", maintenanceState.search.trim());
        }

        if (maintenanceState.status) {
            params.set("status", maintenanceState.status);
        }

        if (maintenanceState.overdue) {
            params.set("overdue", "true");
        }

        if (maintenanceState.dueSoon) {
            params.set("dueSoon", "true");
        }

        try {
            const data = await App.api.get(
                "/operations/maintenance?" + params.toString()
            );

            maintenanceState.tasks = Array.isArray(data.tasks)
                ? data.tasks
                : [];
            maintenanceState.summary = data.summary || {
                total: 0,
                overdue: 0,
                dueSoon: 0
            };
            maintenanceState.pagination = data.pagination || null;
            maintenanceState.loaded = true;
            renderMaintenance();
        } catch (error) {
            maintenanceState.tasks = [];
            maintenanceState.pagination = null;
            maintenanceState.error = true;

            if (elements.maintenanceList) {
                elements.maintenanceList.setAttribute("aria-busy", "false");
                elements.maintenanceList.innerHTML = errorMarkup(
                    App.friendlyError(error, t("ops.maintenanceError")),
                    "maintenance"
                );
            }

            if (elements.maintenancePagination) {
                elements.maintenancePagination.innerHTML = "";
            }
        } finally {
            maintenanceState.loading = false;
        }
    }

    async function openTaskDialog(task) {
        try {
            await ensureConfig();
        } catch (error) {
            App.toast(App.friendlyError(error), "error");
            return;
        }

        const editing = Boolean(task);
        const departmentId = task
            ? task.departmentId
            : state.user.departmentId || "";
        const departmentField = state.isAdmin
            ? '<div class="field"><label for="opsTaskDepartment">' +
              escape(t("ops.department")) +
              '</label><select id="opsTaskDepartment" name="departmentId">' +
              '<option value="">' +
              escape(t("ops.noDepartment")) +
              "</option>" +
              departmentOptions(departmentId) +
              '</select><span class="field-error" aria-live="polite"></span></div>'
            : "";
        const statusField =
            editing && state.canManage
                ? '<div class="field"><label for="opsTaskStatus">' +
                  escape(t("common.status")) +
                  '</label><select id="opsTaskStatus" name="status">' +
                  ["Scheduled", "In Progress", "Cancelled"]
                      .map((status) => {
                          return (
                              '<option value="' +
                              escape(status) +
                              '"' +
                              (task.status === status ? " selected" : "") +
                              ">" +
                              escape(t("maintenanceStatus." + status)) +
                              "</option>"
                          );
                      })
                      .join("") +
                  '</select><span class="field-error" aria-live="polite"></span></div>'
                : "";
        const taskDepartment = task
            ? task.departmentId
            : state.user.departmentId;

        const body =
            '<div class="field"><label for="opsTaskTitle">' +
            escape(t("ops.taskTitle")) +
            '</label><input type="text" id="opsTaskTitle" name="title" maxlength="200" required value="' +
            escape(task ? task.title : "") +
            '"><span class="field-error" aria-live="polite"></span></div>' +
            '<div class="field-row"><div class="field"><label for="opsTaskAsset">' +
            escape(t("ops.assetName")) +
            '</label><input type="text" id="opsTaskAsset" name="assetName" maxlength="200" value="' +
            escape(task ? task.assetName || "" : "") +
            '"><span class="field-error" aria-live="polite"></span></div>' +
            '<div class="field"><label for="opsTaskLocation">' +
            escape(t("ops.location")) +
            '</label><input type="text" id="opsTaskLocation" name="location" maxlength="200" value="' +
            escape(task ? task.location || "" : "") +
            '"><span class="field-error" aria-live="polite"></span></div></div>' +
            '<div class="field-row">' +
            departmentField +
            '<div class="field"><label for="opsTaskAssignee">' +
            escape(t("ops.assignee")) +
            '</label><select id="opsTaskAssignee" name="assignedTo"><option value="">' +
            escape(t("ops.unassigned")) +
            "</option>" +
            staffOptions(
                task && task.assignedTo ? task.assignedTo.id : "",
                taskDepartment
            ) +
            '</select><span class="field-error" aria-live="polite"></span></div></div>' +
            '<div class="field-row"><div class="field"><label for="opsTaskFrequency">' +
            escape(t("ops.frequency")) +
            '</label><select id="opsTaskFrequency" name="frequency">' +
            FREQUENCIES.map((frequency) => {
                return (
                    '<option value="' +
                    escape(frequency) +
                    '"' +
                    (task && task.frequency === frequency
                        ? " selected"
                        : frequency === "monthly" && !task
                          ? " selected"
                          : "") +
                    ">" +
                    escape(t("frequency." + frequency)) +
                    "</option>"
                );
            }).join("") +
            '</select><span class="field-error" aria-live="polite"></span></div>' +
            '<div class="field"><label for="opsTaskDue">' +
            escape(t("ops.nextDue")) +
            '</label><input type="datetime-local" id="opsTaskDue" name="nextDueAt" required value="' +
            escape(
                task
                    ? toLocalInput(task.nextDueAt)
                    : toLocalInput(defaultDueDate())
            ) +
            '"><span class="field-error" aria-live="polite"></span></div>' +
            '<div class="field"><label for="opsTaskPriority">' +
            escape(t("ops.priority")) +
            '</label><select id="opsTaskPriority" name="priority">' +
            ["Low", "Medium", "High", "Critical"]
                .map((priority) => {
                    return (
                        '<option value="' +
                        escape(priority) +
                        '"' +
                        ((task && task.priority === priority) ||
                        (!task && priority === "Medium")
                            ? " selected"
                            : "") +
                        ">" +
                        escape(t("priority." + priority)) +
                        "</option>"
                    );
                })
                .join("") +
            "</select></div>" +
            statusField +
            "</div>" +
            '<div class="field"><label for="opsTaskDescription">' +
            escape(t("services.description")) +
            '</label><textarea id="opsTaskDescription" name="description" maxlength="3000">' +
            escape(task ? task.description || "" : "") +
            '</textarea><span class="field-error" aria-live="polite"></span></div>';

        const modal = openDialog({
            title: editing ? t("ops.editTask") : t("ops.addTask"),
            subtitle: t("ops.taskDialogSubtitle"),
            submitLabel: t("ops.saveTask"),
            body,
            async onSubmit(form) {
                const due = new Date(valueOf(form, "nextDueAt"));
                const payload = {
                    title: valueOf(form, "title"),
                    description: valueOf(form, "description"),
                    assetName: valueOf(form, "assetName"),
                    location: valueOf(form, "location"),
                    assignedTo: valueOf(form, "assignedTo") || null,
                    frequency: valueOf(form, "frequency"),
                    nextDueAt: Number.isNaN(due.getTime())
                        ? undefined
                        : due.toISOString(),
                    priority: valueOf(form, "priority")
                };

                if (state.isAdmin) {
                    payload.departmentId =
                        valueOf(form, "departmentId") || null;
                }

                if (editing) {
                    payload.status = valueOf(form, "status");

                    return App.api.patch(
                        "/operations/maintenance/" +
                            encodeURIComponent(task.id),
                        payload
                    );
                }

                return App.api.post(
                    "/operations/maintenance",
                    payload
                );
            },
            async onSuccess() {
                App.toast(t("ops.taskSaved"), "success");
                await loadMaintenance(true);
            }
        });

        const departmentSelect =
            modal.form &&
            modal.form.elements.namedItem("departmentId");

        if (departmentSelect) {
            departmentSelect.addEventListener("change", () => {
                const assignee = modal.form.elements.namedItem("assignedTo");

                if (assignee) {
                    assignee.innerHTML =
                        '<option value="">' +
                        escape(t("ops.unassigned")) +
                        "</option>" +
                        staffOptions("", departmentSelect.value);
                }
            });
        }
    }

    async function startTask(task, button) {
        const restore = App.buttonLoading(
            button,
            t("common.processing")
        );

        try {
            await App.api.patch(
                "/operations/maintenance/" +
                    encodeURIComponent(task.id),
                { status: "In Progress" }
            );
            App.toast(t("ops.taskStarted"), "success");
            await loadMaintenance(true);
        } catch (error) {
            App.toast(
                App.friendlyError(error, t("ops.taskActionError")),
                "error"
            );
            restore();
        }
    }

    function openCompleteDialog(task) {
        openDialog({
            title: t("ops.completeTitle"),
            subtitle: t("ops.completeSubtitle"),
            submitLabel: t("ops.complete"),
            body:
                '<div class="alert-item" style="margin-bottom:4px"><span class="alert-icon" data-icon="wrench" aria-hidden="true"></span>' +
                '<div class="alert-copy"><strong>' +
                escape(task.title) +
                "</strong><p>" +
                escape(
                    (task.assetName ? task.assetName + " · " : "") +
                        (task.location || "")
                ) +
                "</p></div></div>" +
                '<div class="field"><label for="opsCompleteNote">' +
                escape(t("ops.completionNote")) +
                '</label><textarea id="opsCompleteNote" name="note" maxlength="1000"></textarea><span class="field-error" aria-live="polite"></span></div>',
            async onSubmit(form) {
                return App.api.post(
                    "/operations/maintenance/" +
                        encodeURIComponent(task.id) +
                        "/complete",
                    { note: valueOf(form, "note") }
                );
            },
            async onSuccess() {
                App.toast(t("ops.taskCompleted"), "success");
                await loadMaintenance(true);
            }
        });
    }

    async function openTaskLogs(task) {
        const modal = openDialog({
            title: t("ops.logsTitle"),
            subtitle: task.title,
            body:
                '<div data-ops-logs-body aria-live="polite">' +
                skeletonRows(3, 4) +
                "</div>"
        });
        const target = modal.dialog.querySelector("[data-ops-logs-body]");

        try {
            const data = await App.api.get(
                "/operations/maintenance/" +
                    encodeURIComponent(task.id) +
                    "/logs"
            );
            const logs = Array.isArray(data.logs) ? data.logs : [];

            if (!logs.length) {
                target.innerHTML = emptyMarkup(
                    "clock",
                    t("ops.logsTitle"),
                    t("ops.logsEmpty")
                );
                return;
            }

            target.innerHTML =
                '<ul class="ops-history">' +
                logs
                    .map((log) => {
                        return (
                            "<li><div><strong>" +
                            escape(I18N.formatDateTime(log.completedAt)) +
                            "</strong><span>" +
                            escape(log.actorName || t("common.system")) +
                            "</span></div><p>" +
                            escape(log.note || "—") +
                            "</p></li>"
                        );
                    })
                    .join("") +
                "</ul>";
        } catch (error) {
            target.innerHTML = errorMarkup(
                App.friendlyError(error, t("ops.logsError")),
                "logs"
            );
        }
    }

    /* Events --------------------------------------------------------------- */

    function findBooking(id) {
        return state.bookings.items.find((item) => item.id === id);
    }

    function findInventory(id) {
        return state.inventory.items.find((item) => item.id === id);
    }

    function findTask(id) {
        return state.maintenance.tasks.find((item) => item.id === id);
    }

    function bindSectionTabs() {
        container
            .querySelector(".tabs-inline")
            .addEventListener("click", (event) => {
                const button = event.target.closest("[data-ops-section]");

                if (button) {
                    activateSection(
                        button.getAttribute("data-ops-section")
                    );
                }
            });

        container
            .querySelector(".tabs-inline")
            .addEventListener("keydown", (event) => {
                const currentIndex = elements.sectionButtons.indexOf(
                    event.target.closest("[data-ops-section]")
                );

                if (currentIndex < 0) {
                    return;
                }

                let nextIndex = currentIndex;

                if (event.key === "ArrowRight") {
                    nextIndex =
                        (currentIndex + 1) %
                        elements.sectionButtons.length;
                } else if (event.key === "ArrowLeft") {
                    nextIndex =
                        (currentIndex - 1 + elements.sectionButtons.length) %
                        elements.sectionButtons.length;
                } else if (event.key === "Home") {
                    nextIndex = 0;
                } else if (event.key === "End") {
                    nextIndex = elements.sectionButtons.length - 1;
                } else {
                    return;
                }

                event.preventDefault();
                const next = elements.sectionButtons[nextIndex];
                activateSection(next.getAttribute("data-ops-section"));
                next.focus();
            });
    }

    function bindFilters() {
        if (elements.bookingSearch) {
            elements.bookingSearch.addEventListener("input", () => {
                state.bookings.search = elements.bookingSearch.value;
                window.clearTimeout(state.bookings.timer);
                state.bookings.timer = window.setTimeout(() => {
                    state.bookings.page = 1;
                    loadBookings(true);
                }, SEARCH_DELAY);
            });
        }

        if (elements.bookingStatus) {
            elements.bookingStatus.addEventListener("change", () => {
                state.bookings.status = elements.bookingStatus.value;
                state.bookings.page = 1;
                loadBookings(true);
            });
        }

        if (elements.inventorySearch) {
            elements.inventorySearch.addEventListener("input", () => {
                state.inventory.search = elements.inventorySearch.value;
                window.clearTimeout(state.inventory.timer);
                state.inventory.timer = window.setTimeout(() => {
                    state.inventory.page = 1;
                    loadInventory(true);
                }, SEARCH_DELAY);
            });
        }

        if (elements.lowOnly) {
            elements.lowOnly.addEventListener("change", () => {
                state.inventory.lowOnly = elements.lowOnly.checked;
                state.inventory.page = 1;
                loadInventory(true);
            });
        }

        if (elements.maintenanceSearch) {
            elements.maintenanceSearch.addEventListener("input", () => {
                state.maintenance.search =
                    elements.maintenanceSearch.value;
                window.clearTimeout(state.maintenance.timer);
                state.maintenance.timer = window.setTimeout(() => {
                    state.maintenance.page = 1;
                    loadMaintenance(true);
                }, SEARCH_DELAY);
            });
        }

        if (elements.maintenanceStatus) {
            elements.maintenanceStatus.addEventListener("change", () => {
                state.maintenance.status =
                    elements.maintenanceStatus.value;
                state.maintenance.page = 1;
                loadMaintenance(true);
            });
        }

        if (elements.overdue) {
            elements.overdue.addEventListener("change", () => {
                state.maintenance.overdue = elements.overdue.checked;
                state.maintenance.page = 1;
                loadMaintenance(true);
            });
        }

        if (elements.dueSoon) {
            elements.dueSoon.addEventListener("change", () => {
                state.maintenance.dueSoon = elements.dueSoon.checked;
                state.maintenance.page = 1;
                loadMaintenance(true);
            });
        }
    }

    function bindActions() {
        container.addEventListener("click", (event) => {
            const sectionButton = event.target.closest(
                "[data-ops-section]"
            );

            if (sectionButton) {
                return;
            }

            const refresh = event.target.closest("[data-ops-refresh]");

            if (refresh) {
                const kind = refresh.getAttribute("data-ops-refresh");
                const restore = App.buttonLoading(
                    refresh,
                    t("common.loading")
                );

                Promise.resolve(loadSection(kind, true)).finally(restore);
                return;
            }

            const retry = event.target.closest("[data-ops-retry]");

            if (retry) {
                const kind = retry.getAttribute("data-ops-retry");

                if (SECTIONS.includes(kind)) {
                    loadSection(kind, true);
                }

                return;
            }

            const page = event.target.closest("[data-ops-page]");

            if (page && !page.disabled) {
                const value = Number(page.getAttribute("data-ops-page"));
                const kind = page.getAttribute("data-ops-kind");

                if (Number.isInteger(value) && value >= 1) {
                    if (kind === "bookings") {
                        state.bookings.page = value;
                        loadBookings(true);
                    } else if (kind === "inventory") {
                        state.inventory.page = value;
                        loadInventory(true);
                    } else if (kind === "maintenance") {
                        state.maintenance.page = value;
                        loadMaintenance(true);
                    }
                }

                return;
            }

            const review = event.target.closest("[data-ops-review]");

            if (review) {
                const booking = findBooking(
                    review.getAttribute("data-ops-review")
                );

                if (booking) {
                    openBookingReview(booking);
                }

                return;
            }

            if (event.target.closest("[data-ops-add-item]")) {
                openInventoryDialog(null);
                return;
            }

            const editItem = event.target.closest(
                "[data-ops-edit-item]"
            );

            if (editItem) {
                const item = findInventory(
                    editItem.getAttribute("data-ops-edit-item")
                );

                if (item) {
                    openInventoryDialog(item);
                }

                return;
            }

            const adjust = event.target.closest("[data-ops-adjust]");

            if (adjust) {
                const item = findInventory(
                    adjust.getAttribute("data-ops-adjust")
                );

                if (item) {
                    openAdjustDialog(item);
                }

                return;
            }

            const ledger = event.target.closest("[data-ops-ledger]");

            if (ledger) {
                const item = findInventory(
                    ledger.getAttribute("data-ops-ledger")
                );

                if (item) {
                    openLedger(item);
                }

                return;
            }

            if (event.target.closest("[data-ops-add-task]")) {
                openTaskDialog(null);
                return;
            }

            const editTask = event.target.closest(
                "[data-ops-edit-task]"
            );

            if (editTask) {
                const task = findTask(
                    editTask.getAttribute("data-ops-edit-task")
                );

                if (task) {
                    openTaskDialog(task);
                }

                return;
            }

            const start = event.target.closest("[data-ops-start-task]");

            if (start) {
                const task = findTask(
                    start.getAttribute("data-ops-start-task")
                );

                if (task) {
                    startTask(task, start);
                }

                return;
            }

            const complete = event.target.closest(
                "[data-ops-complete-task]"
            );

            if (complete) {
                const task = findTask(
                    complete.getAttribute("data-ops-complete-task")
                );

                if (task) {
                    openCompleteDialog(task);
                }

                return;
            }

            const logs = event.target.closest("[data-ops-logs-task]");

            if (logs) {
                const task = findTask(
                    logs.getAttribute("data-ops-logs-task")
                );

                if (task) {
                    openTaskLogs(task);
                }
            }
        });
    }

    function bindEvents() {
        if (bound) {
            return;
        }

        bound = true;
        bindSectionTabs();
        bindFilters();
        bindActions();

        window.addEventListener("campusfix:languagechange", () => {
            if (!elements) {
                return;
            }

            I18N.apply(container);

            if (elements.scope) {
                elements.scope.textContent = state.isAdmin
                    ? t("ops.scopeAll")
                    : state.user.role === "department_manager"
                      ? t("ops.bookingScope")
                      : t("ops.staffHint");
            }

            renderInventorySummary();
            renderMaintenanceSummary();

            if (state.bookings.loaded && !state.bookings.error) {
                renderBookings();
            }

            if (state.inventory.loaded && !state.inventory.error) {
                renderInventory();
            }

            if (
                state.maintenance.loaded &&
                !state.maintenance.error
            ) {
                renderMaintenance();
            }
        });
    }

    /* Public API ----------------------------------------------------------- */

    const ready = (async () => {
        const user = await Shell.ready;

        if (!user || !container) {
            return null;
        }

        state.user = user;
        state.isAdmin = user.role === "admin";
        state.canManage = ["admin", "department_manager"].includes(
            user.role
        );

        buildUi();
        bindEvents();

        return user;
    })();

    async function load() {
        const user = await ready;

        if (!user) {
            return;
        }

        await activateSection(state.section, { skipLoad: true });
        await loadSection(state.section, true);
    }

    window.CampusFixOperations = {
        load,
        refresh: () => loadSection(state.section, true)
    };
})();
