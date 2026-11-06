/* CampusFix public notice board: live announcements, search, and audience filters. */
(function () {
    "use strict";

    const App = window.CampusFix;
    const I18N = window.CampusFixI18n;

    if (!App || !I18N || !window.CampusFixShell) {
        return;
    }

    const SEARCH_DELAY = 280;
    const NOTICE_LIMIT = 100;

    const elements = {
        search: document.getElementById("noticeSearch"),
        audience: document.getElementById("noticeAudienceFilter"),
        count: document.getElementById("noticeCount"),
        container: document.getElementById("noticesContainer"),
        refresh: document.getElementById("refreshNotices"),
        manage: document.getElementById("manageNotices")
    };

    const state = {
        user: null,
        notices: [],
        search: "",
        audience: "",
        loading: false,
        requestId: 0,
        searchTimer: null
    };

    const escape = App.escapeHTML;
    const icon = (name) => App.icon(name);
    const t = (key, vars) => I18N.t(key, vars);

    function availableAudiences() {
        if (!state.user) {
            return [];
        }

        if (state.user.role === "admin") {
            return ["students", "staff"];
        }

        return [state.user.role === "student" ? "students" : "staff"];
    }

    function parseUrl() {
        const params = new URLSearchParams(window.location.search);
        const audience = params.get("audience") || "";

        state.search = String(params.get("search") || "").slice(0, 200);
        state.audience = availableAudiences().includes(audience)
            ? audience
            : "";
    }

    function syncUrl() {
        const url = new URL(window.location.href);
        const search = state.search.trim();

        if (search) {
            url.searchParams.set("search", search);
        } else {
            url.searchParams.delete("search");
        }

        if (state.audience) {
            url.searchParams.set("audience", state.audience);
        } else {
            url.searchParams.delete("audience");
        }

        window.history.replaceState(
            null,
            "",
            url.pathname + url.search + url.hash
        );
    }

    function applyAudienceOptions() {
        if (!elements.audience) {
            return;
        }

        const allowed = availableAudiences();

        if (state.audience && !allowed.includes(state.audience)) {
            state.audience = "";
        }

        const options = [
            '<option value="">' + escape(t("notices.filterAudience")) + "</option>"
        ];

        allowed.forEach((audience) => {
            options.push(
                '<option value="' +
                    escape(audience) +
                    '">' +
                    escape(I18N.audienceLabel(audience)) +
                    "</option>"
            );
        });

        elements.audience.innerHTML = options.join("");
        elements.audience.value = state.audience;
    }

    function updateCount() {
        if (!elements.count) {
            return;
        }

        if (state.loading) {
            elements.count.textContent = t("common.loading");
            return;
        }

        elements.count.textContent = t("notices.count", {
            count: I18N.formatNumber(state.notices.length)
        });
    }

    function skeletonMarkup() {
        let cards = "";

        for (let index = 0; index < 4; index += 1) {
            cards +=
                '<div class="panel notice-card" aria-hidden="true">' +
                '<span class="skeleton skeleton-line" style="width:31%"></span>' +
                '<span class="skeleton skeleton-line" style="width:68%;height:16px"></span>' +
                '<span class="skeleton skeleton-line" style="width:100%"></span>' +
                '<span class="skeleton skeleton-line" style="width:93%"></span>' +
                '<span class="skeleton skeleton-line" style="width:54%"></span>' +
                "</div>";
        }

        return '<div class="notice-grid">' + cards + "</div>";
    }

    function setLoading() {
        state.loading = true;

        if (!elements.container) {
            return;
        }

        elements.container.setAttribute("aria-busy", "true");
        elements.container.innerHTML = skeletonMarkup();
        updateCount();
    }

    function finishLoading() {
        state.loading = false;

        if (elements.container) {
            elements.container.setAttribute("aria-busy", "false");
        }
    }

    function audienceBadge(audience) {
        return (
            '<span class="badge" data-tone="brand">' +
            escape(I18N.audienceLabel(audience)) +
            "</span>"
        );
    }

    function noticeCard(notice, index) {
        const headingId = "noticeHeading" + index;
        const high = notice.priority === "High";
        const body = String(notice.body || "");
        const publishedAt = notice.publishedAt || notice.createdAt;
        const published = I18N.formatDate(publishedAt);
        const publishedExact = I18N.formatDateTime(publishedAt);
        const expiry = notice.expiresAt
            ? t("notices.expires", { date: I18N.formatDate(notice.expiresAt) })
            : t("notices.noExpiry");
        const author = notice.authorName
            ? t("notices.by", { name: notice.authorName })
            : "";

        return (
            '<article class="panel notice-card' +
            (high ? " is-high" : "") +
            '" aria-labelledby="' +
            headingId +
            '">' +
            '<div class="notice-card-head"><div>' +
            '<div class="cluster cluster-tight" style="margin-bottom:9px">' +
            (high
                ? '<span class="badge" data-tone="high">' +
                  escape(t("notices.highPriority")) +
                  "</span>"
                : "") +
            audienceBadge(notice.audience || "all") +
            "</div>" +
            '<h2 id="' +
            headingId +
            '">' +
            escape(notice.title) +
            "</h2></div>" +
            '<span class="notice-icon">' +
            icon("megaphone") +
            "</span></div>" +
            "<p>" +
            escape(body) +
            "</p>" +
            '<div class="notice-meta">' +
            '<time datetime="' +
            escape(publishedAt || "") +
            '" title="' +
            escape(publishedExact) +
            '">' +
            escape(t("notices.published", { date: published })) +
            "</time>" +
            (author
                ? "<span>·</span><span>" + escape(author) + "</span>"
                : "") +
            "<span>·</span><span>" +
            escape(expiry) +
            "</span></div></article>"
        );
    }

    function hasFilters() {
        return Boolean(state.search.trim() || state.audience);
    }

    function renderEmpty() {
        const filtered = hasFilters();

        elements.container.innerHTML =
            '<div class="empty-state">' +
            '<span class="empty-icon">' +
            icon(filtered ? "search" : "megaphone") +
            "</span>" +
            "<h3>" +
            escape(
                t(filtered ? "notices.noMatchTitle" : "notices.emptyTitle")
            ) +
            "</h3><p>" +
            escape(t(filtered ? "notices.noMatchBody" : "notices.emptyBody")) +
            "</p>" +
            (filtered
                ? '<button type="button" class="btn btn-secondary btn-sm" data-clear-filters style="margin-top:8px">' +
                  escape(t("notices.clearFilters")) +
                  "</button>"
                : "") +
            "</div>";
    }

    function renderNotices() {
        if (!elements.container) {
            return;
        }

        if (state.notices.length === 0) {
            renderEmpty();
            return;
        }

        elements.container.innerHTML =
            '<div class="notice-grid">' +
            state.notices.map(noticeCard).join("") +
            "</div>";
    }

    function renderError(message) {
        if (!elements.container) {
            return;
        }

        elements.count.textContent = t("common.loadingError");
        elements.container.innerHTML =
            '<div class="error-state">' +
            '<span aria-hidden="true">' +
            icon("alert-circle") +
            "</span>" +
            "<div><strong>" +
            escape(t("common.errorTitle")) +
            "</strong><p>" +
            escape(message) +
            '</p><button type="button" class="btn btn-secondary btn-sm" data-retry-notices style="margin-top:9px">' +
            escape(t("common.retry")) +
            "</button></div></div>";
    }

    async function loadNotices() {
        if (!elements.container) {
            return;
        }

        state.requestId += 1;
        const requestId = state.requestId;

        setLoading();

        const params = new URLSearchParams({
            limit: String(NOTICE_LIMIT)
        });

        if (state.search.trim()) {
            params.set("search", state.search.trim());
        }

        if (state.audience) {
            params.set("audience", state.audience);
        }

        try {
            const data = await App.api.get("/notices?" + params.toString());

            if (requestId !== state.requestId) {
                return;
            }

            state.notices = Array.isArray(data.notices)
                ? data.notices
                : [];
            finishLoading();
            renderNotices();
            updateCount();
        } catch (error) {
            if (requestId !== state.requestId) {
                return;
            }

            state.notices = [];
            finishLoading();
            renderError(
                App.friendlyError(error, t("common.loadingError"))
            );
        }
    }

    function scheduleSearch() {
        window.clearTimeout(state.searchTimer);
        state.searchTimer = window.setTimeout(() => {
            syncUrl();
            loadNotices();
        }, SEARCH_DELAY);
    }

    async function refreshNotices() {
        if (state.loading) {
            return;
        }

        const restore = App.buttonLoading(
            elements.refresh,
            t("common.loading")
        );

        try {
            await loadNotices();
        } finally {
            restore();
        }
    }

    function clearFilters() {
        state.search = "";
        state.audience = "";
        window.clearTimeout(state.searchTimer);

        if (elements.search) {
            elements.search.value = "";
        }

        if (elements.audience) {
            elements.audience.value = "";
        }

        syncUrl();
        loadNotices();
    }

    function bindEvents() {
        if (elements.search) {
            elements.search.addEventListener("input", () => {
                state.search = elements.search.value;
                scheduleSearch();
            });
        }

        if (elements.audience) {
            elements.audience.addEventListener("change", () => {
                state.audience = elements.audience.value;
                window.clearTimeout(state.searchTimer);
                syncUrl();
                loadNotices();
            });
        }

        if (elements.refresh) {
            elements.refresh.addEventListener("click", refreshNotices);
        }

        if (elements.container) {
            elements.container.addEventListener("click", (event) => {
                if (event.target.closest("[data-retry-notices]")) {
                    loadNotices();
                }

                if (event.target.closest("[data-clear-filters]")) {
                    clearFilters();
                }
            });
        }

        window.addEventListener("campusfix:languagechange", () => {
            applyAudienceOptions();

            if (state.loading) {
                updateCount();
                return;
            }

            renderNotices();
            updateCount();
        });
    }

    async function init() {
        const user = await window.CampusFixShell.ready;

        if (!user) {
            return;
        }

        state.user = user;

        if (elements.manage) {
            elements.manage.hidden = user.role !== "admin";
        }

        parseUrl();
        applyAudienceOptions();

        if (elements.search) {
            elements.search.value = state.search;
        }

        bindEvents();
        syncUrl();
        await loadNotices();
    }

    init();
})();
