/* CampusFix shared client utilities: API, session, formatting, toasts, dialogs. */
(function () {
    "use strict";

    const API_URL = "/api";
    const I18N = window.CampusFixI18n;
    const ICONS = window.CampusFixIcons;

    let cachedUser = null;
    let cachedUserAt = 0;
    let installPrompt = null;
    let serviceWorkerRegistration = null;

    class ApiRequestError extends Error {
        constructor(message, status, code, details) {
            super(message);
            this.name = "ApiRequestError";
            this.status = status;
            this.code = code;
            this.details = details || null;
        }
    }

    function t(key, vars) {
        return I18N ? I18N.t(key, vars) : key;
    }

    function icon(name, extraClass) {
        return ICONS ? ICONS.icon(name, extraClass) : "";
    }

    function escapeHTML(value) {
        if (value === null || value === undefined) {
            return "";
        }

        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    async function request(path, options) {
        const settings = Object.assign({}, options || {});
        const headers = new Headers(settings.headers || {});

        if (
            settings.body !== undefined &&
            settings.body !== null &&
            !(settings.body instanceof FormData) &&
            typeof settings.body !== "string"
        ) {
            headers.set("Content-Type", "application/json");
            settings.body = JSON.stringify(settings.body);
        }

        if (settings.body instanceof FormData) {
            headers.delete("Content-Type");
        }

        settings.headers = headers;
        settings.credentials = "same-origin";

        let response;

        try {
            response = await fetch(API_URL + path, settings);
        } catch (error) {
            if (error && error.name === "AbortError") {
                throw error;
            }

            throw new ApiRequestError(
                t("common.networkError"),
                0,
                "network_error"
            );
        }

        const text = await response.text();
        let data = null;

        if (text) {
            try {
                data = JSON.parse(text);
            } catch (error) {
                data = null;
            }
        }

        if (!response.ok) {
            let message =
                (data && data.message) ||
                t("common.serverError");

            if (response.status === 429) {
                message = t("error.rate_limited");
            }

            const requestError = new ApiRequestError(
                message,
                response.status,
                data && data.code,
                data && data.details
            );

            requestError.errors =
                data && Array.isArray(data.errors) ? data.errors : [];

            throw requestError;
        }

        return data || {};
    }

    const api = {
        request,
        get: (path, options) =>
            request(path, Object.assign({}, options, { method: "GET" })),
        post: (path, body, options) =>
            request(
                path,
                Object.assign({}, options, { method: "POST", body })
            ),
        put: (path, body, options) =>
            request(
                path,
                Object.assign({}, options, { method: "PUT", body })
            ),
        patch: (path, body, options) =>
            request(
                path,
                Object.assign({}, options, { method: "PATCH", body })
            ),
        del: (path, options) =>
            request(path, Object.assign({}, options, { method: "DELETE" }))
    };

    async function getCurrentUser(options) {
        const force = Boolean(options && options.force);

        if (
            !force &&
            cachedUser &&
            Date.now() - cachedUserAt < 30000
        ) {
            return cachedUser;
        }

        try {
            const data = await request("/me");
            cachedUser = data.user || null;
            cachedUserAt = Date.now();

            return cachedUser;
        } catch (error) {
            if (error.status === 401) {
                cachedUser = null;
                cachedUserAt = Date.now();
                return null;
            }

            throw error;
        }
    }

    function homeFor(user) {
        if (!user) {
            return "login.html";
        }

        return user.role === "student"
            ? "dashboard.html"
            : "admin.html";
    }

    function loginUrl() {
        const next = window.location.pathname.split("/").pop();
        const search = window.location.search;
        const target = next && next !== "login.html" ? next + search : "";
        return "login.html" + (target ? "?next=" + encodeURIComponent(target) : "");
    }

    async function requireUser(options) {
        const settings = options || {};
        let user;

        try {
            user = await getCurrentUser({ force: true });
        } catch (error) {
            toast(t("common.networkError"), "error", 7000);
            window.location.replace(loginUrl());
            return null;
        }

        if (!user) {
            window.location.replace(loginUrl());
            return null;
        }

        if (settings.roles && !settings.roles.includes(user.role)) {
            window.location.replace(homeFor(user));
            return null;
        }

        return user;
    }

    async function logout(options) {
        const redirect = !options || options.redirect !== false;

        try {
            await request("/logout", { method: "POST" });
        } catch (error) {
            /* The cookie is cleared server-side when possible. */
        }

        cachedUser = null;
        cachedUserAt = 0;

        if (redirect) {
            window.location.replace("login.html");
        }
    }

    function safeNextPath() {
        const params = new URLSearchParams(window.location.search);
        const next = params.get("next") || "";

        if (
            !next ||
            next.includes("://") ||
            next.startsWith("//") ||
            next.includes("..") ||
            next.startsWith("\\")
        ) {
            return "";
        }

        return next;
    }

    function statusTone(status) {
        return {
            Pending: "pending",
            Assigned: "assigned",
            "In Progress": "progress",
            Resolved: "resolved",
            Reopened: "reopened",
            Rejected: "rejected"
        }[status] || "neutral";
    }

    function priorityTone(priority) {
        return {
            Low: "low",
            Medium: "medium",
            High: "high",
            Critical: "critical"
        }[priority] || "neutral";
    }

    function statusBadge(status) {
        return (
            '<span class="badge" data-tone="' +
            statusTone(status) +
            '"><span class="badge-dot"></span>' +
            escapeHTML(I18N ? I18N.statusLabel(status) : status) +
            "</span>"
        );
    }

    function priorityBadge(priority) {
        return (
            '<span class="badge" data-tone="' +
            priorityTone(priority) +
            '">' +
            escapeHTML(I18N ? I18N.priorityLabel(priority) : priority) +
            "</span>"
        );
    }

    function avatar(name, extraClass) {
        return (
            '<span class="avatar ' +
            escapeHTML(extraClass || "") +
            '" aria-hidden="true">' +
            escapeHTML(I18N ? I18N.initials(name) : "") +
            "</span>"
        );
    }

    function toastRegion() {
        let region = document.querySelector(".toast-region");

        if (!region) {
            region = document.createElement("div");
            region.className = "toast-region";
            region.setAttribute("role", "status");
            region.setAttribute("aria-live", "polite");
            document.body.appendChild(region);
        }

        return region;
    }

    function toast(message, tone, duration) {
        const region = toastRegion();
        const item = document.createElement("div");
        const type = tone || "success";
        const iconName =
            type === "error"
                ? "alert-circle"
                : type === "warning"
                  ? "alert-triangle"
                  : "check-circle";

        item.className = "toast is-" + type;
        item.innerHTML =
            icon(iconName) +
            '<div class="toast-copy">' +
            escapeHTML(message) +
            '</div><button type="button" class="toast-close" aria-label="' +
            escapeHTML(t("common.close")) +
            '">&times;</button>';

        const remove = () => {
            if (item.parentNode) {
                item.parentNode.removeChild(item);
            }
        };

        item.querySelector(".toast-close").addEventListener("click", remove);
        region.appendChild(item);

        window.setTimeout(remove, duration || (type === "error" ? 7000 : 4500));

        return item;
    }

    function confirmDialog(options) {
        const settings = options || {};

        return new Promise((resolve) => {
            const dialog = document.createElement("dialog");
            const tone = settings.tone === "primary" ? "primary" : "danger";

            dialog.className = "dialog-narrow";
            dialog.innerHTML =
                '<div class="dialog-form">' +
                '<div class="dialog-header"><div><h2>' +
                escapeHTML(settings.title || t("common.confirm")) +
                "</h2></div>" +
                '<button type="button" class="btn btn-icon" data-dialog-close aria-label="' +
                escapeHTML(t("common.close")) +
                '">' +
                icon("close") +
                "</button></div>" +
                '<div class="dialog-body"><p class="muted" style="margin:0;font-size:.86rem;line-height:1.65">' +
                escapeHTML(settings.message || "") +
                "</p></div>" +
                '<div class="dialog-footer">' +
                '<button type="button" class="btn btn-secondary" data-dialog-cancel>' +
                escapeHTML(settings.cancelLabel || t("common.cancel")) +
                "</button>" +
                '<button type="button" class="btn ' +
                (tone === "danger" ? "btn-danger" : "") +
                '" data-dialog-confirm>' +
                escapeHTML(settings.confirmLabel || t("common.confirm")) +
                "</button></div></div>";

            document.body.appendChild(dialog);

            const finish = (value) => {
                dialog.close();

                if (dialog.parentNode) {
                    dialog.parentNode.removeChild(dialog);
                }

                resolve(value);
            };

            dialog
                .querySelector("[data-dialog-close]")
                .addEventListener("click", () => finish(false));
            dialog
                .querySelector("[data-dialog-cancel]")
                .addEventListener("click", () => finish(false));
            dialog
                .querySelector("[data-dialog-confirm]")
                .addEventListener("click", () => finish(true));
            dialog.addEventListener("cancel", (event) => {
                event.preventDefault();
                finish(false);
            });

            dialog.showModal();
            dialog.querySelector("[data-dialog-confirm]").focus();
        });
    }

    function buttonLoading(button, label) {
        if (!button) {
            return () => {};
        }

        const original = button.innerHTML;
        const wasDisabled = button.disabled;

        button.disabled = true;
        button.setAttribute("aria-busy", "true");
        button.innerHTML =
            '<span class="spinner" aria-hidden="true"></span>' +
            escapeHTML(label || t("common.processing"));

        return () => {
            button.disabled = wasDisabled;
            button.removeAttribute("aria-busy");
            button.innerHTML = original;

            if (ICONS) {
                ICONS.mount(button);
            }
        };
    }

    function clearFieldErrors(container) {
        (container || document)
            .querySelectorAll(".field-error")
            .forEach((node) => {
                node.textContent = "";
            });

        (container || document)
            .querySelectorAll("[aria-invalid]")
            .forEach((node) => {
                node.removeAttribute("aria-invalid");
            });
    }

    function fieldError(input, message) {
        if (!input) {
            return;
        }

        const field = input.closest(".field");
        const target = field && field.querySelector(".field-error");

        input.setAttribute("aria-invalid", "true");

        if (target) {
            target.textContent = message;
        } else {
            toast(message, "error");
        }
    }

    function friendlyError(error, fallback) {
        if (error instanceof ApiRequestError) {
            if (error.status === 401 && error.code !== "invalid_credentials") {
                return t("common.sessionExpired");
            }

            if (error.code) {
                const key = "error." + error.code;
                const translated = t(key);

                if (translated !== key) {
                    return translated;
                }
            }

            if (error.status === 0) {
                return t("common.networkError");
            }

            if (error.status === 403) {
                return t("common.accessDenied");
            }

            if (error.status === 404) {
                return t("common.notFound");
            }

            return error.message || fallback || t("common.errorBody");
        }

        return fallback || t("common.errorBody");
    }

    async function copyText(value) {
        const text = String(value || "");

        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
                return true;
            }
        } catch (error) {
            /* Fall through to the legacy path. */
        }

        try {
            const input = document.createElement("textarea");
            input.value = text;
            input.setAttribute("readonly", "");
            input.style.position = "fixed";
            input.style.opacity = "0";
            document.body.appendChild(input);
            input.select();
            const copied = document.execCommand("copy");
            document.body.removeChild(input);
            return copied;
        } catch (error) {
            return false;
        }
    }

    function complaintUrl(id, hash) {
        return (
            "complaint.html?id=" +
            encodeURIComponent(id) +
            (hash ? "#" + hash : "")
        );
    }

    function currentComplaintId() {
        return new URLSearchParams(window.location.search).get("id");
    }

    function isStandalone() {
        return (
            window.matchMedia("(display-mode: standalone)").matches ||
            window.navigator.standalone === true
        );
    }

    function registerServiceWorker() {
        if (!("serviceWorker" in navigator)) {
            return;
        }

        if (
            window.location.protocol !== "https:" &&
            !["localhost", "127.0.0.1"].includes(window.location.hostname)
        ) {
            return;
        }

        window.addEventListener("load", () => {
            navigator.serviceWorker
                .register("sw.js")
                .then((registration) => {
                    serviceWorkerRegistration = registration;
                    window.dispatchEvent(
                        new CustomEvent("campusfix:sw-ready", {
                            detail: registration
                        })
                    );
                })
                .catch(() => {
                    /* Offline support is a progressive enhancement. */
                });
        });
    }

    function canInstall() {
        return Boolean(installPrompt);
    }

    async function promptInstall() {
        if (!installPrompt) {
            return false;
        }

        try {
            await installPrompt.prompt();
            const choice = await installPrompt.userChoice;
            installPrompt = null;
            window.dispatchEvent(new CustomEvent("campusfix:installability"));
            return choice.outcome === "accepted";
        } catch (error) {
            return false;
        }
    }

    window.addEventListener("beforeinstallprompt", (event) => {
        event.preventDefault();
        installPrompt = event;
        window.dispatchEvent(new CustomEvent("campusfix:installability"));
    });

    window.addEventListener("appinstalled", () => {
        installPrompt = null;
        window.dispatchEvent(new CustomEvent("campusfix:installability"));
        toast(t("profile.installed"), "success");
    });

    document.addEventListener("click", (event) => {
        const toggle = event.target.closest("[data-password-toggle]");

        if (!toggle) {
            return;
        }

        const wrapper = toggle.closest(".password-toggle");
        const input = wrapper && wrapper.querySelector("input");

        if (!input) {
            return;
        }

        const showing = input.type === "text";
        input.type = showing ? "password" : "text";
        toggle.setAttribute(
            "aria-label",
            t(showing ? "auth.showPassword" : "auth.hidePassword")
        );
        toggle.innerHTML = icon(showing ? "eye" : "eye-off");
        toggle.setAttribute("aria-pressed", showing ? "false" : "true");
    });

    document.addEventListener("DOMContentLoaded", () => {
        toastRegion();

        document.querySelectorAll("[data-password-toggle]").forEach((button) => {
            if (!button.innerHTML.trim()) {
                button.innerHTML = icon("eye");
            }
        });
    });

    registerServiceWorker();

    window.CampusFix = {
        ApiRequestError,
        api,
        request,
        getCurrentUser,
        requireUser,
        logout,
        homeFor,
        loginUrl,
        safeNextPath,
        cachedUser: () => cachedUser,
        escapeHTML,
        icon,
        avatar,
        statusTone,
        priorityTone,
        statusBadge,
        priorityBadge,
        toast,
        confirm: confirmDialog,
        buttonLoading,
        clearFieldErrors,
        fieldError,
        friendlyError,
        copyText,
        complaintUrl,
        currentComplaintId,
        isStandalone,
        canInstall,
        promptInstall,
        formatDate: (...args) => I18N.formatDate(...args),
        formatDateTime: (...args) => I18N.formatDateTime(...args),
        formatRelative: (...args) => I18N.formatRelative(...args),
        statusLabel: (...args) => I18N.statusLabel(...args),
        priorityLabel: (...args) => I18N.priorityLabel(...args),
        roleLabel: (...args) => I18N.roleLabel(...args),
        categoryLabel: (...args) => I18N.categoryLabel(...args),
        departmentLabel: (...args) => I18N.departmentLabel(...args)
    };
})();
