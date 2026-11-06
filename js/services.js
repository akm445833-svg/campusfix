/* CampusFix campus services: facility booking and the shared Lost & Found board. */
(function () {
    "use strict";

    const App = window.CampusFix;
    const I18N = window.CampusFixI18n;

    if (!App || !I18N || !window.CampusFixShell) {
        return;
    }

    const SEARCH_DELAY = 280;
    const PAGE_SIZE = 12;
    const TAB_IDS = ["facilities", "lost-found"];

    const elements = {
        operationsLink: document.getElementById("operationsLink"),
        tabList: document.querySelector(".tabs"),
        tabButtons: Array.prototype.slice.call(
            document.querySelectorAll("[data-service-tab]")
        ),
        tabPanels: Array.prototype.slice.call(
            document.querySelectorAll("[data-service-panel]")
        ),

        facilityGrid: document.getElementById("facilityGrid"),
        openBooking: document.getElementById("openBookingButton"),

        bookingsCount: document.getElementById("myBookingsCount"),
        bookingList: document.getElementById("bookingList"),
        refreshBookings: document.getElementById("refreshBookings"),

        lostFoundCount: document.getElementById("lostFoundCount"),
        openLostFound: document.getElementById("openLostFoundButton"),
        lostFoundSearch: document.getElementById("lostFoundSearch"),
        lostFoundType: document.getElementById("lostFoundType"),
        lostFoundStatus: document.getElementById("lostFoundStatus"),
        lostFoundList: document.getElementById("lostFoundList"),

        bookingDialog: document.getElementById("bookingDialog"),
        bookingForm: document.getElementById("bookingForm"),
        bookingFacility: document.getElementById("bookingFacility"),
        bookingFacilityHint: document.getElementById("bookingFacilityHint"),
        bookingTitle: document.getElementById("bookingTitle"),
        bookingStart: document.getElementById("bookingStart"),
        bookingEnd: document.getElementById("bookingEnd"),
        bookingAttendees: document.getElementById("bookingAttendees"),
        bookingPurpose: document.getElementById("bookingPurpose"),
        bookingSubmit: document.getElementById("bookingSubmit"),

        lostFoundDialog: document.getElementById("lostFoundDialog"),
        lostFoundForm: document.getElementById("lostFoundForm"),
        lostFoundFormType: document.getElementById("lostFoundFormType"),
        lostFoundCategory: document.getElementById("lostFoundCategory"),
        lostFoundFormTitle: document.getElementById("lostFoundFormTitle"),
        lostFoundDescription: document.getElementById("lostFoundDescription"),
        lostFoundLocation: document.getElementById("lostFoundLocation"),
        lostFoundOccurred: document.getElementById("lostFoundOccurred"),
        lostFoundContact: document.getElementById("lostFoundContact"),
        lostFoundSubmit: document.getElementById("lostFoundSubmit")
    };

    const state = {
        user: null,
        tab: "facilities",
        facilities: [],
        facilitiesLoaded: false,
        facilitiesLoading: false,
        facilitiesError: false,

        bookings: [],
        bookingsPagination: null,
        bookingsPage: 1,
        bookingsLoaded: false,
        bookingsLoading: false,
        bookingsError: false,

        lostFound: [],
        lostFoundPagination: null,
        lostFoundPage: 1,
        lostFoundSearch: "",
        lostFoundType: "",
        lostFoundStatus: "",
        lostFoundLoaded: false,
        lostFoundLoading: false,
        lostFoundError: false,

        searchTimer: null,
        bookingBusy: false,
        lostFoundBusy: false
    };

    const escape = App.escapeHTML;
    const icon = (name) => App.icon(name);
    const t = (key, vars) => I18N.t(key, vars);
    const count = (value) => I18N.formatNumber(value);

    function isOperations() {
        return Boolean(state.user && state.user.role !== "student");
    }

    function bookingStatusLabel(status) {
        return t("bookingStatus." + status);
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

    function lostFoundStatusLabel(status) {
        return t("lostFoundStatus." + status);
    }

    function lostFoundStatusTone(status) {
        return {
            open: "assigned",
            claimed: "resolved",
            closed: "neutral"
        }[status] || "neutral";
    }

    function lostFoundTypeLabel(type) {
        return t("lostFoundType." + type);
    }

    function badge(label, tone, dot) {
        return (
            '<span class="badge" data-tone="' +
            escape(tone) +
            '">' +
            (dot ? '<span class="badge-dot"></span>' : "") +
            escape(label) +
            "</span>"
        );
    }

    function pad(value) {
        return String(value).padStart(2, "0");
    }

    function toLocalInput(date) {
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

    function defaultBookingWindow() {
        const start = new Date();
        start.setSeconds(0, 0);
        start.setMinutes(0);
        start.setHours(start.getHours() + 1);
        const end = new Date(start.getTime() + 60 * 60 * 1000);

        return { start, end };
    }

    function timeValue(value) {
        return String(value || "").slice(0, 5);
    }

    function bookingWhen(booking) {
        return (
            I18N.formatDateTime(booking.startsAt) +
            " → " +
            I18N.formatDateTime(booking.endsAt)
        );
    }

    function paginationMarkup(prefix, pagination) {
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
            '<button type="button" class="page-btn" data-' +
            prefix +
            '-page="' +
            (pagination.page - 1) +
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
            '<button type="button" class="page-btn" data-' +
            prefix +
            '-page="' +
            (pagination.page + 1) +
            '" aria-label="' +
            escape(t("common.next")) +
            '"' +
            (pagination.page >= pages ? " disabled" : "") +
            ">" +
            icon("chevron-right") +
            "</button></div></div>"
        );
    }

    function skeletonCards(classes, count_) {
        let markup = "";

        for (let index = 0; index < count_; index += 1) {
            markup +=
                '<div class="' +
                classes +
                '" aria-hidden="true">' +
                '<span class="skeleton skeleton-line" style="width:34%"></span>' +
                '<span class="skeleton skeleton-line" style="width:70%;height:17px"></span>' +
                '<span class="skeleton skeleton-line" style="width:94%"></span>' +
                '<span class="skeleton skeleton-line" style="width:58%"></span>' +
                "</div>";
        }

        return markup;
    }

    function errorMarkup(message, retry) {
        return (
            '<div class="error-state"><span aria-hidden="true">' +
            icon("alert-circle") +
            "</span><div><strong>" +
            escape(t("common.errorTitle")) +
            "</strong><p>" +
            escape(message) +
            '</p><button type="button" class="btn btn-secondary btn-sm" data-service-retry="' +
            escape(retry) +
            '" style="margin-top:9px">' +
            escape(t("common.retry")) +
            "</button></div></div>"
        );
    }

    function emptyMarkup(iconName, title, body, action) {
        return (
            '<div class="empty-state"><span class="empty-icon">' +
            icon(iconName) +
            "</span><h3>" +
            escape(title) +
            "</h3><p>" +
            escape(body) +
            "</p>" +
            (action || "") +
            "</div>"
        );
    }

    /* Tabs ----------------------------------------------------------------- */

    function activateTab(tab, options) {
        const settings = options || {};
        const target = TAB_IDS.includes(tab) ? tab : "facilities";

        state.tab = target;

        elements.tabButtons.forEach((button) => {
            const active = button.getAttribute("data-service-tab") === target;
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-selected", String(active));
            button.tabIndex = active ? 0 : -1;
        });

        elements.tabPanels.forEach((panel) => {
            panel.hidden =
                panel.getAttribute("data-service-panel") !== target;
        });

        if (settings.updateUrl !== false) {
            const url = new URL(window.location.href);

            if (target === "facilities") {
                url.searchParams.delete("tab");
            } else {
                url.searchParams.set("tab", target);
            }

            window.history.replaceState(
                null,
                "",
                url.pathname + url.search + url.hash
            );
        }

        if (target === "facilities") {
            if (!state.facilitiesLoaded) {
                loadFacilities();
            }

            loadBookings();
        } else if (!state.lostFoundLoaded) {
            loadLostFound();
        }
    }

    function readTab() {
        const tab = new URLSearchParams(window.location.search).get("tab");
        return TAB_IDS.includes(tab) ? tab : "facilities";
    }

    /* Facilities ----------------------------------------------------------- */

    function facilityCard(facility) {
        const open = timeValue(facility.opensAt);
        const close = timeValue(facility.closesAt);
        const description = facility.description
            ? '<p class="facility-description">' +
              escape(facility.description) +
              "</p>"
            : "";

        return (
            '<article class="facility-card">' +
            '<div class="facility-card-head">' +
            '<span class="facility-glyph" aria-hidden="true">' +
            icon("building") +
            "</span><div><h3>" +
            escape(facility.name) +
            '</h3><p class="facility-location">' +
            icon("map-pin") +
            escape(facility.location) +
            "</p></div></div>" +
            description +
            '<dl class="facility-facts">' +
            "<div><dt>" +
            escape(t("services.capacityLabel")) +
            "</dt><dd>" +
            escape(t("services.capacityValue", { count: count(facility.capacity) })) +
            "</dd></div>" +
            "<div><dt>" +
            escape(t("services.hoursLabel")) +
            "</dt><dd>" +
            escape(open) +
            " – " +
            escape(close) +
            "</dd></div>" +
            "<div><dt>" +
            escape(t("common.department")) +
            "</dt><dd>" +
            escape(facility.departmentName || t("common.unknown")) +
            "</dd></div></dl>" +
            '<button type="button" class="btn btn-secondary btn-sm" data-book-facility="' +
            escape(facility.id) +
            '">' +
            icon("calendar-plus") +
            escape(t("services.bookThis")) +
            "</button></article>"
        );
    }

    function renderFacilities() {
        if (!elements.facilityGrid) {
            return;
        }

        elements.facilityGrid.setAttribute("aria-busy", "false");

        if (state.facilities.length === 0) {
            elements.facilityGrid.innerHTML = emptyMarkup(
                "calendar",
                t("services.noFacilitiesTitle"),
                t("services.noFacilitiesBody")
            );
            return;
        }

        elements.facilityGrid.innerHTML = state.facilities
            .map(facilityCard)
            .join("");
    }

    async function loadFacilities() {
        if (!elements.facilityGrid || state.facilitiesLoading) {
            return;
        }

        state.facilitiesLoading = true;
        state.facilitiesError = false;
        elements.facilityGrid.setAttribute("aria-busy", "true");
        elements.facilityGrid.innerHTML = skeletonCards(
            "facility-card is-skeleton",
            6
        );

        try {
            const data = await App.api.get("/facilities");
            state.facilities = Array.isArray(data.facilities)
                ? data.facilities
                : [];
            state.facilitiesLoaded = true;
            populateFacilityOptions();
            renderFacilities();
        } catch (error) {
            state.facilitiesLoaded = false;
            state.facilitiesError = true;
            elements.facilityGrid.setAttribute("aria-busy", "false");
            elements.facilityGrid.innerHTML = errorMarkup(
                App.friendlyError(error, t("services.facilityLoadError")),
                "facilities"
            );
        } finally {
            state.facilitiesLoading = false;
        }
    }

    function populateFacilityOptions() {
        if (!elements.bookingFacility) {
            return;
        }

        const options = state.facilities.map((facility) => {
            return (
                '<option value="' +
                escape(facility.id) +
                '">' +
                escape(facility.name) +
                "</option>"
            );
        });

        elements.bookingFacility.innerHTML = options.join("");
        updateFacilityHint();
    }

    function updateFacilityHint() {
        if (!elements.bookingFacilityHint) {
            return;
        }

        const facility = state.facilities.find(
            (item) => item.id === elements.bookingFacility.value
        );

        if (!facility) {
            elements.bookingFacilityHint.textContent = "";
            return;
        }

        elements.bookingFacilityHint.textContent =
            facility.location +
            " · " +
            t("services.capacityValue", {
                count: count(facility.capacity)
            }) +
            " · " +
            timeValue(facility.opensAt) +
            " – " +
            timeValue(facility.closesAt);
    }

    /* Bookings ------------------------------------------------------------- */

    function bookingCard(booking) {
        const cancellable = ["Pending", "Approved"].includes(booking.status);
        const decisionNote = booking.decisionNote
            ? '<p class="booking-note">' +
              escape(booking.decisionNote) +
              "</p>"
            : "";

        return (
            '<article class="booking-card">' +
            '<div class="booking-card-head"><div class="cluster cluster-tight">' +
            badge(
                bookingStatusLabel(booking.status),
                bookingStatusTone(booking.status),
                true
            ) +
            '<span class="text-xs subtle mono">' +
            escape(booking.facility.code) +
            "</span></div>" +
            '<time class="text-xs subtle" datetime="' +
            escape(booking.createdAt || "") +
            '">' +
            escape(I18N.formatRelative(booking.createdAt)) +
            "</time></div>" +
            "<h3>" +
            escape(booking.title) +
            '</h3><p class="booking-facility">' +
            escape(booking.facility.name) +
            " · " +
            escape(booking.facility.location) +
            "</p>" +
            '<dl class="booking-facts">' +
            "<div><dt>" +
            escape(t("services.startTime")) +
            "</dt><dd>" +
            escape(I18N.formatDateTime(booking.startsAt)) +
            "</dd></div>" +
            "<div><dt>" +
            escape(t("services.endTime")) +
            "</dt><dd>" +
            escape(I18N.formatDateTime(booking.endsAt)) +
            "</dd></div>" +
            "<div><dt>" +
            escape(t("services.attendees")) +
            "</dt><dd>" +
            escape(count(booking.attendees)) +
            "</dd></div>" +
            (booking.reviewedBy
                ? "<div><dt>" +
                  escape(t("services.reviewedBy")) +
                  "</dt><dd>" +
                  escape(booking.reviewedBy) +
                  "</dd></div>"
                : "") +
            "</dl>" +
            decisionNote +
            (cancellable
                ? '<div class="booking-actions"><button type="button" class="btn btn-ghost btn-sm" data-cancel-booking="' +
                  escape(booking.id) +
                  '">' +
                  escape(t("services.cancelBooking")) +
                  "</button></div>"
                : "") +
            "</article>"
        );
    }

    function renderBookings() {
        if (!elements.bookingList) {
            return;
        }

        elements.bookingList.setAttribute("aria-busy", "false");

        if (elements.bookingsCount) {
            elements.bookingsCount.textContent =
                state.bookingsPagination &&
                state.bookingsPagination.total === 1
                    ? t("services.bookingCountOne")
                    : t("services.bookingCount", {
                          count: count(
                              state.bookingsPagination
                                  ? state.bookingsPagination.total
                                  : state.bookings.length
                          )
                      });
        }

        if (state.bookings.length === 0) {
            elements.bookingList.innerHTML = emptyMarkup(
                "calendar",
                t("services.noBookingsTitle"),
                t("services.noBookingsBody")
            );
            return;
        }

        elements.bookingList.innerHTML =
            '<div class="booking-list">' +
            state.bookings.map(bookingCard).join("") +
            "</div>" +
            paginationMarkup("bookings", state.bookingsPagination);
    }

    async function loadBookings() {
        if (!elements.bookingList || state.bookingsLoading) {
            return;
        }

        state.bookingsLoading = true;
        state.bookingsError = false;
        elements.bookingList.setAttribute("aria-busy", "true");
        elements.bookingList.innerHTML = skeletonCards(
            "booking-card is-skeleton",
            3
        );

        if (elements.bookingsCount) {
            elements.bookingsCount.textContent = t("common.loading");
        }

        try {
            const params = new URLSearchParams({
                page: String(state.bookingsPage),
                pageSize: String(PAGE_SIZE)
            });
            const data = await App.api.get(
                "/facilities/bookings/mine?" + params.toString()
            );

            state.bookings = Array.isArray(data.bookings)
                ? data.bookings
                : [];
            state.bookingsPagination = data.pagination || null;
            state.bookingsLoaded = true;
            renderBookings();
        } catch (error) {
            state.bookings = [];
            state.bookingsPagination = null;
            state.bookingsError = true;
            elements.bookingList.setAttribute("aria-busy", "false");
            elements.bookingList.innerHTML = errorMarkup(
                App.friendlyError(error, t("services.bookingsLoadError")),
                "bookings"
            );
        } finally {
            state.bookingsLoading = false;
        }
    }

    function openBookingDialog(facilityId) {
        if (!elements.bookingDialog) {
            return;
        }

        if (state.facilities.length === 0) {
            App.toast(t("services.noFacilitiesTitle"), "warning");
            return;
        }

        App.clearFieldErrors(elements.bookingForm);
        populateFacilityOptions();

        if (facilityId) {
            elements.bookingFacility.value = facilityId;
        }

        const window_ = defaultBookingWindow();

        elements.bookingStart.value = toLocalInput(window_.start);
        elements.bookingEnd.value = toLocalInput(window_.end);
        elements.bookingStart.min = toLocalInput(new Date());
        elements.bookingEnd.min = toLocalInput(window_.start);
        elements.bookingTitle.value = "";
        elements.bookingPurpose.value = "";

        const facility = state.facilities.find(
            (item) => item.id === elements.bookingFacility.value
        );

        elements.bookingAttendees.value = "1";
        elements.bookingAttendees.max = facility
            ? String(facility.capacity)
            : "100000";
        updateFacilityHint();

        elements.bookingDialog.showModal();
        elements.bookingTitle.focus();
    }

    function closeBookingDialog() {
        if (elements.bookingDialog && elements.bookingDialog.open) {
            elements.bookingDialog.close();
        }
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
                App.fieldError(
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

    async function submitBooking(event) {
        event.preventDefault();

        if (state.bookingBusy) {
            return;
        }

        App.clearFieldErrors(elements.bookingForm);

        const start = new Date(elements.bookingStart.value);
        const end = new Date(elements.bookingEnd.value);

        if (
            Number.isNaN(start.getTime()) ||
            Number.isNaN(end.getTime()) ||
            end.getTime() <= start.getTime()
        ) {
            App.fieldError(elements.bookingEnd, t("services.endAfterStart"));
            elements.bookingEnd.focus();
            return;
        }

        const restore = App.buttonLoading(
            elements.bookingSubmit,
            t("common.processing")
        );

        state.bookingBusy = true;

        try {
            await App.api.post("/facilities/bookings", {
                facilityId: elements.bookingFacility.value,
                title: elements.bookingTitle.value.trim(),
                startsAt: start.toISOString(),
                endsAt: end.toISOString(),
                attendees: Number(elements.bookingAttendees.value || 1),
                purpose: elements.bookingPurpose.value.trim()
            });

            closeBookingDialog();
            App.toast(t("services.bookingCreated"), "success");
            state.bookingsPage = 1;
            await loadBookings();
        } catch (error) {
            applyServerErrors(elements.bookingForm, error);
        } finally {
            state.bookingBusy = false;
            restore();
        }
    }

    async function cancelBooking(id, button) {
        const booking = state.bookings.find((item) => item.id === id);
        const confirmed = await App.confirm({
            title: t("services.cancelBookingTitle"),
            message: t("services.cancelBookingBody"),
            confirmLabel: t("services.cancelBooking"),
            cancelLabel: t("common.notNow")
        });

        if (!confirmed) {
            return;
        }

        const restore = App.buttonLoading(
            button,
            t("common.processing")
        );

        try {
            await App.api.post(
                "/facilities/bookings/" +
                    encodeURIComponent(id) +
                    "/cancel"
            );
            App.toast(t("services.bookingCancelled"), "success");
            await loadBookings();
        } catch (error) {
            App.toast(
                App.friendlyError(error, t("services.cancelBookingError")),
                "error"
            );
            restore();
        } finally {
            if (!booking || booking.status !== "Cancelled") {
                /* The list re-render replaces the button after a success. */
            }
        }
    }

    /* Lost & Found --------------------------------------------------------- */

    function lostFoundActions(item) {
        const canManage =
            isOperations() ||
            Boolean(item.reporter && item.reporter.id === state.user.id);
        const canDelete =
            Boolean(state.user.role === "admin") ||
            Boolean(item.reporter && item.reporter.id === state.user.id);
        const actions = [];

        if (canManage) {
            if (item.status !== "claimed") {
                actions.push(
                    '<button type="button" class="btn btn-secondary btn-sm" data-item-status="claimed" data-item-id="' +
                        escape(item.id) +
                        '">' +
                        escape(t("services.markClaimed")) +
                        "</button>"
                );
            }

            if (item.status !== "open") {
                actions.push(
                    '<button type="button" class="btn btn-secondary btn-sm" data-item-status="open" data-item-id="' +
                        escape(item.id) +
                        '">' +
                        escape(t("services.markOpen")) +
                        "</button>"
                );
            }

            if (item.status !== "closed") {
                actions.push(
                    '<button type="button" class="btn btn-ghost btn-sm" data-item-status="closed" data-item-id="' +
                        escape(item.id) +
                        '">' +
                        escape(t("services.markClosed")) +
                        "</button>"
                );
            }
        }

        if (canDelete) {
            actions.push(
                '<button type="button" class="btn btn-ghost btn-sm btn-danger" data-item-delete="' +
                    escape(item.id) +
                    '">' +
                    escape(t("common.delete")) +
                    "</button>"
            );
        }

        if (actions.length === 0) {
            return "";
        }

        return '<div class="item-actions">' + actions.join("") + "</div>";
    }

    function lostFoundCard(item) {
        const occurred = item.occurredAt
            ? '<div><dt>' +
              escape(t("services.occurredAt")) +
              "</dt><dd>" +
              escape(I18N.formatDate(item.occurredAt)) +
              "</dd></div>"
            : "";
        const contact = item.contact
            ? '<p class="item-contact">' +
              icon("mail") +
              " " +
              escape(item.contact) +
              "</p>"
            : "";
        const claimedBy = item.claimedBy
            ? '<p class="text-xs subtle">' +
              escape(
                  t("services.claimedBy", {
                      name: item.claimedBy.name
                  })
              ) +
              "</p>"
            : "";

        return (
            '<article class="lost-found-card">' +
            '<div class="lost-found-card-head"><div class="cluster cluster-tight">' +
            badge(
                lostFoundTypeLabel(item.type),
                item.type === "lost" ? "high" : "medium",
                false
            ) +
            badge(
                lostFoundStatusLabel(item.status),
                lostFoundStatusTone(item.status),
                true
            ) +
            '<span class="text-xs subtle">' +
            escape(item.category) +
            "</span></div>" +
            '<time class="text-xs subtle" datetime="' +
            escape(item.createdAt || "") +
            '">' +
            escape(I18N.formatRelative(item.createdAt)) +
            "</time></div>" +
            "<h3>" +
            escape(item.title) +
            '</h3><p class="item-description">' +
            escape(item.description) +
            '</p><dl class="item-facts">' +
            "<div><dt>" +
            escape(t("services.location")) +
            "</dt><dd>" +
            escape(item.location) +
            "</dd></div>" +
            occurred +
            (item.reporter
                ? "<div><dt>" +
                  escape(t("services.reportedBy")) +
                  "</dt><dd>" +
                  escape(item.reporter.name) +
                  "</dd></div>"
                : "") +
            "</dl>" +
            claimedBy +
            contact +
            lostFoundActions(item) +
            "</article>"
        );
    }

    function renderLostFound() {
        if (!elements.lostFoundList) {
            return;
        }

        elements.lostFoundList.setAttribute("aria-busy", "false");

        if (elements.lostFoundCount) {
            elements.lostFoundCount.textContent =
                state.lostFoundPagination &&
                state.lostFoundPagination.total === 1
                    ? t("services.lostFoundCountOne")
                    : t("services.lostFoundCount", {
                          count: count(
                              state.lostFoundPagination
                                  ? state.lostFoundPagination.total
                                  : state.lostFound.length
                          )
                      });
        }

        if (state.lostFound.length === 0) {
            const filtered = Boolean(
                state.lostFoundSearch.trim() ||
                    state.lostFoundType ||
                    state.lostFoundStatus
            );

            elements.lostFoundList.innerHTML = emptyMarkup(
                filtered ? "search" : "inbox",
                t(
                    filtered
                        ? "services.noItemsFilteredTitle"
                        : "services.noItemsTitle"
                ),
                t(
                    filtered
                        ? "services.noItemsFilteredBody"
                        : "services.noItemsBody"
                ),
                filtered
                    ? '<button type="button" class="btn btn-secondary btn-sm" data-clear-item-filters style="margin-top:8px">' +
                      escape(t("services.clearFilters")) +
                      "</button>"
                    : ""
            );
            return;
        }

        elements.lostFoundList.innerHTML =
            '<div class="lost-found-grid">' +
            state.lostFound.map(lostFoundCard).join("") +
            "</div>" +
            paginationMarkup("lost-found", state.lostFoundPagination);
    }

    async function loadLostFound() {
        if (!elements.lostFoundList || state.lostFoundLoading) {
            return;
        }

        state.lostFoundLoading = true;
        state.lostFoundError = false;
        elements.lostFoundList.setAttribute("aria-busy", "true");
        elements.lostFoundList.innerHTML = skeletonCards(
            "lost-found-card is-skeleton",
            4
        );

        if (elements.lostFoundCount) {
            elements.lostFoundCount.textContent = t("common.loading");
        }

        const params = new URLSearchParams({
            page: String(state.lostFoundPage),
            pageSize: String(PAGE_SIZE)
        });

        if (state.lostFoundSearch.trim()) {
            params.set("search", state.lostFoundSearch.trim());
        }

        if (state.lostFoundType) {
            params.set("type", state.lostFoundType);
        }

        if (state.lostFoundStatus) {
            params.set("status", state.lostFoundStatus);
        }

        try {
            const data = await App.api.get(
                "/lost-found?" + params.toString()
            );

            state.lostFound = Array.isArray(data.items) ? data.items : [];
            state.lostFoundPagination = data.pagination || null;
            state.lostFoundLoaded = true;
            renderLostFound();
        } catch (error) {
            state.lostFound = [];
            state.lostFoundPagination = null;
            state.lostFoundError = true;
            elements.lostFoundList.setAttribute("aria-busy", "false");
            elements.lostFoundList.innerHTML = errorMarkup(
                App.friendlyError(error, t("services.lostFoundLoadError")),
                "lost-found"
            );
        } finally {
            state.lostFoundLoading = false;
        }
    }

    function openLostFoundDialog() {
        if (!elements.lostFoundDialog) {
            return;
        }

        App.clearFieldErrors(elements.lostFoundForm);
        elements.lostFoundFormType.value = "lost";
        elements.lostFoundCategory.value = "Other";
        elements.lostFoundFormTitle.value = "";
        elements.lostFoundDescription.value = "";
        elements.lostFoundLocation.value = "";
        elements.lostFoundOccurred.value = toLocalInput(new Date());
        elements.lostFoundContact.value = "";
        elements.lostFoundDialog.showModal();
        elements.lostFoundFormTitle.focus();
    }

    function closeLostFoundDialog() {
        if (elements.lostFoundDialog && elements.lostFoundDialog.open) {
            elements.lostFoundDialog.close();
        }
    }

    async function submitLostFound(event) {
        event.preventDefault();

        if (state.lostFoundBusy) {
            return;
        }

        App.clearFieldErrors(elements.lostFoundForm);
        const restore = App.buttonLoading(
            elements.lostFoundSubmit,
            t("common.processing")
        );

        state.lostFoundBusy = true;

        try {
            const occurred = elements.lostFoundOccurred.value
                ? new Date(elements.lostFoundOccurred.value)
                : null;

            await App.api.post("/lost-found", {
                type: elements.lostFoundFormType.value,
                category: elements.lostFoundCategory.value.trim() || "Other",
                title: elements.lostFoundFormTitle.value.trim(),
                description: elements.lostFoundDescription.value.trim(),
                location: elements.lostFoundLocation.value.trim(),
                occurredAt:
                    occurred && !Number.isNaN(occurred.getTime())
                        ? occurred.toISOString()
                        : undefined,
                contact: elements.lostFoundContact.value.trim()
            });

            closeLostFoundDialog();
            App.toast(t("services.itemReported"), "success");
            state.lostFoundSearch = "";
            state.lostFoundType = "";
            state.lostFoundStatus = "";
            state.lostFoundPage = 1;

            if (elements.lostFoundSearch) {
                elements.lostFoundSearch.value = "";
            }

            if (elements.lostFoundType) {
                elements.lostFoundType.value = "";
            }

            if (elements.lostFoundStatus) {
                elements.lostFoundStatus.value = "";
            }

            await loadLostFound();
        } catch (error) {
            applyServerErrors(elements.lostFoundForm, error);
        } finally {
            state.lostFoundBusy = false;
            restore();
        }
    }

    async function updateItemStatus(id, status, button) {
        if (status === "closed") {
            const confirmed = await App.confirm({
                title: t("services.markClosedTitle"),
                message: t("services.markClosedBody"),
                confirmLabel: t("services.markClosed")
            });

            if (!confirmed) {
                return;
            }
        }

        const restore = App.buttonLoading(
            button,
            t("common.processing")
        );

        try {
            await App.api.patch(
                "/lost-found/" + encodeURIComponent(id) + "/status",
                { status }
            );
            App.toast(t("services.itemUpdated"), "success");
            await loadLostFound();
        } catch (error) {
            App.toast(
                App.friendlyError(error, t("services.itemUpdateError")),
                "error"
            );
            restore();
        }
    }

    async function deleteItem(id, button) {
        const confirmed = await App.confirm({
            title: t("services.deleteItemTitle"),
            message: t("services.deleteItemBody"),
            confirmLabel: t("common.delete")
        });

        if (!confirmed) {
            return;
        }

        const restore = App.buttonLoading(
            button,
            t("common.processing")
        );

        try {
            await App.api.del("/lost-found/" + encodeURIComponent(id));
            App.toast(t("services.itemDeleted"), "success");
            await loadLostFound();
        } catch (error) {
            App.toast(
                App.friendlyError(error, t("services.itemDeleteError")),
                "error"
            );
            restore();
        }
    }

    function clearItemFilters() {
        state.lostFoundSearch = "";
        state.lostFoundType = "";
        state.lostFoundStatus = "";
        state.lostFoundPage = 1;
        window.clearTimeout(state.searchTimer);

        if (elements.lostFoundSearch) {
            elements.lostFoundSearch.value = "";
        }

        if (elements.lostFoundType) {
            elements.lostFoundType.value = "";
        }

        if (elements.lostFoundStatus) {
            elements.lostFoundStatus.value = "";
        }

        loadLostFound();
    }

    /* Events --------------------------------------------------------------- */

    function bindEvents() {
        if (elements.tabList) {
            elements.tabList.addEventListener("click", (event) => {
                const button = event.target.closest("[data-service-tab]");

                if (!button) {
                    return;
                }

                activateTab(button.getAttribute("data-service-tab"));
            });

            elements.tabList.addEventListener("keydown", (event) => {
                const buttons = elements.tabButtons;
                const currentIndex = buttons.indexOf(
                    event.target.closest("[data-service-tab]")
                );

                if (currentIndex < 0) {
                    return;
                }

                let nextIndex = currentIndex;

                if (event.key === "ArrowRight") {
                    nextIndex = (currentIndex + 1) % buttons.length;
                } else if (event.key === "ArrowLeft") {
                    nextIndex =
                        (currentIndex - 1 + buttons.length) %
                        buttons.length;
                } else if (event.key === "Home") {
                    nextIndex = 0;
                } else if (event.key === "End") {
                    nextIndex = buttons.length - 1;
                } else {
                    return;
                }

                event.preventDefault();
                const next = buttons[nextIndex];
                activateTab(next.getAttribute("data-service-tab"));
                next.focus();
            });
        }

        if (elements.openBooking) {
            elements.openBooking.addEventListener("click", () =>
                openBookingDialog(null)
            );
        }

        if (elements.facilityGrid) {
            elements.facilityGrid.addEventListener("click", (event) => {
                const book = event.target.closest("[data-book-facility]");

                if (book) {
                    openBookingDialog(
                        book.getAttribute("data-book-facility")
                    );
                    return;
                }

                if (event.target.closest('[data-service-retry="facilities"]')) {
                    loadFacilities();
                }
            });
        }

        if (elements.refreshBookings) {
            elements.refreshBookings.addEventListener("click", () => {
                const restore = App.buttonLoading(
                    elements.refreshBookings,
                    t("common.loading")
                );

                Promise.resolve(loadBookings()).finally(restore);
            });
        }

        if (elements.bookingList) {
            elements.bookingList.addEventListener("click", (event) => {
                const cancel = event.target.closest("[data-cancel-booking]");

                if (cancel) {
                    cancelBooking(
                        cancel.getAttribute("data-cancel-booking"),
                        cancel
                    );
                    return;
                }

                const page = event.target.closest("[data-bookings-page]");

                if (page && !page.disabled) {
                    const value = Number(
                        page.getAttribute("data-bookings-page")
                    );

                    if (Number.isInteger(value) && value >= 1) {
                        state.bookingsPage = value;
                        loadBookings();
                    }

                    return;
                }

                if (
                    event.target.closest('[data-service-retry="bookings"]')
                ) {
                    loadBookings();
                }
            });
        }

        if (elements.openLostFound) {
            elements.openLostFound.addEventListener(
                "click",
                openLostFoundDialog
            );
        }

        if (elements.lostFoundSearch) {
            elements.lostFoundSearch.addEventListener("input", () => {
                state.lostFoundSearch = elements.lostFoundSearch.value;
                window.clearTimeout(state.searchTimer);
                state.searchTimer = window.setTimeout(() => {
                    state.lostFoundPage = 1;
                    loadLostFound();
                }, SEARCH_DELAY);
            });
        }

        if (elements.lostFoundType) {
            elements.lostFoundType.addEventListener("change", () => {
                state.lostFoundType = elements.lostFoundType.value;
                state.lostFoundPage = 1;
                window.clearTimeout(state.searchTimer);
                loadLostFound();
            });
        }

        if (elements.lostFoundStatus) {
            elements.lostFoundStatus.addEventListener("change", () => {
                state.lostFoundStatus = elements.lostFoundStatus.value;
                state.lostFoundPage = 1;
                window.clearTimeout(state.searchTimer);
                loadLostFound();
            });
        }

        if (elements.lostFoundList) {
            elements.lostFoundList.addEventListener("click", (event) => {
                const status = event.target.closest("[data-item-status]");

                if (status) {
                    updateItemStatus(
                        status.getAttribute("data-item-id"),
                        status.getAttribute("data-item-status"),
                        status
                    );
                    return;
                }

                const remove = event.target.closest("[data-item-delete]");

                if (remove) {
                    deleteItem(
                        remove.getAttribute("data-item-delete"),
                        remove
                    );
                    return;
                }

                const page = event.target.closest("[data-lost-found-page]");

                if (page && !page.disabled) {
                    const value = Number(
                        page.getAttribute("data-lost-found-page")
                    );

                    if (Number.isInteger(value) && value >= 1) {
                        state.lostFoundPage = value;
                        loadLostFound();
                    }

                    return;
                }

                if (event.target.closest("[data-clear-item-filters]")) {
                    clearItemFilters();
                    return;
                }

                if (
                    event.target.closest('[data-service-retry="lost-found"]')
                ) {
                    loadLostFound();
                }
            });
        }

        document
            .querySelectorAll("[data-close-booking]")
            .forEach((button) => {
                button.addEventListener("click", closeBookingDialog);
            });

        document
            .querySelectorAll("[data-close-lost-found]")
            .forEach((button) => {
                button.addEventListener("click", closeLostFoundDialog);
            });

        if (elements.bookingFacility) {
            elements.bookingFacility.addEventListener("change", () => {
                const facility = state.facilities.find(
                    (item) => item.id === elements.bookingFacility.value
                );

                elements.bookingAttendees.max = facility
                    ? String(facility.capacity)
                    : "100000";
                updateFacilityHint();
            });
        }

        if (elements.bookingStart) {
            elements.bookingStart.addEventListener("change", () => {
                const start = new Date(elements.bookingStart.value);

                if (!Number.isNaN(start.getTime())) {
                    elements.bookingEnd.min = toLocalInput(start);
                }
            });
        }

        if (elements.bookingForm) {
            elements.bookingForm.addEventListener("submit", submitBooking);
        }

        if (elements.lostFoundForm) {
            elements.lostFoundForm.addEventListener(
                "submit",
                submitLostFound
            );
        }

        window.addEventListener("campusfix:languagechange", () => {
            if (state.facilitiesLoaded) {
                renderFacilities();
                populateFacilityOptions();
            }

            if (state.bookingsLoaded) {
                renderBookings();
            }

            if (state.lostFoundLoaded) {
                renderLostFound();
            }
        });
    }

    async function init() {
        const user = await window.CampusFixShell.ready;

        if (!user) {
            return;
        }

        state.user = user;

        if (elements.operationsLink) {
            elements.operationsLink.hidden = user.role === "student";
        }

        state.lostFoundSearch = elements.lostFoundSearch
            ? elements.lostFoundSearch.value
            : "";

        bindEvents();
        activateTab(readTab(), { updateUrl: false });
    }

    init();
})();
