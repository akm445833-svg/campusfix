/* CampusFix operations center: live analytics, queue, notices, access, configuration and audit. */
(function () {
    "use strict";

    const App = window.CampusFix;
    const I18N = window.CampusFixI18n;
    const Shell = window.CampusFixShell;

    if (!App || !I18N || !Shell) {
        return;
    }

    const TABS = [
        "overview",
        "complaints",
        "notices",
        "operations",
        "team",
        "config",
        "audit"
    ];
    const ADMIN_ONLY_TABS = ["team", "config", "audit"];
    const COMPLAINT_PAGE_SIZE = 12;
    const AUDIT_PAGE_SIZE = 25;
    const STATUSES = [
        "Pending",
        "Assigned",
        "In Progress",
        "Resolved",
        "Reopened",
        "Rejected"
    ];
    const PRIORITIES = ["Low", "Medium", "High", "Critical"];
    const SORTS = ["newest", "oldest", "priority", "due"];
    const SLA_ORDER = ["Low", "Medium", "High", "Critical"];
    const UUID_PATTERN =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    const STATUS_CHART = [
        { status: "Pending", color: "var(--brand-600)" },
        { status: "Assigned", color: "var(--info-600)" },
        { status: "In Progress", color: "var(--warning-600)" },
        { status: "Resolved", color: "var(--success-600)" },
        { status: "Reopened", color: "#d97706" },
        { status: "Rejected", color: "var(--danger-600)" }
    ];

    const TAB_META = {
        overview: { nav: "nav.overview", title: "nav.overview" },
        complaints: { nav: "nav.complaints", title: "nav.complaints" },
        notices: { nav: "nav.notices", title: "nav.notices" },
        operations: {
            nav: "nav.operations",
            title: "nav.operations"
        },
        team: { nav: "nav.team", title: "nav.team" },
        config: { nav: "nav.configuration", title: "nav.configuration" },
        audit: { nav: "nav.audit", title: "nav.audit" }
    };

    const $ = (id) => document.getElementById(id);

    const elements = {
        scope: $("adminScopeText"),
        refresh: $("adminRefresh"),
        tabList: document.querySelector(".tabs"),
        tabButtons: Array.prototype.slice.call(
            document.querySelectorAll("[data-admin-tab]")
        ),
        tabPanels: Array.prototype.slice.call(
            document.querySelectorAll("[data-admin-panel]")
        ),

        statTotal: $("adminStatTotal"),
        statTotalMeta: $("adminStatTotalMeta"),
        statOpen: $("adminStatOpen"),
        statOverdue: $("adminStatOverdue"),
        statUnassigned: $("adminStatUnassigned"),
        statResolved: $("adminStatResolved"),
        statResolvedMeta: $("adminStatResolvedMeta"),
        statAvg: $("adminStatAvg"),
        statAvgMeta: $("adminStatAvgMeta"),
        statusChart: $("statusChart"),
        queueHealth: $("queueHealth"),
        recentComplaints: $("recentComplaints"),
        departmentWorkload: $("departmentWorkload"),
        staffWorkload: $("staffWorkload"),

        exportButton: $("adminExportButton"),
        search: $("adminSearch"),
        statusFilter: $("adminStatusFilter"),
        priorityFilter: $("adminPriorityFilter"),
        departmentFilter: $("adminDepartmentFilter"),
        sortFilter: $("adminSortFilter"),
        overdueFilter: $("adminOverdueFilter"),
        unassignedFilter: $("adminUnassignedFilter"),
        complaintList: $("adminComplaintList"),
        complaintPagination: $("adminComplaintPagination"),

        newNotice: $("adminNewNotice"),
        noticeList: $("adminNoticeList"),
        noticeDialog: $("noticeDialog"),
        noticeForm: $("noticeForm"),
        noticeDialogTitle: $("noticeDialogTitle"),
        noticeTitle: $("noticeTitle"),
        noticeBody: $("noticeBody"),
        noticeAudience: $("noticeAudience"),
        noticePriority: $("noticePriority"),
        noticePublishedAt: $("noticePublishedAt"),
        noticeExpiresAt: $("noticeExpiresAt"),
        noticeSubmit: $("noticeSubmit"),
        noticeSubmitLabel: $("noticeSubmitLabel"),

        userSearch: $("adminUserSearch"),
        userRoleFilter: $("adminUserRoleFilter"),
        userDepartmentFilter: $("adminUserDepartmentFilter"),
        userList: $("adminUserList"),

        newDepartment: $("adminNewDepartment"),
        departmentList: $("adminDepartmentList"),
        newCategory: $("adminNewCategory"),
        categoryList: $("adminCategoryList"),
        slaList: $("adminSlaList"),

        auditList: $("adminAuditList"),
        auditPagination: $("adminAuditPagination"),

        accessDialog: $("accessDialog"),
        accessForm: $("accessForm"),
        accessUserName: $("accessUserName"),
        accessUserEmail: $("accessUserEmail"),
        accessRole: $("accessRole"),
        accessDepartment: $("accessDepartment"),
        accessSubmit: $("accessSubmit"),

        departmentDialog: $("departmentDialog"),
        departmentForm: $("departmentForm"),
        departmentDialogTitle: $("departmentDialogTitle"),
        departmentCode: $("departmentCode"),
        departmentName: $("departmentName"),
        departmentDescription: $("departmentDescription"),
        departmentEmail: $("departmentEmail"),
        departmentActive: $("departmentActive"),
        departmentSubmit: $("departmentSubmit"),

        categoryDialog: $("categoryDialog"),
        categoryForm: $("categoryForm"),
        categoryDialogTitle: $("categoryDialogTitle"),
        categoryName: $("categoryName"),
        categoryDepartment: $("categoryDepartment"),
        categoryOrder: $("categoryOrder"),
        categoryActive: $("categoryActive"),
        categorySubmit: $("categorySubmit"),
        categorySubmitLabel: $("categorySubmitLabel")
    };

    const state = {
        user: null,
        isAdmin: false,
        tab: "overview",
        departments: [],
        departmentsLoaded: false,
        departmentsPromise: null,
        stats: null,
        recent: null,
        complaints: null,
        complaintPagination: null,
        notices: null,
        users: null,
        configCategories: null,
        configSla: null,
        auditLogs: null,
        auditPagination: null,
        filters: {
            search: "",
            status: "",
            priority: "",
            departmentId: "",
            sort: "newest",
            overdue: false,
            unassigned: false,
            page: 1
        },
        userFilters: {
            search: "",
            role: "",
            departmentId: ""
        },
        auditPage: 1,
        editingNoticeId: null,
        editingUserId: null,
        editingDepartmentId: null,
        editingCategoryId: null,
        tokens: {},
        complaintSearchTimer: null,
        userSearchTimer: null
    };

    const icon = (name, extra) => App.icon(name, extra);
    const escape = App.escapeHTML;
    const t = (key, vars) => I18N.t(key, vars);

    function count(value) {
        return I18N.formatNumber(Number(value || 0));
    }

    function nextToken(name) {
        state.tokens[name] = Number(state.tokens[name] || 0) + 1;
        return state.tokens[name];
    }

    function isCurrentToken(name, token) {
        return state.tokens[name] === token;
    }

    function skeletonRows(rowCount, widths) {
        const widthList = widths || [72, 45, 63, 38];
        let markup = '<div style="padding:16px">';

        for (let index = 0; index < (rowCount || 4); index += 1) {
            markup +=
                '<div class="skeleton-row"><span class="skeleton skeleton-line" style="width:' +
                widthList[index % widthList.length] +
                '%"></span><span class="skeleton skeleton-line" style="width:16%;margin-left:auto"></span></div>';
        }

        return markup + "</div>";
    }

    function emptyState(iconName, title, body, action) {
        return (
            '<div class="empty-state">' +
            '<span class="empty-icon">' +
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

    function errorState(message, retryTarget) {
        return (
            '<div class="error-state" style="margin:16px">' +
            icon("alert-circle") +
            "<div><strong>" +
            escape(t("common.errorTitle")) +
            "</strong><p>" +
            escape(message) +
            "</p>" +
            (retryTarget
                ? '<button type="button" class="btn btn-secondary btn-sm" data-retry="' +
                  escape(retryTarget) +
                  '" style="margin-top:9px">' +
                  escape(t("common.retry")) +
                  "</button>"
                : "") +
            "</div></div>"
        );
    }

    function toLocalInput(value) {
        if (!value) {
            return "";
        }

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {
            return "";
        }

        const pad = (part) => String(part).padStart(2, "0");

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
            const message =
                issues.length && issues[0].message
                    ? issues[0].message
                    : App.friendlyError(error);
            App.toast(message, "error");
        }
    }

    function updateScopeText() {
        if (!elements.scope) {
            return;
        }

        if (state.isAdmin) {
            elements.scope.textContent = t("admin.scopeAll");
            return;
        }

        const departmentName =
            state.user && state.user.department
                ? state.user.department.name
                : "";

        elements.scope.textContent = t("admin.scopeDepartment", {
            department: departmentName
                ? I18N.departmentLabel(departmentName)
                : t("common.unknown")
        });
    }

    function readUrlState() {
        const params = new URLSearchParams(window.location.search);
        const tab = params.get("tab") || "overview";
        const status = params.get("status") || "";
        const priority = params.get("priority") || "";
        const sort = params.get("sort") || "newest";
        const departmentId = params.get("departmentId") || "";
        const rawPage = Number(params.get("page") || 1);

        state.tab = TABS.includes(tab) ? tab : "overview";
        state.filters = {
            search: String(params.get("search") || "").slice(0, 200),
            status: STATUSES.includes(status) ? status : "",
            priority: PRIORITIES.includes(priority) ? priority : "",
            departmentId: UUID_PATTERN.test(departmentId)
                ? departmentId
                : "",
            sort: SORTS.includes(sort) ? sort : "newest",
            overdue: ["1", "true"].includes(params.get("overdue")),
            unassigned: ["1", "true"].includes(
                params.get("unassigned")
            ),
            page:
                Number.isInteger(rawPage) && rawPage >= 1 && rawPage <= 100000
                    ? rawPage
                    : 1
        };
        state.auditPage =
            Number.isInteger(rawPage) && rawPage >= 1 && rawPage <= 100000
                ? rawPage
                : 1;
    }

    function buildUrl() {
        const params = new URLSearchParams();
        params.set("tab", state.tab);

        if (state.tab === "complaints") {
            if (state.filters.search) {
                params.set("search", state.filters.search);
            }

            if (state.filters.status) {
                params.set("status", state.filters.status);
            }

            if (state.filters.priority) {
                params.set("priority", state.filters.priority);
            }

            if (state.isAdmin && state.filters.departmentId) {
                params.set(
                    "departmentId",
                    state.filters.departmentId
                );
            }

            if (state.filters.sort !== "newest") {
                params.set("sort", state.filters.sort);
            }

            if (state.filters.overdue) {
                params.set("overdue", "1");
            }

            if (state.filters.unassigned) {
                params.set("unassigned", "1");
            }

            if (state.filters.page > 1) {
                params.set("page", String(state.filters.page));
            }
        }

        if (state.tab === "audit" && state.auditPage > 1) {
            params.set("page", String(state.auditPage));
        }

        return "admin.html?" + params.toString();
    }

    function syncUrl(mode) {
        const method =
            mode === "push" ? "pushState" : "replaceState";

        window.history[method](null, "", buildUrl());
    }

    function applyFiltersToControls() {
        elements.search.value = state.filters.search;
        elements.statusFilter.value = state.filters.status;
        elements.priorityFilter.value = state.filters.priority;
        elements.sortFilter.value = state.filters.sort;
        elements.overdueFilter.checked = state.filters.overdue;
        elements.unassignedFilter.checked = state.filters.unassigned;

        if (state.isAdmin) {
            elements.departmentFilter.hidden = false;
            elements.departmentFilter.value =
                state.filters.departmentId;
        } else {
            elements.departmentFilter.hidden = true;
        }
    }

    function applyUserFiltersToControls() {
        elements.userSearch.value = state.userFilters.search;
        elements.userRoleFilter.value = state.userFilters.role;
        elements.userDepartmentFilter.value =
            state.userFilters.departmentId;
    }

    function fillDepartmentSelect(
        select,
        placeholder,
        selectedValue,
        activeOnly
    ) {
        if (!select) {
            return;
        }

        const selected =
            selectedValue === undefined
                ? select.value
                : String(selectedValue || "");
        const list = state.departments.filter(
            (department) =>
                !activeOnly ||
                department.isActive ||
                department.id === selected
        );
        const options = [];

        if (placeholder !== null) {
            options.push(
                '<option value="">' +
                    escape(placeholder) +
                    "</option>"
            );
        }

        list.forEach((department) => {
            options.push(
                '<option value="' +
                    escape(department.id) +
                    '">' +
                    escape(I18N.departmentLabel(department.name)) +
                    (department.isActive
                        ? ""
                        : " · " + escape(t("admin.inactive"))) +
                    "</option>"
            );
        });

        select.innerHTML = options.join("");

        if (
            selected &&
            list.some((department) => department.id === selected)
        ) {
            select.value = selected;
        } else if (placeholder !== null) {
            select.value = "";
        }
    }

    function populateDepartmentOptions() {
        fillDepartmentSelect(
            elements.departmentFilter,
            t("admin.allDepartments"),
            state.filters.departmentId,
            false
        );
        fillDepartmentSelect(
            elements.userDepartmentFilter,
            t("admin.allDepartments"),
            state.userFilters.departmentId,
            false
        );
        fillDepartmentSelect(
            elements.accessDepartment,
            t("admin.noDepartment"),
            state.editingUserId
                ? (getUserById(state.editingUserId) || {}).departmentId
                : undefined,
            true
        );
        fillDepartmentSelect(
            elements.categoryDepartment,
            t("admin.chooseDepartment"),
            state.editingCategoryId
                ? (
                      state.configCategories || []
                  ).reduce(
                      (found, category) =>
                          found ||
                          (category.id === state.editingCategoryId
                              ? category.departmentId
                              : ""),
                      ""
                  )
                : undefined,
            true
        );
    }

    function ensureDepartments(force) {
        if (!force && state.departmentsLoaded) {
            return Promise.resolve(state.departments);
        }

        if (state.departmentsPromise) {
            return state.departmentsPromise;
        }

        state.departmentsPromise = App.api
            .get("/admin/departments")
            .then((data) => {
                state.departments = data.departments || [];
                state.departmentsLoaded = true;
                populateDepartmentOptions();
                return state.departments;
            })
            .finally(() => {
                state.departmentsPromise = null;
            });

        return state.departmentsPromise;
    }

    function getUserById(id) {
        return (state.users || []).find((user) => user.id === id) || null;
    }

    function activateTab(tab, options) {
        const settings = options || {};
        let target = TABS.includes(tab) ? tab : "overview";

        if (!state.isAdmin && ADMIN_ONLY_TABS.includes(target)) {
            target = "overview";
        }

        state.tab = target;

        elements.tabButtons.forEach((button) => {
            const active = button.getAttribute("data-admin-tab") === target;
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-selected", String(active));
            button.tabIndex = active ? 0 : -1;
        });

        elements.tabPanels.forEach((panel) => {
            panel.hidden =
                panel.getAttribute("data-admin-panel") !== target;
        });

        const meta = TAB_META[target];
        Shell.setActiveNav(meta.nav);
        Shell.setPageTitle(meta.title);

        if (settings.updateHistory !== false) {
            syncUrl(settings.push ? "push" : "replace");
        }

        return loadTab(target);
    }

    function loadTab(tab) {
        if (tab === "overview") {
            return Promise.all([loadStats(), loadRecent()]);
        }

        if (tab === "complaints") {
            return loadComplaints();
        }

        if (tab === "notices") {
            return loadNotices();
        }

        if (tab === "operations") {
            return window.CampusFixOperations
                ? window.CampusFixOperations.load()
                : Promise.resolve();
        }

        if (tab === "team") {
            return state.isAdmin ? loadUsers() : Promise.resolve();
        }

        if (tab === "config") {
            return state.isAdmin ? loadConfig() : Promise.resolve();
        }

        if (tab === "audit") {
            return state.isAdmin ? loadAudit() : Promise.resolve();
        }

        return Promise.resolve();
    }

    function refreshCurrentTab() {
        const restore = App.buttonLoading(
            elements.refresh,
            t("common.loading")
        );

        return Promise.resolve(loadTab(state.tab)).finally(restore);
    }

    /* Overview ------------------------------------------------------------- */

    function renderStatsSkeleton() {
        [
            elements.statTotal,
            elements.statOpen,
            elements.statOverdue,
            elements.statUnassigned,
            elements.statResolved,
            elements.statAvg
        ].forEach((node) => {
            node.setAttribute("aria-busy", "true");
            node.textContent = "—";
        });

        elements.statTotalMeta.textContent = "";
        elements.statResolvedMeta.textContent = "";
        elements.statAvgMeta.textContent = "";
        elements.statusChart.innerHTML = skeletonRows(3, [78, 63, 44]);
        elements.queueHealth.innerHTML = skeletonRows(3, [54, 72, 38]);
        elements.departmentWorkload.innerHTML = skeletonRows(3, [60, 46, 75]);
        elements.staffWorkload.innerHTML = skeletonRows(3, [58, 71, 43]);
    }

    function renderStatsError(message) {
        [
            elements.statTotal,
            elements.statOpen,
            elements.statOverdue,
            elements.statUnassigned,
            elements.statResolved,
            elements.statAvg
        ].forEach((node) => {
            node.removeAttribute("aria-busy");
            node.textContent = "—";
        });

        elements.statTotalMeta.textContent = "";
        elements.statResolvedMeta.textContent = t("common.unknown");
        elements.statAvgMeta.textContent = t("common.unknown");
        elements.statusChart.innerHTML = errorState(message, "stats");
        elements.queueHealth.innerHTML = errorState(message, "stats");
        elements.departmentWorkload.innerHTML = errorState(
            message,
            "stats"
        );
        elements.staffWorkload.innerHTML = errorState(message, "stats");
    }

    function renderStats() {
        const stats = state.stats;

        if (!stats) {
            return;
        }

        [
            elements.statTotal,
            elements.statOpen,
            elements.statOverdue,
            elements.statUnassigned,
            elements.statResolved,
            elements.statAvg
        ].forEach((node) => {
            node.removeAttribute("aria-busy");
        });

        const open =
            Number(stats.pending || 0) +
            Number(stats.assigned || 0) +
            Number(stats.inProgress || 0) +
            Number(stats.reopened || 0);
        const avgHours = stats.averageResolutionHours;

        elements.statTotal.textContent = count(stats.total);
        elements.statTotalMeta.textContent =
            t("status.Pending") +
            ": " +
            count(stats.pending) +
            " · " +
            t("status.Reopened") +
            ": " +
            count(stats.reopened);
        elements.statOpen.textContent = count(open);
        elements.statOverdue.textContent = count(stats.overdue);
        elements.statUnassigned.textContent = count(stats.unassigned);
        elements.statResolved.textContent = count(stats.resolved);
        elements.statResolvedMeta.textContent = t(
            "dashboard.resolvedMeta",
            {
                count: count(stats.resolved),
                total: count(stats.total)
            }
        );
        elements.statAvg.textContent =
            avgHours === null || avgHours === undefined
                ? "—"
                : I18N.durationText(avgHours);
        elements.statAvgMeta.textContent =
            avgHours === null || avgHours === undefined
                ? t("admin.noResolvedYet")
                : t("admin.avgMeta");

        renderStatusChart(stats);
        renderQueueHealth(stats);
        renderDepartmentWorkload(stats);
        renderStaffWorkload(stats);
    }

    async function loadStats() {
        const token = nextToken("stats");

        renderStatsSkeleton();

        try {
            const stats = await App.api.get("/admin/stats");

            if (!isCurrentToken("stats", token)) {
                return;
            }

            state.stats = stats;
            renderStats();
        } catch (error) {
            if (!isCurrentToken("stats", token)) {
                return;
            }

            state.stats = null;
            renderStatsError(
                App.friendlyError(error, t("admin.statsError"))
            );
        }
    }

    function renderStatusChart(stats) {
        const counts = {};
        let total = 0;

        (stats.byStatus || []).forEach((row) => {
            counts[row.status] = Number(row.count || 0);
            total += Number(row.count || 0);
        });

        if (total === 0) {
            elements.statusChart.innerHTML = emptyState(
                "tickets",
                t("admin.recentEmpty"),
                t("admin.statusChartSubtitle")
            );
            return;
        }

        let cursor = 0;
        const segments = STATUS_CHART.map((entry) => {
            const amount = counts[entry.status] || 0;
            cursor += (amount / total) * 100;

            return {
                status: entry.status,
                color: entry.color,
                amount,
                end: cursor
            };
        });
        const style = segments
            .slice(0, 5)
            .map(
                (segment, index) =>
                    "--seg-" +
                    (index + 1) +
                    ":" +
                    segment.end.toFixed(3) +
                    "%"
            )
            .join(";");
        const ariaLabel = segments
            .map(
                (segment) =>
                    I18N.statusLabel(segment.status) +
                    ": " +
                    count(segment.amount)
            )
            .join(", ");

        elements.statusChart.innerHTML =
            '<div class="donut-wrap">' +
            '<div class="donut" style="' +
            style +
            '" role="img" aria-label="' +
            escape(ariaLabel) +
            '">' +
            '<div class="donut-center"><strong>' +
            count(total) +
            "</strong><span>" +
            escape(t("admin.total")) +
            "</span></div></div>" +
            '<div class="chart-legend">' +
            segments
                .map(
                    (segment) =>
                        '<div class="legend-row"><span class="legend-dot" style="background:' +
                        segment.color +
                        '"></span><span>' +
                        escape(I18N.statusLabel(segment.status)) +
                        "</span><strong>" +
                        count(segment.amount) +
                        "</strong></div>"
                )
                .join("") +
            "</div></div>";
    }

    function alertMarkup(tone, iconName, title, body, filter) {
        return (
            '<div class="alert-item' +
            (tone ? " is-" + tone : "") +
            '"><span class="alert-icon">' +
            icon(iconName) +
            '</span><div class="alert-copy"><strong>' +
            escape(title) +
            "</strong><p>" +
            escape(body) +
            '</p><button type="button" class="btn btn-secondary btn-sm" data-queue-filter="' +
            escape(filter) +
            '" style="margin-top:8px">' +
            escape(t("admin.review")) +
            "</button></div></div>"
        );
    }

    function renderQueueHealth(stats) {
        const alerts = [];

        if (Number(stats.overdue) > 0) {
            alerts.push(
                alertMarkup(
                    "danger",
                    "alert-triangle",
                    t("admin.alertOverdueTitle"),
                    t("admin.alertOverdueBody", {
                        count: count(stats.overdue)
                    }),
                    "overdue"
                )
            );
        }

        if (Number(stats.unassigned) > 0) {
            alerts.push(
                alertMarkup(
                    "warning",
                    "user",
                    t("admin.alertUnassignedTitle"),
                    t("admin.alertUnassignedBody", {
                        count: count(stats.unassigned)
                    }),
                    "unassigned"
                )
            );
        }

        if (Number(stats.pending) > 0) {
            alerts.push(
                alertMarkup(
                    "warning",
                    "tickets",
                    t("admin.alertPendingTitle"),
                    t("admin.alertPendingBody", {
                        count: count(stats.pending)
                    }),
                    "pending"
                )
            );
        }

        if (alerts.length === 0) {
            elements.queueHealth.innerHTML =
                '<div class="empty-state" style="border:0;box-shadow:none">' +
                '<span class="empty-icon">' +
                icon("check-circle") +
                "</span><h3>" +
                escape(t("admin.noAlertsTitle")) +
                "</h3><p>" +
                escape(t("admin.noAlertsBody")) +
                "</p></div>";
            return;
        }

        elements.queueHealth.innerHTML =
            '<div class="alert-list">' + alerts.join("") + "</div>";
    }

    function renderDepartmentWorkload(stats) {
        const rows = stats.departmentWorkload || [];

        if (rows.length === 0) {
            elements.departmentWorkload.innerHTML = emptyState(
                "building",
                t("admin.recentEmpty"),
                t("admin.departmentSubtitle")
            );
            return;
        }

        const max = Math.max(
            ...rows.map((row) => Number(row.active || 0)),
            1
        );

        elements.departmentWorkload.innerHTML =
            '<div class="bar-list">' +
            rows
                .map((row) => {
                    const active = Number(row.active || 0);
                    const width = Math.round((active / max) * 100);

                    return (
                        '<div class="bar-row"><div class="bar-row-head"><span>' +
                        escape(I18N.departmentLabel(row.name)) +
                        "</span><strong>" +
                        escape(
                            t("admin.workloadCounts", {
                                active: count(active),
                                total: count(row.total)
                            })
                        ) +
                        '</strong></div><div class="bar-track"><div class="bar-fill' +
                        (Number(row.overdue) > 0 ? " is-danger" : "") +
                        '" style="width:' +
                        width +
                        '%"></div></div>' +
                        (Number(row.overdue) > 0
                            ? '<div class="text-xs subtle" style="margin-top:5px">' +
                              escape(
                                  t("admin.workloadOverdue", {
                                      count: count(row.overdue)
                                  })
                              ) +
                              "</div>"
                            : "") +
                        "</div>"
                    );
                })
                .join("") +
            "</div>";
    }

    function renderStaffWorkload(stats) {
        const rows = stats.staffWorkload || [];

        if (rows.length === 0) {
            elements.staffWorkload.innerHTML = emptyState(
                "users",
                t("admin.noStaff"),
                t("admin.staffSubtitle")
            );
            return;
        }

        const max = Math.max(
            ...rows.map((row) => Number(row.active || 0)),
            1
        );

        elements.staffWorkload.innerHTML =
            '<div class="table-wrap"><table class="table workload-table"><thead><tr><th>' +
            escape(t("common.name")) +
            "</th><th>" +
            escape(t("common.active")) +
            "</th><th>" +
            escape(t("dashboard.resolved")) +
            "</th><th>" +
            escape(t("dashboard.overdue")) +
            "</th></tr></thead><tbody>" +
            rows
                .map((row) => {
                    const active = Number(row.active || 0);
                    const width = Math.round((active / max) * 100);

                    return (
                        "<tr><td><div class=\"user-cell\">" +
                        App.avatar(row.name) +
                        '<div class="user-cell-copy"><strong>' +
                        escape(row.name) +
                        "</strong></div></div></td><td>" +
                        '<span class="workload-count">' +
                        count(active) +
                        '<span class="workload-bar"><span style="width:' +
                        width +
                        '%"></span></span></span></td><td>' +
                        count(row.resolved) +
                        "</td><td>" +
                        (Number(row.overdue) > 0
                            ? '<span class="badge badge-overdue">' +
                              count(row.overdue) +
                              "</span>"
                            : '<span class="cell-muted">0</span>') +
                        "</td></tr>"
                    );
                })
                .join("") +
            "</tbody></table></div>";
    }

    async function loadRecent() {
        const token = nextToken("recent");

        elements.recentComplaints.innerHTML = skeletonRows(4, [
            24, 68, 51, 77
        ]);

        try {
            const data = await App.api.get(
                "/admin/complaints?page=1&pageSize=5&sort=newest"
            );

            if (!isCurrentToken("recent", token)) {
                return;
            }

            state.recent = data.complaints || [];
            renderRecent();
        } catch (error) {
            if (!isCurrentToken("recent", token)) {
                return;
            }

            state.recent = null;
            elements.recentComplaints.innerHTML = errorState(
                App.friendlyError(error, t("admin.complaintsError")),
                "recent"
            );
        }
    }

    function renderRecent() {
        if (!Array.isArray(state.recent)) {
            return;
        }

        if (state.recent.length === 0) {
            elements.recentComplaints.innerHTML = emptyState(
                "tickets",
                t("admin.recentEmpty"),
                t("admin.recentSubtitle")
            );
            return;
        }

        elements.recentComplaints.innerHTML =
            '<div class="table-wrap"><table class="table"><thead><tr><th>' +
            escape(t("admin.tableReference")) +
            "</th><th>" +
            escape(t("admin.tableComplaint")) +
            "</th><th>" +
            escape(t("admin.tableStatus")) +
            "</th><th>" +
            escape(t("admin.tableAssignee")) +
            "</th><th>" +
            escape(t("admin.tableCreated")) +
            "</th></tr></thead><tbody>" +
            state.recent
                .map((complaint) => {
                    const href = App.complaintUrl(complaint.id);

                    return (
                        '<tr class="is-clickable" data-complaint-href="' +
                        escape(href) +
                        '"><td><a class="ref" href="' +
                        escape(href) +
                        '">' +
                        escape(complaint.referenceNumber) +
                        '</a></td><td class="cell-main"><a href="' +
                        escape(href) +
                        '"><strong>' +
                        escape(complaint.title) +
                        "</strong></a><span>" +
                        escape(I18N.categoryLabel(complaint.category)) +
                        "</span></td><td>" +
                        App.statusBadge(complaint.status) +
                        "</td><td>" +
                        (complaint.assignedTo
                            ? escape(complaint.assignedTo.name)
                            : '<span class="cell-muted">' +
                              escape(t("admin.unassigned")) +
                              "</span>") +
                        "</td><td>" +
                        escape(I18N.formatDate(complaint.createdAt)) +
                        "</td></tr>"
                    );
                })
                .join("") +
            "</tbody></table></div>";
    }

    /* Complaint queue ------------------------------------------------------ */

    function complaintParams() {
        const params = new URLSearchParams({
            page: String(state.filters.page),
            pageSize: String(COMPLAINT_PAGE_SIZE),
            sort: state.filters.sort
        });

        if (state.filters.search) {
            params.set("search", state.filters.search);
        }

        if (state.filters.status) {
            params.set("status", state.filters.status);
        }

        if (state.filters.priority) {
            params.set("priority", state.filters.priority);
        }

        if (state.isAdmin && state.filters.departmentId) {
            params.set(
                "departmentId",
                state.filters.departmentId
            );
        }

        if (state.filters.overdue) {
            params.set("overdue", "true");
        }

        if (state.filters.unassigned) {
            params.set("unassigned", "true");
        }

        return params;
    }

    function dueCell(complaint) {
        if (complaint.status === "Resolved") {
            return (
                '<span class="text-xs subtle">' +
                escape(
                    t("complaint.resolvedOn", {
                        date: I18N.formatDate(complaint.resolvedAt)
                    })
                ) +
                "</span>"
            );
        }

        if (complaint.status === "Rejected") {
            return (
                '<span class="text-xs subtle">' +
                escape(I18N.statusLabel(complaint.status)) +
                "</span>"
            );
        }

        if (complaint.isOverdue) {
            return (
                '<span class="badge badge-overdue">' +
                icon("clock", "icon-xs") +
                " " +
                escape(I18N.dueLabel(complaint.dueAt, true)) +
                "</span>"
            );
        }

        return (
            '<span class="text-xs subtle">' +
            escape(I18N.dueDateLabel(complaint.dueAt)) +
            "</span>"
        );
    }

    async function loadComplaints() {
        if (state.isAdmin) {
            try {
                await ensureDepartments();
                applyFiltersToControls();
            } catch (error) {
                /* The queue can still load when department metadata fails. */
            }
        }

        const token = nextToken("complaints");

        state.complaints = null;
        state.complaintPagination = null;
        elements.complaintList.innerHTML = skeletonRows(6, [
            70, 52, 64, 39
        ]);
        elements.complaintPagination.innerHTML = "";

        try {
            const data = await App.api.get(
                "/admin/complaints?" + complaintParams().toString()
            );

            if (!isCurrentToken("complaints", token)) {
                return;
            }

            state.complaints = data.complaints || [];
            state.complaintPagination = data.pagination || null;

            if (
                state.complaintPagination &&
                state.complaintPagination.total > 0 &&
                state.complaintPagination.totalPages > 0 &&
                state.filters.page >
                    state.complaintPagination.totalPages
            ) {
                state.filters.page =
                    state.complaintPagination.totalPages;
                syncUrl("replace");
                loadComplaints();
                return;
            }

            renderComplaints();
            renderComplaintPagination();
        } catch (error) {
            if (!isCurrentToken("complaints", token)) {
                return;
            }

            elements.complaintList.innerHTML = errorState(
                App.friendlyError(
                    error,
                    t("admin.complaintsError")
                ),
                "complaints"
            );
            elements.complaintPagination.innerHTML = "";
        }
    }

    function complaintFilterCount() {
        return [
            state.filters.search,
            state.filters.status,
            state.filters.priority,
            state.filters.departmentId,
            state.filters.overdue,
            state.filters.unassigned
        ].filter(Boolean).length;
    }

    function renderComplaints() {
        if (!Array.isArray(state.complaints)) {
            return;
        }

        if (state.complaints.length === 0) {
            const filtered = complaintFilterCount() > 0;

            elements.complaintList.innerHTML = emptyState(
                filtered ? "search" : "tickets",
                filtered
                    ? t("admin.emptyTitle")
                    : t("admin.queueEmptyTitle"),
                filtered
                    ? t("admin.emptyBody")
                    : t("admin.queueEmptyBody"),
                filtered
                    ? '<button type="button" class="btn btn-secondary btn-sm" data-admin-clear-filters>' +
                      escape(t("admin.clearFilters")) +
                      "</button>"
                    : ""
            );
            return;
        }

        elements.complaintList.innerHTML =
            '<div class="table-wrap"><table class="table"><thead><tr><th>' +
            escape(t("admin.tableReference")) +
            "</th><th>" +
            escape(t("admin.tableComplaint")) +
            "</th><th>" +
            escape(t("admin.tableDepartment")) +
            "</th><th>" +
            escape(t("admin.tablePriority")) +
            "</th><th>" +
            escape(t("admin.tableStatus")) +
            "</th><th>" +
            escape(t("admin.tableAssignee")) +
            "</th><th>" +
            escape(t("admin.tableDue")) +
            "</th><th>" +
            escape(t("admin.tableCreated")) +
            "</th></tr></thead><tbody>" +
            state.complaints
                .map((complaint) => {
                    const href = App.complaintUrl(complaint.id);

                    return (
                        '<tr class="is-clickable" data-complaint-href="' +
                        escape(href) +
                        '"><td><a class="ref" href="' +
                        escape(href) +
                        '">' +
                        escape(complaint.referenceNumber) +
                        '</a></td><td class="cell-main"><a href="' +
                        escape(href) +
                        '"><strong>' +
                        escape(complaint.title) +
                        "</strong></a><span>" +
                        escape(
                            I18N.categoryLabel(complaint.category)
                        ) +
                        " · " +
                        escape(complaint.createdBy.name) +
                        "</span></td><td>" +
                        (complaint.department
                            ? escape(
                                  I18N.departmentLabel(
                                      complaint.department.name
                                  )
                              )
                            : '<span class="cell-muted">—</span>') +
                        "</td><td>" +
                        App.priorityBadge(complaint.priority) +
                        "</td><td>" +
                        App.statusBadge(complaint.status) +
                        "</td><td>" +
                        (complaint.assignedTo
                            ? escape(complaint.assignedTo.name)
                            : '<span class="cell-muted">' +
                              escape(t("admin.unassigned")) +
                              "</span>") +
                        "</td><td>" +
                        dueCell(complaint) +
                        "</td><td>" +
                        escape(I18N.formatDate(complaint.createdAt)) +
                        "</td></tr>"
                    );
                })
                .join("") +
            "</tbody></table></div>";
    }

    function renderComplaintPagination() {
        const pagination = state.complaintPagination;

        if (!pagination || pagination.total === 0) {
            elements.complaintPagination.innerHTML = "";
            return;
        }

        const from =
            (pagination.page - 1) * pagination.pageSize + 1;
        const to = Math.min(
            pagination.page * pagination.pageSize,
            pagination.total
        );
        const pages = pagination.totalPages || 1;

        elements.complaintPagination.innerHTML =
            '<div class="pagination"><span>' +
            escape(
                t("common.showing", {
                    from: count(from),
                    to: count(to),
                    total: count(pagination.total)
                })
            ) +
            '</span><div class="pagination-buttons">' +
            '<button type="button" class="page-btn" data-admin-page="' +
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
            '<button type="button" class="page-btn" data-admin-page="' +
            (pagination.page + 1) +
            '" aria-label="' +
            escape(t("common.next")) +
            '"' +
            (pagination.page >= pages ? " disabled" : "") +
            ">" +
            icon("chevron-right") +
            "</button></div></div>";
    }

    function updateComplaintFilter(name, value) {
        state.filters[name] = value;
        state.filters.page = 1;
        syncUrl("replace");
        loadComplaints();
    }

    function clearComplaintFilters() {
        state.filters.search = "";
        state.filters.status = "";
        state.filters.priority = "";
        state.filters.departmentId = "";
        state.filters.sort = "newest";
        state.filters.overdue = false;
        state.filters.unassigned = false;
        state.filters.page = 1;
        applyFiltersToControls();
        syncUrl("replace");
        loadComplaints();
    }

    async function exportComplaints() {
        if (
            state.complaintPagination &&
            state.complaintPagination.total === 0
        ) {
            App.toast(t("admin.exportEmpty"), "warning");
            return;
        }

        const restore = App.buttonLoading(
            elements.exportButton,
            t("admin.exporting")
        );

        try {
            const params = complaintParams();
            params.delete("page");
            params.delete("pageSize");

            const response = await fetch(
                "/api/admin/export?" + params.toString(),
                {
                    credentials: "same-origin",
                    headers: { Accept: "text/csv" }
                }
            );

            if (!response.ok) {
                let message = t("admin.exportError");

                try {
                    const data = await response.json();
                    message = data.message || message;
                } catch (error) {
                    /* Keep the translated fallback. */
                }

                throw new Error(message);
            }

            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");

            link.href = url;
            link.download =
                "campusfix-complaints-" +
                new Date().toISOString().slice(0, 10) +
                ".csv";
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
            App.toast(t("admin.exported"));
        } catch (error) {
            App.toast(
                error && error.message
                    ? error.message
                    : t("admin.exportError"),
                "error"
            );
        } finally {
            restore();
        }
    }

    /* Notices -------------------------------------------------------------- */

    function noticeLifecycle(notice) {
        const now = Date.now();
        const starts = notice.publishedAt
            ? new Date(notice.publishedAt).getTime()
            : 0;
        const ends = notice.expiresAt
            ? new Date(notice.expiresAt).getTime()
            : 0;

        if (starts > now) {
            return { key: "admin.scheduled", tone: "brand" };
        }

        if (ends && ends <= now) {
            return { key: "admin.expired", tone: "neutral" };
        }

        return { key: "admin.live", tone: "success" };
    }

    async function loadNotices() {
        const token = nextToken("notices");

        state.notices = null;
        elements.noticeList.innerHTML = skeletonRows(4, [
            64, 82, 48, 74
        ]);

        try {
            const data = await App.api.get("/admin/notices");

            if (!isCurrentToken("notices", token)) {
                return;
            }

            state.notices = data.notices || [];
            renderNotices();
        } catch (error) {
            if (!isCurrentToken("notices", token)) {
                return;
            }

            elements.noticeList.innerHTML = errorState(
                App.friendlyError(error, t("common.loadingError")),
                "notices"
            );
        }
    }

    function renderNotices() {
        if (!Array.isArray(state.notices)) {
            return;
        }

        if (state.notices.length === 0) {
            elements.noticeList.innerHTML = emptyState(
                "megaphone",
                t("admin.noNoticesTitle"),
                t("admin.noNoticesBody"),
                state.isAdmin
                    ? '<button type="button" class="btn btn-primary btn-sm" data-notice-new>' +
                      icon("plus") +
                      escape(t("admin.newNotice")) +
                      "</button>"
                    : ""
            );
            return;
        }

        elements.noticeList.innerHTML =
            '<div class="notice-list">' +
            state.notices
                .map((notice) => {
                    const lifecycle = noticeLifecycle(notice);
                    const actions = state.isAdmin
                        ? '<span class="cluster cluster-tight" style="margin-left:auto"><button type="button" class="btn btn-ghost btn-sm" data-notice-edit="' +
                          escape(notice.id) +
                          '">' +
                          icon("edit") +
                          "<span>" +
                          escape(t("common.edit")) +
                          '</span></button><button type="button" class="btn btn-ghost btn-icon text-danger" data-notice-delete="' +
                          escape(notice.id) +
                          '" aria-label="' +
                          escape(t("admin.deleteNotice")) +
                          '" title="' +
                          escape(t("admin.deleteNotice")) +
                          '">' +
                          icon("trash") +
                          "</button></span>"
                        : "";

                    return (
                        '<article class="notice-item' +
                        (notice.priority === "High"
                            ? " is-high"
                            : "") +
                        '"><span class="notice-icon">' +
                        icon("megaphone") +
                        '</span><div class="notice-body"><div class="cluster" style="gap:8px;align-items:flex-start;justify-content:space-between"><h3>' +
                        escape(notice.title) +
                        '</h3><span class="cluster cluster-tight">' +
                        '<span class="badge" data-tone="' +
                        lifecycle.tone +
                        '"><span class="badge-dot"></span>' +
                        escape(t(lifecycle.key)) +
                        "</span>" +
                        (notice.priority === "High"
                            ? '<span class="badge" data-tone="warning">' +
                              escape(t("notices.highPriority")) +
                              "</span>"
                            : "") +
                        "</span></div><p>" +
                        escape(notice.body) +
                        '</p><div class="notice-meta"><span>' +
                        escape(I18N.audienceLabel(notice.audience)) +
                        "</span><span>·</span><span>" +
                        escape(
                            t("notices.published", {
                                date: I18N.formatDate(
                                    notice.publishedAt
                                )
                            })
                        ) +
                        "</span><span>·</span><span>" +
                        escape(
                            notice.expiresAt
                                ? t("notices.expires", {
                                      date: I18N.formatDate(
                                          notice.expiresAt
                                      )
                                  })
                                : t("notices.noExpiry")
                        ) +
                        "</span>" +
                        actions +
                        "</div></div></article>"
                    );
                })
                .join("") +
            "</div>";
    }

    function updateNoticeDialogLabels() {
        const editing = Boolean(state.editingNoticeId);

        elements.noticeDialogTitle.textContent = editing
            ? t("admin.editNotice")
            : t("admin.noticeFormTitle");
        elements.noticeSubmitLabel.textContent = editing
            ? t("admin.saveNotice")
            : t("admin.publishBtn");
    }

    function openNoticeDialog(notice) {
        state.editingNoticeId = notice ? notice.id : null;
        elements.noticeForm.reset();
        elements.noticeAudience.value = "all";
        elements.noticePriority.value = "Normal";
        elements.noticeTitle.value = notice ? notice.title : "";
        elements.noticeBody.value = notice ? notice.body : "";
        elements.noticePublishedAt.value = notice
            ? toLocalInput(notice.publishedAt)
            : "";
        elements.noticeExpiresAt.value =
            notice && notice.expiresAt
                ? toLocalInput(notice.expiresAt)
                : "";
        App.clearFieldErrors(elements.noticeForm);
        updateNoticeDialogLabels();
        elements.noticeDialog.showModal();
        elements.noticeTitle.focus();
    }

    async function handleNoticeSubmit(event) {
        event.preventDefault();
        App.clearFieldErrors(elements.noticeForm);

        const noticeId = state.editingNoticeId;
        const title = elements.noticeTitle.value.trim();
        const body = elements.noticeBody.value.trim();
        const publishedValue = elements.noticePublishedAt.value;
        const expiresValue = elements.noticeExpiresAt.value;
        let valid = true;

        if (!title) {
            App.fieldError(
                elements.noticeTitle,
                t("common.requiredField")
            );
            valid = false;
        }

        if (!body) {
            App.fieldError(
                elements.noticeBody,
                t("common.requiredField")
            );
            valid = false;
        }

        if (
            expiresValue &&
            publishedValue &&
            new Date(expiresValue).getTime() <=
                new Date(publishedValue).getTime()
        ) {
            App.fieldError(
                elements.noticeExpiresAt,
                t("admin.expiryAfterPublish")
            );
            valid = false;
        }

        if (!valid) {
            return;
        }

        const payload = {
            title,
            body,
            audience: elements.noticeAudience.value,
            priority: elements.noticePriority.value
        };

        if (publishedValue) {
            payload.publishedAt = new Date(
                publishedValue
            ).toISOString();
        }

        if (expiresValue) {
            payload.expiresAt = new Date(expiresValue).toISOString();
        } else if (noticeId) {
            payload.expiresAt = null;
        }

        const restore = App.buttonLoading(
            elements.noticeSubmit,
            noticeId ? t("common.saving") : t("admin.publishing")
        );

        try {
            if (noticeId) {
                await App.api.patch(
                    "/admin/notices/" + encodeURIComponent(noticeId),
                    payload
                );
            } else {
                await App.api.post("/admin/notices", payload);
            }

            elements.noticeDialog.close();
            App.toast(t("admin.noticeSaved"));
            await loadNotices();
        } catch (error) {
            applyServerErrors(elements.noticeForm, error);
        } finally {
            restore();
        }
    }

    async function deleteNotice(notice) {
        const confirmed = await App.confirm({
            title: t("admin.deleteNoticeTitle"),
            message: t("admin.deleteNoticeBody"),
            confirmLabel: t("admin.deleteNotice")
        });

        if (!confirmed) {
            return;
        }

        try {
            await App.api.del(
                "/admin/notices/" + encodeURIComponent(notice.id)
            );
            App.toast(t("admin.noticeDeleted"));
            await loadNotices();
        } catch (error) {
            App.toast(App.friendlyError(error), "error");
        }
    }

    /* Team and access ------------------------------------------------------ */

    async function loadUsers() {
        const token = nextToken("users");

        state.users = null;
        elements.userList.innerHTML = skeletonRows(5, [
            58, 73, 47, 66
        ]);

        try {
            await ensureDepartments();
        } catch (error) {
            /* The list may still be readable when departments fail. */
        }

        applyUserFiltersToControls();

        const params = new URLSearchParams();

        if (state.userFilters.search) {
            params.set("search", state.userFilters.search);
        }

        if (state.userFilters.role) {
            params.set("role", state.userFilters.role);
        }

        if (state.userFilters.departmentId) {
            params.set(
                "departmentId",
                state.userFilters.departmentId
            );
        }

        try {
            const data = await App.api.get(
                "/admin/users" +
                    (params.toString()
                        ? "?" + params.toString()
                        : "")
            );

            if (!isCurrentToken("users", token)) {
                return;
            }

            state.users = data.users || [];
            renderUsers();
        } catch (error) {
            if (!isCurrentToken("users", token)) {
                return;
            }

            elements.userList.innerHTML = errorState(
                App.friendlyError(error, t("common.loadingError")),
                "users"
            );
        }
    }

    function renderUsers() {
        if (!Array.isArray(state.users)) {
            return;
        }

        if (state.users.length === 0) {
            elements.userList.innerHTML = emptyState(
                "users",
                t("admin.noUsersTitle"),
                t("admin.noUsersBody")
            );
            return;
        }

        elements.userList.innerHTML =
            '<div class="table-wrap"><table class="table"><thead><tr><th>' +
            escape(t("admin.user")) +
            "</th><th>" +
            escape(t("admin.role")) +
            "</th><th>" +
            escape(t("admin.department")) +
            "</th><th>" +
            escape(t("admin.joined")) +
            "</th><th>" +
            escape(t("common.actions")) +
            "</th></tr></thead><tbody>" +
            state.users
                .map(
                    (user) =>
                        '<tr><td><div class="user-cell">' +
                        App.avatar(user.name) +
                        '<div class="user-cell-copy"><strong>' +
                        escape(user.name) +
                        "</strong><span>" +
                        escape(user.email) +
                        '</span></div></div></td><td><span class="role-chip">' +
                        escape(I18N.roleLabel(user.role)) +
                        "</span></td><td>" +
                        (user.departmentName
                            ? escape(
                                  I18N.departmentLabel(
                                      user.departmentName
                                  )
                              )
                            : '<span class="cell-muted">' +
                              escape(t("admin.noDepartment")) +
                              "</span>") +
                        "</td><td>" +
                        escape(I18N.formatDate(user.createdAt)) +
                        '</td><td><button type="button" class="btn btn-secondary btn-sm" data-user-access="' +
                        escape(user.id) +
                        '">' +
                        escape(t("admin.changeAccess")) +
                        "</button></td></tr>"
                )
                .join("") +
            "</tbody></table></div>";
    }

    function syncAccessDepartmentField() {
        const needsDepartment = [
            "staff",
            "department_manager"
        ].includes(elements.accessRole.value);

        elements.accessDepartment.disabled = !needsDepartment;

        if (!needsDepartment) {
            elements.accessDepartment.value = "";
        }
    }

    async function openAccessDialog(user) {
        state.editingUserId = user.id;
        elements.accessUserName.textContent = user.name;
        elements.accessUserEmail.textContent = user.email;
        elements.accessRole.value = user.role;

        try {
            await ensureDepartments();
        } catch (error) {
            App.toast(App.friendlyError(error), "error");
        }

        fillDepartmentSelect(
            elements.accessDepartment,
            t("admin.noDepartment"),
            user.departmentId || "",
            true
        );
        App.clearFieldErrors(elements.accessForm);
        syncAccessDepartmentField();
        elements.accessDialog.showModal();
        elements.accessRole.focus();
    }

    async function handleAccessSubmit(event) {
        event.preventDefault();
        App.clearFieldErrors(elements.accessForm);

        const userId = state.editingUserId;
        const role = elements.accessRole.value;
        const departmentId = elements.accessDepartment.value;

        if (!userId) {
            return;
        }

        if (
            ["staff", "department_manager"].includes(role) &&
            !departmentId
        ) {
            App.fieldError(
                elements.accessDepartment,
                t("admin.accessDepartmentHint")
            );
            return;
        }

        const payload = { role };

        if (departmentId) {
            payload.departmentId = departmentId;
        }

        const restore = App.buttonLoading(
            elements.accessSubmit,
            t("common.saving")
        );

        try {
            await App.api.patch(
                "/admin/users/" + encodeURIComponent(userId),
                payload
            );

            elements.accessDialog.close();
            App.toast(t("admin.accessUpdated"));
            await loadUsers();
        } catch (error) {
            applyServerErrors(elements.accessForm, error);
        } finally {
            restore();
        }
    }

    /* Configuration -------------------------------------------------------- */

    async function loadConfig() {
        return Promise.all([
            loadDepartmentsConfig(true),
            loadCategories(),
            loadSla()
        ]);
    }

    async function loadDepartmentsConfig(force) {
        const token = nextToken("departments");

        elements.departmentList.innerHTML = skeletonRows(3, [
            48, 61, 38
        ]);

        try {
            await ensureDepartments(force);
        } catch (error) {
            if (!isCurrentToken("departments", token)) {
                return;
            }

            elements.departmentList.innerHTML = errorState(
                App.friendlyError(error, t("common.loadingError")),
                "departments"
            );
            return;
        }

        if (!isCurrentToken("departments", token)) {
            return;
        }

        renderDepartmentsConfig();
    }

    function renderConfigSkeleton(container) {
        container.innerHTML = skeletonRows(3, [55, 68, 41]);
    }

    function renderDepartmentsConfig() {
        if (state.departments.length === 0) {
            elements.departmentList.innerHTML = emptyState(
                "building",
                t("admin.departmentsTitle"),
                t("admin.departmentsSubtitle")
            );
            return;
        }

        elements.departmentList.innerHTML = state.departments
            .map(
                (department) =>
                    '<div class="config-row"><span class="config-glyph">' +
                    icon("building") +
                    '</span><div class="config-copy"><strong>' +
                    escape(I18N.departmentLabel(department.name)) +
                    ' <span class="role-chip">' +
                    escape(department.code) +
                    "</span> " +
                    (department.isActive
                        ? '<span class="badge" data-tone="success">' +
                          escape(t("common.active")) +
                          "</span>"
                        : '<span class="badge" data-tone="neutral">' +
                          escape(t("admin.inactive")) +
                          "</span>") +
                    "</strong><span>" +
                    escape(
                        department.description ||
                            t("common.notProvided")
                    ) +
                    (department.contactEmail
                        ? " · " + escape(department.contactEmail)
                        : "") +
                    '</span></div><div class="config-actions"><button type="button" class="btn btn-ghost btn-sm" data-edit-department="' +
                    escape(department.id) +
                    '">' +
                    icon("edit") +
                    "<span>" +
                    escape(t("common.edit")) +
                    "</span></button></div></div>"
            )
            .join("");
    }

    async function loadCategories() {
        const token = nextToken("categories");

        state.configCategories = null;
        renderConfigSkeleton(elements.categoryList);

        try {
            const data = await App.api.get("/admin/categories");

            if (!isCurrentToken("categories", token)) {
                return;
            }

            state.configCategories = data.categories || [];
            renderCategories();
        } catch (error) {
            if (!isCurrentToken("categories", token)) {
                return;
            }

            elements.categoryList.innerHTML = errorState(
                App.friendlyError(error, t("common.loadingError")),
                "categories"
            );
        }
    }

    function renderCategories() {
        if (!Array.isArray(state.configCategories)) {
            return;
        }

        if (state.configCategories.length === 0) {
            elements.categoryList.innerHTML = emptyState(
                "tag",
                t("admin.categoriesTitle"),
                t("admin.categoriesSubtitle")
            );
            return;
        }

        elements.categoryList.innerHTML = state.configCategories
            .map(
                (category) =>
                    '<div class="config-row"><span class="config-glyph">' +
                    icon("tag") +
                    '</span><div class="config-copy"><strong>' +
                    escape(I18N.categoryLabel(category.name)) +
                    " " +
                    (category.isActive
                        ? '<span class="badge" data-tone="success">' +
                          escape(t("admin.visibleToStudents")) +
                          "</span>"
                        : '<span class="badge" data-tone="neutral">' +
                          escape(t("admin.hiddenFromStudents")) +
                          "</span>") +
                    "</strong><span>" +
                    escape(
                        I18N.departmentLabel(
                            category.departmentName
                        )
                    ) +
                    " · " +
                    escape(t("admin.categoryOrder")) +
                    ": " +
                    count(category.sortOrder) +
                    '</span></div><div class="config-actions"><button type="button" class="btn btn-ghost btn-sm" data-edit-category="' +
                    escape(category.id) +
                    '">' +
                    icon("edit") +
                    "<span>" +
                    escape(t("common.edit")) +
                    "</span></button></div></div>"
            )
            .join("");
    }

    async function loadSla() {
        const token = nextToken("sla");

        state.configSla = null;
        renderConfigSkeleton(elements.slaList);

        try {
            const data = await App.api.get("/admin/sla");

            if (!isCurrentToken("sla", token)) {
                return;
            }

            state.configSla = data.sla || [];
            renderSla();
        } catch (error) {
            if (!isCurrentToken("sla", token)) {
                return;
            }

            elements.slaList.innerHTML = errorState(
                App.friendlyError(error, t("common.loadingError")),
                "sla"
            );
        }
    }

    function renderSla() {
        const policies = state.configSla || [];

        if (policies.length === 0) {
            elements.slaList.innerHTML = emptyState(
                "clock",
                t("admin.slaTitle"),
                t("admin.slaSubtitle")
            );
            return;
        }

        const sorted = SLA_ORDER.map((priority) =>
            policies.find(
                (policy) => policy.priority === priority
            )
        ).filter(Boolean);

        elements.slaList.innerHTML = sorted
            .map(
                (policy) =>
                    '<form class="config-row" data-sla-form data-sla-priority="' +
                    escape(policy.priority) +
                    '" novalidate><span class="config-glyph">' +
                    icon("clock") +
                    '</span><div class="config-copy"><strong>' +
                    escape(I18N.priorityLabel(policy.priority)) +
                    "</strong><span>" +
                    escape(t("admin.slaHours")) +
                    '</span></div><div class="config-actions"><input type="number" name="responseHours" min="1" max="8760" step="1" value="' +
                    escape(policy.responseHours) +
                    '" aria-label="' +
                    escape(
                        t("admin.slaHours") +
                            " — " +
                            I18N.priorityLabel(policy.priority)
                    ) +
                    '" style="width:110px"><button type="submit" class="btn btn-secondary btn-sm" data-sla-save>' +
                    escape(t("admin.saveSla")) +
                    "</button></div></form>"
            )
            .join("");
    }

    function openDepartmentDialog(department) {
        state.editingDepartmentId = department ? department.id : null;
        elements.departmentForm.reset();
        elements.departmentCode.disabled = Boolean(department);
        elements.departmentCode.value = department
            ? department.code
            : "";
        elements.departmentName.value = department
            ? department.name
            : "";
        elements.departmentDescription.value = department
            ? department.description || ""
            : "";
        elements.departmentEmail.value =
            department && department.contactEmail
                ? department.contactEmail
                : "";
        elements.departmentActive.checked = department
            ? Boolean(department.isActive)
            : true;
        elements.departmentDialogTitle.textContent = department
            ? t("admin.editDepartment")
            : t("admin.addDepartment");
        App.clearFieldErrors(elements.departmentForm);
        elements.departmentDialog.showModal();
        elements.departmentName.focus();
    }

    async function handleDepartmentSubmit(event) {
        event.preventDefault();
        App.clearFieldErrors(elements.departmentForm);

        const departmentId = state.editingDepartmentId;
        const code = elements.departmentCode.value
            .trim()
            .toUpperCase();
        const name = elements.departmentName.value.trim();
        const description = elements.departmentDescription.value.trim();
        const contactEmail = elements.departmentEmail.value.trim();
        let valid = true;

        if (!departmentId && !/^[A-Z0-9_]{2,30}$/.test(code)) {
            App.fieldError(
                elements.departmentCode,
                t("common.requiredField")
            );
            valid = false;
        }

        if (name.length < 2) {
            App.fieldError(
                elements.departmentName,
                t("common.requiredField")
            );
            valid = false;
        }

        if (!valid) {
            return;
        }

        const payload = {
            name,
            description,
            isActive: elements.departmentActive.checked
        };

        if (departmentId) {
            payload.contactEmail = contactEmail || null;
        } else {
            payload.code = code;

            if (contactEmail) {
                payload.contactEmail = contactEmail;
            }
        }

        const restore = App.buttonLoading(
            elements.departmentSubmit,
            t("common.saving")
        );

        try {
            if (departmentId) {
                await App.api.patch(
                    "/admin/departments/" +
                        encodeURIComponent(departmentId),
                    payload
                );
                App.toast(t("admin.departmentUpdated"));
            } else {
                await App.api.post("/admin/departments", payload);
                App.toast(t("admin.departmentCreated"));
            }

            elements.departmentDialog.close();
            await loadDepartmentsConfig(true);
            await loadCategories();
        } catch (error) {
            applyServerErrors(elements.departmentForm, error);
        } finally {
            restore();
        }
    }

    async function openCategoryDialog(category) {
        state.editingCategoryId = category ? category.id : null;

        try {
            await ensureDepartments();
        } catch (error) {
            App.toast(App.friendlyError(error), "error");
            return;
        }

        if (state.departments.length === 0) {
            App.toast(t("admin.departmentFirst"), "warning");
            return;
        }

        elements.categoryForm.reset();
        elements.categoryName.value = category ? category.name : "";
        elements.categoryOrder.value = category
            ? String(category.sortOrder)
            : "100";
        elements.categoryActive.checked = category
            ? Boolean(category.isActive)
            : true;
        fillDepartmentSelect(
            elements.categoryDepartment,
            t("admin.chooseDepartment"),
            category ? category.departmentId : "",
            true
        );
        elements.categoryDialogTitle.textContent = category
            ? t("admin.editCategory")
            : t("admin.addCategory");
        elements.categorySubmitLabel.textContent = category
            ? t("common.save")
            : t("admin.addCategory");
        App.clearFieldErrors(elements.categoryForm);
        elements.categoryDialog.showModal();
        elements.categoryName.focus();
    }

    async function handleCategorySubmit(event) {
        event.preventDefault();
        App.clearFieldErrors(elements.categoryForm);

        const categoryId = state.editingCategoryId;
        const name = elements.categoryName.value.trim();
        const departmentId = elements.categoryDepartment.value;
        const sortOrder = Number(elements.categoryOrder.value);
        let valid = true;

        if (!name) {
            App.fieldError(
                elements.categoryName,
                t("common.requiredField")
            );
            valid = false;
        }

        if (!departmentId) {
            App.fieldError(
                elements.categoryDepartment,
                t("admin.chooseDepartment")
            );
            valid = false;
        }

        if (
            !Number.isInteger(sortOrder) ||
            sortOrder < 0 ||
            sortOrder > 1000
        ) {
            App.fieldError(
                elements.categoryOrder,
                t("admin.categoryOrderInvalid")
            );
            valid = false;
        }

        if (!valid) {
            return;
        }

        const payload = {
            name,
            departmentId,
            sortOrder,
            isActive: elements.categoryActive.checked
        };
        const restore = App.buttonLoading(
            elements.categorySubmit,
            t("common.saving")
        );

        try {
            if (categoryId) {
                await App.api.patch(
                    "/admin/categories/" +
                        encodeURIComponent(categoryId),
                    payload
                );
                App.toast(t("admin.categoryUpdated"));
            } else {
                await App.api.post("/admin/categories", payload);
                App.toast(t("admin.categoryCreated"));
            }

            elements.categoryDialog.close();
            await loadCategories();
        } catch (error) {
            applyServerErrors(elements.categoryForm, error);
        } finally {
            restore();
        }
    }

    async function handleSlaSubmit(event) {
        const form = event.target.closest("[data-sla-form]");

        if (!form) {
            return;
        }

        event.preventDefault();

        const priority = form.getAttribute("data-sla-priority");
        const input = form.querySelector(
            'input[name="responseHours"]'
        );
        const button = form.querySelector("[data-sla-save]");
        const responseHours = Number(input.value);

        input.removeAttribute("aria-invalid");

        if (
            !Number.isInteger(responseHours) ||
            responseHours < 1 ||
            responseHours > 8760
        ) {
            input.setAttribute("aria-invalid", "true");
            App.toast(t("admin.slaInvalid"), "error");
            return;
        }

        const restore = App.buttonLoading(
            button,
            t("common.saving")
        );

        try {
            await App.api.put(
                "/admin/sla/" + encodeURIComponent(priority),
                { responseHours }
            );
            App.toast(t("admin.slaUpdated"));
            await loadSla();
        } catch (error) {
            App.toast(App.friendlyError(error), "error");
        } finally {
            restore();
        }
    }

    /* Audit ---------------------------------------------------------------- */

    async function loadAudit() {
        if (!state.isAdmin) {
            return;
        }

        const token = nextToken("audit");
        const params = new URLSearchParams({
            page: String(state.auditPage),
            pageSize: String(AUDIT_PAGE_SIZE)
        });

        state.auditLogs = null;
        state.auditPagination = null;
        elements.auditList.innerHTML = skeletonRows(6, [
            44, 60, 52, 73
        ]);
        elements.auditPagination.innerHTML = "";

        try {
            const data = await App.api.get(
                "/admin/audit?" + params.toString()
            );

            if (!isCurrentToken("audit", token)) {
                return;
            }

            state.auditLogs = data.logs || [];
            state.auditPagination = data.pagination || null;

            if (
                state.auditPagination &&
                state.auditPagination.total > 0 &&
                state.auditPagination.totalPages > 0 &&
                state.auditPage > state.auditPagination.totalPages
            ) {
                state.auditPage =
                    state.auditPagination.totalPages;
                syncUrl("replace");
                loadAudit();
                return;
            }

            renderAudit();
            renderAuditPagination();
        } catch (error) {
            if (!isCurrentToken("audit", token)) {
                return;
            }

            elements.auditList.innerHTML = errorState(
                App.friendlyError(error, t("common.loadingError")),
                "audit"
            );
            elements.auditPagination.innerHTML = "";
        }
    }

    function renderAudit() {
        if (!Array.isArray(state.auditLogs)) {
            return;
        }

        if (state.auditLogs.length === 0) {
            elements.auditList.innerHTML = emptyState(
                "activity",
                t("admin.noAuditTitle"),
                t("admin.noAuditBody")
            );
            return;
        }

        elements.auditList.innerHTML =
            '<div class="table-wrap"><table class="table"><thead><tr><th>' +
            escape(t("admin.auditTime")) +
            "</th><th>" +
            escape(t("admin.auditActor")) +
            "</th><th>" +
            escape(t("admin.auditAction")) +
            "</th><th>" +
            escape(t("admin.auditEntity")) +
            "</th><th>" +
            escape(t("admin.auditDetails")) +
            "</th></tr></thead><tbody>" +
            state.auditLogs
                .map((log) => {
                    const metadata =
                        log.metadata &&
                        Object.keys(log.metadata).length > 0
                            ? JSON.stringify(log.metadata)
                            : "";

                    return (
                        "<tr><td>" +
                        escape(I18N.formatDateTime(log.createdAt)) +
                        "</td><td>" +
                        escape(log.actorName || t("common.system")) +
                        '</td><td><span class="audit-action">' +
                        escape(log.action) +
                        "</span></td><td>" +
                        escape(log.entityType || "—") +
                        (log.entityId
                            ? '<br><span class="cell-muted text-xs">' +
                              escape(String(log.entityId).slice(0, 12)) +
                              "</span>"
                            : "") +
                        '</td><td><span class="audit-meta" title="' +
                        escape(metadata) +
                        '">' +
                        escape(metadata || "—") +
                        "</span></td></tr>"
                    );
                })
                .join("") +
            "</tbody></table></div>";
    }

    function renderAuditPagination() {
        const pagination = state.auditPagination;

        if (!pagination || pagination.total === 0) {
            elements.auditPagination.innerHTML = "";
            return;
        }

        const pages = pagination.totalPages || 1;

        elements.auditPagination.innerHTML =
            '<div class="pagination"><span>' +
            escape(
                t("common.showingCount", {
                    count: count(pagination.total)
                })
            ) +
            '</span><div class="pagination-buttons">' +
            '<button type="button" class="page-btn" data-audit-page="' +
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
            '<button type="button" class="page-btn" data-audit-page="' +
            (pagination.page + 1) +
            '" aria-label="' +
            escape(t("common.next")) +
            '"' +
            (pagination.page >= pages ? " disabled" : "") +
            ">" +
            icon("chevron-right") +
            "</button></div></div>";
    }

    /* Shared events -------------------------------------------------------- */

    function applyQueueFilter(filter) {
        state.filters.search = "";
        state.filters.priority = "";
        state.filters.departmentId = "";
        state.filters.sort = "newest";
        state.filters.overdue = filter === "overdue";
        state.filters.unassigned = filter === "unassigned";
        state.filters.status =
            filter === "pending" ? "Pending" : "";
        state.filters.page = 1;
        applyFiltersToControls();
        activateTab("complaints", { push: true });
    }

    const retryActions = {
        stats: loadStats,
        recent: loadRecent,
        complaints: loadComplaints,
        notices: loadNotices,
        users: loadUsers,
        departments: () => loadDepartmentsConfig(true),
        categories: loadCategories,
        sla: loadSla,
        audit: loadAudit
    };

    function bindEvents() {
        elements.tabList.addEventListener("click", (event) => {
            const button = event.target.closest("[data-admin-tab]");

            if (!button) {
                return;
            }

            activateTab(button.getAttribute("data-admin-tab"), {
                push: true
            });
        });

        elements.tabList.addEventListener("keydown", (event) => {
            const buttons = elements.tabButtons.filter(
                (button) => !button.hidden
            );
            const currentIndex = buttons.indexOf(
                event.target.closest("[data-admin-tab]")
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
            activateTab(next.getAttribute("data-admin-tab"), {
                push: true
            });
            next.focus();
        });

        window.addEventListener("popstate", () => {
            readUrlState();
            applyFiltersToControls();
            activateTab(state.tab, { updateHistory: false });
        });

        elements.refresh.addEventListener("click", refreshCurrentTab);

        elements.search.addEventListener("input", (event) => {
            const value = event.target.value;

            window.clearTimeout(state.complaintSearchTimer);
            state.complaintSearchTimer = window.setTimeout(() => {
                updateComplaintFilter("search", value.trim());
            }, 300);
        });

        elements.statusFilter.addEventListener("change", (event) => {
            updateComplaintFilter("status", event.target.value);
        });
        elements.priorityFilter.addEventListener("change", (event) => {
            updateComplaintFilter("priority", event.target.value);
        });
        elements.departmentFilter.addEventListener(
            "change",
            (event) => {
                updateComplaintFilter(
                    "departmentId",
                    event.target.value
                );
            }
        );
        elements.sortFilter.addEventListener("change", (event) => {
            updateComplaintFilter("sort", event.target.value);
        });
        elements.overdueFilter.addEventListener("change", (event) => {
            updateComplaintFilter("overdue", event.target.checked);
        });
        elements.unassignedFilter.addEventListener(
            "change",
            (event) => {
                updateComplaintFilter(
                    "unassigned",
                    event.target.checked
                );
            }
        );

        elements.exportButton.addEventListener(
            "click",
            exportComplaints
        );

        elements.complaintList.addEventListener("click", (event) => {
            if (event.target.closest("[data-admin-clear-filters]")) {
                clearComplaintFilters();
            }
        });

        elements.complaintPagination.addEventListener(
            "click",
            (event) => {
                const button = event.target.closest("[data-admin-page]");

                if (!button || button.disabled) {
                    return;
                }

                const page = Number(button.getAttribute("data-admin-page"));

                if (!Number.isInteger(page) || page < 1) {
                    return;
                }

                state.filters.page = page;
                syncUrl("replace");
                loadComplaints();
            }
        );

        elements.newNotice.addEventListener("click", () => {
            openNoticeDialog(null);
        });

        elements.noticeList.addEventListener("click", (event) => {
            const newButton = event.target.closest("[data-notice-new]");

            if (newButton) {
                openNoticeDialog(null);
                return;
            }

            const editButton = event.target.closest("[data-notice-edit]");

            if (editButton) {
                const notice = (state.notices || []).find(
                    (entry) =>
                        entry.id ===
                        editButton.getAttribute("data-notice-edit")
                );

                if (notice) {
                    openNoticeDialog(notice);
                }

                return;
            }

            const deleteButton = event.target.closest(
                "[data-notice-delete]"
            );

            if (deleteButton) {
                const notice = (state.notices || []).find(
                    (entry) =>
                        entry.id ===
                        deleteButton.getAttribute("data-notice-delete")
                );

                if (notice) {
                    deleteNotice(notice);
                }
            }
        });

        elements.noticeForm.addEventListener("submit", handleNoticeSubmit);

        elements.userSearch.addEventListener("input", (event) => {
            const value = event.target.value;

            window.clearTimeout(state.userSearchTimer);
            state.userSearchTimer = window.setTimeout(() => {
                state.userFilters.search = value.trim();
                loadUsers();
            }, 300);
        });
        elements.userRoleFilter.addEventListener("change", (event) => {
            state.userFilters.role = event.target.value;
            loadUsers();
        });
        elements.userDepartmentFilter.addEventListener(
            "change",
            (event) => {
                state.userFilters.departmentId = event.target.value;
                loadUsers();
            }
        );

        elements.userList.addEventListener("click", (event) => {
            const button = event.target.closest("[data-user-access]");
            const user = button
                ? getUserById(button.getAttribute("data-user-access"))
                : null;

            if (user) {
                openAccessDialog(user);
            }
        });

        elements.accessForm.addEventListener(
            "submit",
            handleAccessSubmit
        );
        elements.accessRole.addEventListener(
            "change",
            syncAccessDepartmentField
        );

        elements.newDepartment.addEventListener("click", () => {
            openDepartmentDialog(null);
        });
        elements.newCategory.addEventListener("click", () => {
            openCategoryDialog(null);
        });

        elements.departmentForm.addEventListener(
            "submit",
            handleDepartmentSubmit
        );
        elements.departmentCode.addEventListener("input", (event) => {
            const position = event.target.selectionStart;

            event.target.value = event.target.value.toUpperCase();
            event.target.setSelectionRange(position, position);
        });

        elements.categoryForm.addEventListener(
            "submit",
            handleCategorySubmit
        );
        elements.slaList.addEventListener("submit", handleSlaSubmit);

        elements.departmentList.addEventListener("click", (event) => {
            const button = event.target.closest(
                "[data-edit-department]"
            );

            if (!button) {
                return;
            }

            const department = state.departments.find(
                (entry) =>
                    entry.id ===
                    button.getAttribute("data-edit-department")
            );

            if (department) {
                openDepartmentDialog(department);
            }
        });

        elements.categoryList.addEventListener("click", (event) => {
            const button = event.target.closest("[data-edit-category]");

            if (!button) {
                return;
            }

            const category = (state.configCategories || []).find(
                (entry) =>
                    entry.id ===
                    button.getAttribute("data-edit-category")
            );

            if (category) {
                openCategoryDialog(category);
            }
        });

        elements.auditPagination.addEventListener(
            "click",
            (event) => {
                const button = event.target.closest("[data-audit-page]");

                if (!button || button.disabled) {
                    return;
                }

                const page = Number(button.getAttribute("data-audit-page"));

                if (!Number.isInteger(page) || page < 1) {
                    return;
                }

                state.auditPage = page;
                syncUrl("replace");
                loadAudit();
            }
        );

        [
            elements.noticeDialog,
            elements.accessDialog,
            elements.departmentDialog,
            elements.categoryDialog
        ].forEach((dialog) => {
            dialog
                .querySelectorAll("[data-close-dialog]")
                .forEach((button) => {
                    button.addEventListener("click", () => {
                        dialog.close();
                    });
                });
        });

        elements.noticeDialog.addEventListener("close", () => {
            state.editingNoticeId = null;
            App.clearFieldErrors(elements.noticeForm);
        });
        elements.accessDialog.addEventListener("close", () => {
            App.clearFieldErrors(elements.accessForm);
        });
        elements.departmentDialog.addEventListener("close", () => {
            elements.departmentCode.disabled = false;
            App.clearFieldErrors(elements.departmentForm);
        });
        elements.categoryDialog.addEventListener("close", () => {
            App.clearFieldErrors(elements.categoryForm);
        });

        document.addEventListener("click", (event) => {
            const retry = event.target.closest("[data-retry]");

            if (retry) {
                const action =
                    retryActions[retry.getAttribute("data-retry")];

                if (action) {
                    action();
                }

                return;
            }

            const queue = event.target.closest("[data-queue-filter]");

            if (queue) {
                applyQueueFilter(
                    queue.getAttribute("data-queue-filter")
                );
                return;
            }

            const row = event.target.closest("tr[data-complaint-href]");

            if (
                row &&
                !event.target.closest(
                    "a, button, input, select, textarea"
                )
            ) {
                window.location.href = row.getAttribute(
                    "data-complaint-href"
                );
                return;
            }

            const sidebarLink = event.target.closest(
                ".sidebar-link[data-shell-tab]"
            );

            if (
                sidebarLink &&
                event.button === 0 &&
                !event.metaKey &&
                !event.ctrlKey &&
                !event.shiftKey &&
                !event.altKey
            ) {
                event.preventDefault();
                activateTab(
                    sidebarLink.getAttribute("data-shell-tab"),
                    { push: true }
                );
            }
        });

        window.addEventListener("campusfix:languagechange", () => {
            updateScopeText();
            populateDepartmentOptions();

            if (state.stats) {
                renderStats();
            }

            if (Array.isArray(state.recent)) {
                renderRecent();
            }

            if (Array.isArray(state.complaints)) {
                renderComplaints();
                renderComplaintPagination();
            }

            if (Array.isArray(state.notices)) {
                renderNotices();
            }

            if (Array.isArray(state.users)) {
                renderUsers();
            }

            if (
                state.departmentsLoaded &&
                Array.isArray(state.departments)
            ) {
                renderDepartmentsConfig();
            }

            if (Array.isArray(state.configCategories)) {
                renderCategories();
            }

            if (Array.isArray(state.configSla)) {
                renderSla();
            }

            if (Array.isArray(state.auditLogs)) {
                renderAudit();
                renderAuditPagination();
            }

            if (elements.noticeDialog.open) {
                updateNoticeDialogLabels();
            }

            if (elements.categoryDialog.open) {
                elements.categoryDialogTitle.textContent =
                    state.editingCategoryId
                        ? t("admin.editCategory")
                        : t("admin.addCategory");
                elements.categorySubmitLabel.textContent =
                    state.editingCategoryId
                        ? t("common.save")
                        : t("admin.addCategory");
            }

            if (elements.departmentDialog.open) {
                elements.departmentDialogTitle.textContent =
                    state.editingDepartmentId
                        ? t("admin.editDepartment")
                        : t("admin.addDepartment");
            }
        });
    }

    async function init() {
        readUrlState();

        const user = await Shell.ready;

        if (!user) {
            return;
        }

        state.user = user;
        state.isAdmin = user.role === "admin";

        document.querySelectorAll("[data-admin-only]").forEach((node) => {
            node.hidden = !state.isAdmin;
        });

        if (!state.isAdmin) {
            state.filters.departmentId = "";
        }

        updateScopeText();
        applyFiltersToControls();
        applyUserFiltersToControls();
        bindEvents();
        activateTab(state.tab, { updateHistory: true });
    }

    init();
})();
