/* CampusFix application shell: role-aware navigation, search, notifications, profile. */
(function () {
    "use strict";

    const App = window.CampusFix;
    const I18N = window.CampusFixI18n;

    if (!App || !I18N) {
        return;
    }

    const body = document.body;
    const shell = document.querySelector(".app-shell");

    if (!shell) {
        return;
    }

    const state = {
        user: null,
        collegeName: "CampusFix",
        appName: "CampusFix",
        page: body.dataset.page || "dashboard",
        titleKey: body.dataset.titleKey || "",
        titleText: body.dataset.title || "",
        activeNav: body.dataset.activeNav || "",
        notifications: [],
        unreadCount: 0,
        notificationsLoaded: false,
        notificationsLoading: false,
        notificationsError: false,
        notificationsOpen: false,
        profileOpen: false
    };

    let sidebar = document.getElementById("appSidebar");
    let topbar = document.getElementById("appTopbar");
    let notificationButton = null;
    let notificationPopover = null;
    let notificationBody = null;
    let profileButton = null;
    let profilePopover = null;
    let breadcrumbLabel = null;
    let titleLabel = null;

    const icon = (name, className) => App.icon(name, className);
    const escape = App.escapeHTML;

    function t(key, vars) {
        return I18N.t(key, vars);
    }

    function readRoles() {
        const raw = body.dataset.roles || "";
        const roles = raw
            .split(",")
            .map((role) => role.trim())
            .filter(Boolean);

        return roles.length ? roles : null;
    }

    function pageTab() {
        return (
            new URLSearchParams(window.location.search).get("tab") ||
            "overview"
        );
    }

    function navItems() {
        const isOperations = state.user.role !== "student";

        if (!isOperations) {
            return [
                {
                    section: "nav.main",
                    key: "nav.dashboard",
                    href: "dashboard.html",
                    icon: "dashboard",
                    pages: ["dashboard"]
                },
                {
                    key: "nav.notices",
                    href: "notices.html",
                    icon: "megaphone",
                    pages: ["notices"]
                },
                {
                    key: "nav.services",
                    href: "services.html",
                    icon: "calendar",
                    pages: ["services"]
                },
                {
                    key: "nav.messages",
                    href: "chat.html",
                    icon: "message",
                    pages: ["chat"]
                },
                {
                    key: "nav.help",
                    href: "help.html",
                    icon: "help",
                    pages: ["help"]
                },
                {
                    section: "nav.account",
                    key: "nav.profile",
                    href: "profile.html",
                    icon: "user",
                    pages: ["profile"]
                }
            ];
        }

        const items = [
            {
                section: "nav.main",
                key: "nav.overview",
                href: "admin.html?tab=overview",
                icon: "dashboard",
                pages: ["admin"],
                tab: "overview"
            },
            {
                key: "nav.complaints",
                href: "admin.html?tab=complaints",
                icon: "tickets",
                pages: ["admin", "complaint"],
                tab: "complaints"
            },
            {
                key: "nav.notices",
                href: "admin.html?tab=notices",
                icon: "megaphone",
                pages: ["admin", "notices"],
                tab: "notices"
            },
            {
                key: "nav.operations",
                href: "admin.html?tab=operations",
                icon: "layers",
                pages: ["admin"],
                tab: "operations"
            },
            {
                key: "nav.services",
                href: "services.html",
                icon: "calendar",
                pages: ["services"]
            },
            {
                key: "nav.messages",
                href: "chat.html",
                icon: "message",
                pages: ["chat"]
            },
            {
                key: "nav.help",
                href: "help.html",
                icon: "help",
                pages: ["help"]
            }
        ];

        if (state.user.role === "admin") {
            items.push(
                {
                    section: "nav.management",
                    key: "nav.team",
                    href: "admin.html?tab=team",
                    icon: "users",
                    pages: ["admin"],
                    tab: "team"
                },
                {
                    key: "nav.configuration",
                    href: "admin.html?tab=config",
                    icon: "sliders",
                    pages: ["admin"],
                    tab: "config"
                },
                {
                    key: "nav.audit",
                    href: "admin.html?tab=audit",
                    icon: "activity",
                    pages: ["admin"],
                    tab: "audit"
                }
            );
        }

        items.push({
            section: "nav.account",
            key: "nav.profile",
            href: "profile.html",
            icon: "user",
            pages: ["profile"]
        });

        return items;
    }

    function isActive(item) {
        if (state.activeNav) {
            return item.key === state.activeNav;
        }

        if (STATE_TAB_PAGES.includes(state.page)) {
            return item.tab === pageTab();
        }

        return Boolean(item.pages && item.pages.includes(state.page));
    }

    const STATE_TAB_PAGES = ["admin"];

    function renderNavigation() {
        const items = navItems();
        let markup = "";
        let currentSection = "";

        items.forEach((item) => {
            if (item.section && item.section !== currentSection) {
                currentSection = item.section;
                markup +=
                    '<div class="sidebar-section" data-i18n="' +
                    item.section +
                    '"></div>';
            }

            const active = isActive(item);
            const operationsTabs =
                state.page === "admin" && item.pages.includes("admin");

            markup +=
                '<a class="sidebar-link' +
                (active ? " is-active" : "") +
                '" href="' +
                item.href +
                '"' +
                (active ? ' aria-current="page"' : "") +
                (operationsTabs
                    ? ' data-shell-tab="' + item.tab + '"'
                    : "") +
                ">" +
                icon(item.icon) +
                '<span data-i18n="' +
                item.key +
                '"></span></a>';
        });

        return (
            '<div class="sidebar-brand">' +
            '<a class="brand-home" href="' +
            escape(App.homeFor(state.user)) +
            '" aria-label="' +
            escape(t("common.appName")) +
            '">' +
            '<span class="brand-mark">' +
            icon("campus") +
            "</span>" +
            '<span class="sidebar-brand-text"><strong data-shell-college>' +
            escape(state.collegeName) +
            '</strong><span data-shell-brand-sub></span></span>' +
            "</a>" +
            '<button type="button" class="btn btn-ghost btn-icon sidebar-close" data-shell-close-menu aria-label="' +
            escape(t("nav.closeMenu")) +
            '">' +
            icon("close") +
            "</button>" +
            "</div>" +
            '<nav class="sidebar-nav" aria-label="' +
            escape(t("nav.main")) +
            '">' +
            markup +
            "</nav>" +
            '<div class="sidebar-footer"><strong>' +
            escape(I18N.roleLabel(state.user.role)) +
            '</strong><span data-shell-secure></span></div>'
        );
    }

    function brandSubtitle() {
        if (state.collegeName.toLowerCase() === state.appName.toLowerCase()) {
            return t("common.tagline");
        }

        return state.appName + " · " + t("common.tagline");
    }

    function renderSidebar() {
        sidebar.innerHTML = renderNavigation();
        sidebar.querySelector("[data-shell-brand-sub]").textContent =
            brandSubtitle();
        sidebar.querySelector("[data-shell-secure]").textContent = t(
            "nav.secureWorkspace"
        );
        I18N.apply(sidebar);
    }

    function pageTitle() {
        if (state.titleKey) {
            return t(state.titleKey);
        }

        if (state.titleText) {
            return state.titleText;
        }

        return t("nav.dashboard");
    }

    function renderTopbar() {
        topbar.innerHTML =
            '<button type="button" class="btn btn-ghost btn-icon mobile-menu-btn" data-shell-open-menu data-i18n-aria-label="nav.openMenu" aria-label="' +
            escape(t("nav.openMenu")) +
            '" aria-expanded="false" aria-controls="appSidebar">' +
            icon("menu") +
            "</button>" +
            '<div class="topbar-context">' +
            '<nav class="breadcrumbs" aria-label="Breadcrumb">' +
            '<a href="' +
            escape(App.homeFor(state.user)) +
            '" data-shell-breadcrumb-home data-i18n="nav.home">' +
            escape(t("nav.home")) +
            '</a><span class="sep" aria-hidden="true">/</span>' +
            "<strong data-shell-breadcrumb-current>" +
            escape(pageTitle()) +
            "</strong></nav>" +
            '<div class="topbar-page-title" data-shell-page-title>' +
            escape(pageTitle()) +
            "</div>" +
            "</div>" +
            '<form class="global-search" role="search" data-shell-search>' +
            icon("search") +
            '<input type="search" name="search" autocomplete="off" data-i18n-placeholder="nav.searchPlaceholder" data-i18n-aria-label="nav.searchPlaceholder">' +
            "</form>" +
            '<div class="topbar-actions">' +
            '<button type="button" class="lang-toggle" data-shell-language data-i18n-aria-label="nav.toggleLanguage" aria-label="' +
            escape(t("nav.toggleLanguage")) +
            '">' +
            icon("globe") +
            "<span>" +
            (I18N.currentLanguage() === "hi" ? "हिं" : "EN") +
            "</span></button>" +
            '<div class="notification-anchor">' +
            '<button type="button" class="icon-button" data-shell-notifications aria-label="' +
            escape(t("nav.notifications")) +
            '" aria-expanded="false" aria-haspopup="dialog" aria-controls="notificationPopover">' +
            icon("bell") +
            '<span class="notification-dot" data-shell-unread hidden></span>' +
            "</button>" +
            '<div class="popover" id="notificationPopover" role="dialog" aria-modal="false" aria-hidden="true" inert data-shell-notification-popover data-i18n-aria-label="nav.notifications" aria-label="' +
            escape(t("nav.notifications")) +
            '">' +
            '<div class="popover-header"><h3 data-i18n="nav.notifications">' +
            escape(t("nav.notifications")) +
            '</h3><button type="button" class="btn btn-ghost btn-sm" data-shell-read-all data-i18n="nav.markAllRead">' +
            escape(t("nav.markAllRead")) +
            "</button></div>" +
            '<div class="popover-body" data-shell-notification-body></div>' +
            '<div class="popover-footer"><a class="text-sm" href="notices.html" data-i18n="nav.notices">' +
            escape(t("nav.notices")) +
            "</a></div></div></div>" +
            '<div class="notification-anchor">' +
            '<button type="button" class="profile-trigger" data-shell-profile data-i18n-aria-label="nav.profileMenu" aria-label="' +
            escape(t("nav.profileMenu")) +
            '" aria-expanded="false" aria-haspopup="menu" aria-controls="profilePopover">' +
            App.avatar(state.user.name) +
            '<span class="profile-trigger-text"><strong>' +
            escape(state.user.name) +
            "</strong><span>" +
            escape(I18N.roleLabel(state.user.role)) +
            "</span></span>" +
            icon("chevron-down") +
            "</button>" +
            '<div class="popover profile-menu" id="profilePopover" role="menu" aria-hidden="true" inert data-shell-profile-popover>' +
            '<div class="profile-menu-head">' +
            App.avatar(state.user.name) +
            '<div class="profile-menu-head-text"><strong>' +
            escape(state.user.name) +
            "</strong><span>" +
            escape(state.user.email || I18N.roleLabel(state.user.role)) +
            "</span></div></div>" +
            '<a class="menu-link" role="menuitem" href="profile.html">' +
            icon("user") +
            '<span data-i18n="nav.profile"></span></a>' +
            '<a class="menu-link" role="menuitem" href="help.html">' +
            icon("help") +
            '<span data-i18n="nav.help"></span></a>' +
            '<button type="button" class="menu-link" role="menuitem" data-shell-install hidden>' +
            icon("download") +
            '<span data-i18n="common.install"></span></button>' +
            '<hr class="menu-divider">' +
            '<button type="button" class="menu-link danger" role="menuitem" data-shell-logout>' +
            icon("logout") +
            '<span data-i18n="nav.signOut"></span></button>' +
            "</div></div></div>";

        notificationButton = topbar.querySelector("[data-shell-notifications]");
        notificationPopover = topbar.querySelector(
            "[data-shell-notification-popover]"
        );
        notificationBody = topbar.querySelector(
            "[data-shell-notification-body]"
        );
        profileButton = topbar.querySelector("[data-shell-profile]");
        profilePopover = topbar.querySelector("[data-shell-profile-popover]");
        breadcrumbLabel = topbar.querySelector(
            "[data-shell-breadcrumb-current]"
        );
        titleLabel = topbar.querySelector("[data-shell-page-title]");

        I18N.apply(topbar);
        renderNotifications();
        updateBell();

        const installButton = topbar.querySelector("[data-shell-install]");
        installButton.hidden = !App.canInstall();
    }

    function renderFooter() {
        const frame = document.querySelector(".app-frame");

        if (!frame || frame.querySelector(".app-footer")) {
            return;
        }

        const footer = document.createElement("footer");
        footer.className = "app-footer";
        footer.innerHTML =
            escape(state.collegeName) +
            " · " +
            '<a href="help.html">' +
            escape(t("nav.help")) +
            "</a> · " +
            escape(t("landing.footerCopyright", {
                year: new Date().getFullYear()
            }));
        frame.appendChild(footer);
    }

    function updatePageTitle() {
        const title = pageTitle();

        document.title =
            title +
            " · " +
            (state.collegeName === state.appName
                ? state.appName
                : state.collegeName);

        if (breadcrumbLabel) {
            breadcrumbLabel.textContent = title;
        }

        if (titleLabel) {
            titleLabel.textContent = title;
        }
    }

    function updateBell() {
        if (!notificationButton) {
            return;
        }

        const dot = notificationButton.querySelector("[data-shell-unread]");

        if (state.unreadCount > 0) {
            dot.hidden = false;
            dot.textContent =
                state.unreadCount > 9 ? "9+" : String(state.unreadCount);
            notificationButton.setAttribute(
                "aria-label",
                t("nav.unreadNotifications", { count: state.unreadCount })
            );
        } else {
            dot.hidden = true;
            dot.textContent = "";
            notificationButton.setAttribute("aria-label", t("nav.notifications"));
        }
    }

    function notificationIcon(type) {
        if (type === "complaint_created") {
            return "tickets";
        }

        if (type === "complaint_assigned") {
            return "user-plus";
        }

        if (type === "status_changed") {
            return "trending-up";
        }

        if (type === "comment_added") {
            return "message";
        }

        if (type === "complaint_reopened") {
            return "rotate-ccw";
        }

        if (type === "feedback_submitted") {
            return "star";
        }

        if (
            type === "booking_requested" ||
            type === "booking_reviewed" ||
            type === "booking_cancelled"
        ) {
            return "calendar";
        }

        if (type === "maintenance_completed") {
            return "wrench";
        }

        return "bell";
    }

    function renderNotifications() {
        if (!notificationBody) {
            return;
        }

        if (state.notificationsLoading) {
            notificationBody.innerHTML =
                '<div class="skeleton-row"><span class="skeleton skeleton-line" style="width:78%"></span></div>' +
                '<div class="skeleton-row"><span class="skeleton skeleton-line" style="width:64%"></span></div>' +
                '<div class="skeleton-row"><span class="skeleton skeleton-line" style="width:71%"></span></div>';
            return;
        }

        if (state.notificationsError) {
            notificationBody.innerHTML =
                '<div class="empty-state" style="padding:28px 18px">' +
                icon("alert-circle") +
                "<p>" +
                escape(t("common.loadingError")) +
                "</p></div>";
            return;
        }

        if (state.notifications.length === 0) {
            notificationBody.innerHTML =
                '<div class="empty-state" style="padding:30px 18px;border:0;box-shadow:none">' +
                '<span class="empty-icon">' +
                icon("check-circle") +
                "</span><p>" +
                escape(t("nav.noNotifications")) +
                "</p></div>";
            return;
        }

        notificationBody.innerHTML = state.notifications
            .map((item) => {
                const unread = !item.readAt;
                const target = item.complaintId
                    ? App.complaintUrl(item.complaintId)
                    : "";

                return (
                    '<button type="button" class="notification-item' +
                    (unread ? " is-unread" : "") +
                    '" data-notification-id="' +
                    escape(item.id) +
                    '"' +
                    (item.complaintId
                        ? ' data-complaint-id="' + escape(item.complaintId) + '"'
                        : "") +
                    (target ? ' data-target="' + escape(target) + '"' : "") +
                    ">" +
                    '<span class="notification-glyph">' +
                    icon(notificationIcon(item.type)) +
                    "</span>" +
                    '<span class="notification-copy"><strong>' +
                    escape(item.title) +
                    "</strong><p>" +
                    escape(item.message) +
                    "</p><time datetime=\"" +
                    escape(item.createdAt || "") +
                    "\">" +
                    escape(I18N.formatRelative(item.createdAt)) +
                    "</time></span></button>"
                );
            })
            .join("");

        const readAll = topbar.querySelector("[data-shell-read-all]");
        readAll.hidden = state.unreadCount === 0;
    }

    async function loadNotifications(options) {
        if (state.notificationsLoading) {
            return;
        }

        const force = Boolean(options && options.force);

        if (state.notificationsLoaded && !force) {
            return;
        }

        state.notificationsLoading = true;
        state.notificationsError = false;
        renderNotifications();

        try {
            const data = await App.api.get("/notifications?pageSize=8");
            state.notifications = data.notifications || [];
            state.unreadCount = Number(data.unreadCount || 0);
            state.notificationsLoaded = true;
            state.notificationsError = false;
        } catch (error) {
            state.notificationsError = true;
        } finally {
            state.notificationsLoading = false;
        }

        renderNotifications();
        updateBell();
    }

    function setPopoverVisibility(popover, open) {
        if (!popover) {
            return;
        }

        popover.classList.toggle("is-open", open);
        popover.setAttribute("aria-hidden", String(!open));

        if (open) {
            popover.removeAttribute("inert");
        } else {
            popover.setAttribute("inert", "");
        }
    }

    function closeNotifications() {
        if (!notificationPopover) {
            return;
        }

        state.notificationsOpen = false;
        setPopoverVisibility(notificationPopover, false);
        notificationButton.setAttribute("aria-expanded", "false");
    }

    function toggleNotifications() {
        if (!notificationPopover) {
            return;
        }

        const open = !state.notificationsOpen;
        closeProfile();
        state.notificationsOpen = open;
        setPopoverVisibility(notificationPopover, open);
        notificationButton.setAttribute("aria-expanded", String(open));

        if (open) {
            loadNotifications({ force: true });
        }
    }

    function closeProfile() {
        if (!profilePopover) {
            return;
        }

        state.profileOpen = false;
        setPopoverVisibility(profilePopover, false);
        profileButton.setAttribute("aria-expanded", "false");
    }

    function toggleProfile() {
        if (!profilePopover) {
            return;
        }

        const open = !state.profileOpen;
        closeNotifications();
        state.profileOpen = open;
        setPopoverVisibility(profilePopover, open);
        profileButton.setAttribute("aria-expanded", String(open));

        if (open) {
            const installButton = profilePopover.querySelector(
                "[data-shell-install]"
            );
            installButton.hidden = !App.canInstall();
        }
    }

    function setSidebarOpen(open) {
        shell.classList.toggle("is-sidebar-open", open);
        document.body.classList.toggle("has-open-nav", open);

        const toggle = topbar.querySelector("[data-shell-open-menu]");

        if (toggle) {
            toggle.setAttribute("aria-expanded", String(open));
        }
    }

    function isSidebarOpen() {
        return shell.classList.contains("is-sidebar-open");
    }

    function closeOverlays() {
        closeNotifications();
        closeProfile();
        setSidebarOpen(false);
    }

    async function handleNotificationClick(event) {
        const item = event.target.closest("[data-notification-id]");

        if (!item) {
            return;
        }

        const id = item.getAttribute("data-notification-id");
        const target = item.getAttribute("data-target") || "";
        const record = state.notifications.find((entry) => entry.id === id);

        if (record && !record.readAt) {
            try {
                await App.api.post("/notifications/" + encodeURIComponent(id) + "/read");
                record.readAt = new Date().toISOString();
                state.unreadCount = Math.max(0, state.unreadCount - 1);
                updateBell();
                renderNotifications();
            } catch (error) {
                App.toast(App.friendlyError(error), "error");
            }
        }

        if (target) {
            window.location.href = target;
        }
    }

    async function markAllRead() {
        try {
            await App.api.post("/notifications/read-all");
            state.notifications = state.notifications.map((item) =>
                Object.assign({}, item, {
                    readAt: item.readAt || new Date().toISOString()
                })
            );
            state.unreadCount = 0;
            updateBell();
            renderNotifications();
        } catch (error) {
            App.toast(App.friendlyError(error), "error");
        }
    }

    function bindEvents() {
        topbar.addEventListener("click", (event) => {
            if (event.target.closest("[data-shell-notifications]")) {
                toggleNotifications();
                return;
            }

            if (event.target.closest("[data-shell-profile]")) {
                toggleProfile();
                return;
            }

            if (event.target.closest("[data-shell-read-all]")) {
                markAllRead();
                return;
            }

            if (event.target.closest("[data-shell-logout]")) {
                closeOverlays();
                App.logout();
                return;
            }

            if (event.target.closest("[data-shell-install]")) {
                App.promptInstall().then((installed) => {
                    if (!installed) {
                        profilePopover.querySelector(
                            "[data-shell-install]"
                        ).hidden = true;
                    }
                });
                return;
            }

            if (event.target.closest("[data-shell-language]")) {
                I18N.toggleLanguage();
                return;
            }
        });

        notificationBody.addEventListener(
            "click",
            handleNotificationClick
        );

        const search = topbar.querySelector("[data-shell-search]");
        search.addEventListener("submit", (event) => {
            event.preventDefault();
            const input = search.querySelector("input");
            const value = String(input.value || "").trim();

            if (!value) {
                input.focus();
                return;
            }

            if (state.user.role === "student") {
                window.location.href =
                    "dashboard.html?search=" + encodeURIComponent(value);
            } else {
                window.location.href =
                    "admin.html?tab=complaints&search=" +
                    encodeURIComponent(value);
            }
        });

        document.addEventListener("click", (event) => {
            if (event.target.closest("[data-shell-open-menu]")) {
                setSidebarOpen(true);
                return;
            }

            if (
                event.target.closest("[data-shell-close-menu]") ||
                event.target.closest("[data-shell-scrim]")
            ) {
                setSidebarOpen(false);
                return;
            }

            if (
                state.notificationsOpen &&
                !event.target.closest(".notification-anchor")
            ) {
                closeNotifications();
            }

            if (
                state.profileOpen &&
                !event.target.closest(".notification-anchor")
            ) {
                closeProfile();
            }

            if (isSidebarOpen() && event.target.closest(".sidebar-link")) {
                setSidebarOpen(false);
            }
        });

        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                const active = document.activeElement;
                const focusWasInNotifications = Boolean(
                    notificationPopover && notificationPopover.contains(active)
                );
                const focusWasInProfile = Boolean(
                    profilePopover && profilePopover.contains(active)
                );

                closeOverlays();

                if (focusWasInNotifications) {
                    notificationButton.focus();
                } else if (focusWasInProfile) {
                    profileButton.focus();
                }

                return;
            }

            const tag = (event.target.tagName || "").toLowerCase();
            const typing =
                tag === "input" ||
                tag === "textarea" ||
                tag === "select" ||
                event.target.isContentEditable;

            if (event.key === "/" && !typing && !event.metaKey && !event.ctrlKey) {
                const input = topbar.querySelector(".global-search input");

                if (input && input.offsetParent !== null) {
                    event.preventDefault();
                    input.focus();
                }
            }

            if (event.key === "?" && !typing && !event.metaKey && !event.ctrlKey) {
                event.preventDefault();

                if (state.page === "help") {
                    const helpSearch = document.getElementById("helpSearch");

                    if (helpSearch) {
                        helpSearch.focus();
                        return;
                    }
                }

                window.location.href = "help.html";
            }
        });

        window.addEventListener("campusfix:installability", () => {
            const installButton = profilePopover.querySelector(
                "[data-shell-install]"
            );

            if (installButton) {
                installButton.hidden = !App.canInstall();
            }
        });

        window.addEventListener("campusfix:languagechange", () => {
            renderSidebar();
            updatePageTitle();
            I18N.apply(topbar);
            renderNotifications();
            updateBell();

            const lang = topbar.querySelector("[data-shell-language] span");

            if (lang) {
                lang.textContent = I18N.currentLanguage() === "hi" ? "हिं" : "EN";
            }

            const triggerText = profileButton.querySelector(
                ".profile-trigger-text span"
            );

            if (triggerText) {
                triggerText.textContent = I18N.roleLabel(state.user.role);
            }
        });

        window.addEventListener("resize", () => {
            if (window.innerWidth > 1024) {
                setSidebarOpen(false);
            }
        });
    }

    async function loadPublicConfig() {
        try {
            const data = await App.api.get("/public-config");

            if (data && data.collegeName) {
                state.collegeName = String(data.collegeName);
            }

            if (data && data.appName) {
                state.appName = String(data.appName);
            }
        } catch (error) {
            /* Defaults keep the shell usable when configuration is unavailable. */
        }
    }

    function injectScrim() {
        if (shell.querySelector("[data-shell-scrim]")) {
            return;
        }

        const scrim = document.createElement("div");
        scrim.className = "sidebar-scrim";
        scrim.setAttribute("data-shell-scrim", "");
        scrim.setAttribute("aria-hidden", "true");
        shell.appendChild(scrim);
    }

    function injectSkipLink() {
        if (document.querySelector(".skip-link")) {
            return;
        }

        const link = document.createElement("a");
        link.className = "skip-link";
        link.href = "#main";
        link.textContent = t("nav.skip");
        body.insertBefore(link, body.firstChild);
    }

    const ready = (async () => {
        if (!sidebar || !topbar) {
            return null;
        }

        injectSkipLink();
        injectScrim();

        await loadPublicConfig();

        let user;

        try {
            user = await App.requireUser({ roles: readRoles() });
        } catch (error) {
            return null;
        }

        if (!user) {
            return null;
        }

        state.user = user;
        renderSidebar();
        renderTopbar();
        renderFooter();
        bindEvents();
        updatePageTitle();
        loadNotifications();

        window.dispatchEvent(
            new CustomEvent("campusfix:shell-ready", {
                detail: { user, collegeName: state.collegeName }
            })
        );

        return user;
    })();

    window.CampusFixShell = {
        ready,
        get user() {
            return state.user;
        },
        get collegeName() {
            return state.collegeName;
        },
        setPageTitle(value, options) {
            if (options && options.literal) {
                state.titleKey = "";
                state.titleText = String(value || "");
            } else {
                state.titleKey = String(value || "");
                state.titleText = "";
            }

            updatePageTitle();
        },
        setActiveNav(key) {
            state.activeNav = String(key || "");
            renderSidebar();
            updatePageTitle();
        },
        refreshNotifications: () =>
            loadNotifications({ force: true }),
        updateUser(patch) {
            if (!state.user || !patch) {
                return;
            }

            state.user = Object.assign({}, state.user, patch);

            if (!topbar) {
                return;
            }

            topbar
                .querySelectorAll(
                    ".profile-trigger .avatar, .profile-menu-head .avatar"
                )
                .forEach((node) => {
                    node.textContent = I18N.initials(state.user.name);
                });

            const triggerName = topbar.querySelector(
                ".profile-trigger-text strong"
            );
            const menuName = topbar.querySelector(
                ".profile-menu-head-text strong"
            );
            const menuEmail = topbar.querySelector(
                ".profile-menu-head-text span"
            );

            if (triggerName) {
                triggerName.textContent = state.user.name;
            }

            if (menuName) {
                menuName.textContent = state.user.name;
            }

            if (menuEmail) {
                menuEmail.textContent =
                    state.user.email ||
                    I18N.roleLabel(state.user.role);
            }
        },
        closeOverlays
    };
})();
