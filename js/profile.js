/* CampusFix profile: account details, password, accessibility and install preferences. */
(function () {
    "use strict";

    const App = window.CampusFix;
    const I18N = window.CampusFixI18n;

    if (!App || !I18N || !window.CampusFixShell) {
        return;
    }

    const elements = {
        card: document.getElementById("profileCard"),
        avatar: document.getElementById("profileAvatar"),
        name: document.getElementById("profileNameHeading"),
        email: document.getElementById("profileEmail"),
        role: document.getElementById("profileRole"),
        department: document.getElementById("profileDepartment"),
        joined: document.getElementById("profileJoined"),
        loadError: document.getElementById("profileLoadError"),
        form: document.getElementById("profileForm"),
        nameInput: document.getElementById("profileName"),
        emailInput: document.getElementById("profileEmailInput"),
        save: document.getElementById("profileSave"),
        passwordForm: document.getElementById("passwordForm"),
        currentPassword: document.getElementById("currentPassword"),
        newPassword: document.getElementById("newPassword"),
        confirmPassword: document.getElementById("confirmPassword"),
        passwordSave: document.getElementById("passwordSave"),
        languageSegmented: document.getElementById("languageSegmented"),
        motion: document.getElementById("prefMotion"),
        largeText: document.getElementById("prefLargeText"),
        installStatus: document.getElementById("installStatus"),
        installButton: document.getElementById("installButton")
    };

    const state = {
        user: null,
        profile: null,
        nameDirty: false,
        loadError: null
    };

    const escape = App.escapeHTML;
    const icon = (name) => App.icon(name);
    const t = (key, vars) => I18N.t(key, vars);

    function roleTone(role) {
        return (
            {
                student: "neutral",
                staff: "assigned",
                department_manager: "progress",
                admin: "brand"
            }[role] || "neutral"
        );
    }

    function profileName() {
        return (
            (state.profile && state.profile.name) ||
            (state.user && state.user.name) ||
            ""
        );
    }

    function profileEmail() {
        return (
            (state.profile && state.profile.email) ||
            (state.user && state.user.email) ||
            ""
        );
    }

    function profileRole() {
        return (
            (state.profile && state.profile.role) ||
            (state.user && state.user.role) ||
            "student"
        );
    }

    function departmentName() {
        if (state.profile && state.profile.departmentName) {
            return state.profile.departmentName;
        }

        if (state.user && state.user.department) {
            return state.user.department.name;
        }

        return t("admin.noDepartment");
    }

    function renderSummary() {
        const name = profileName();

        if (elements.avatar) {
            elements.avatar.textContent = I18N.initials(name);
        }

        if (elements.name) {
            elements.name.textContent = name || "—";
        }

        if (elements.email) {
            elements.email.textContent = profileEmail() || "—";
        }

        if (elements.role) {
            elements.role.textContent = I18N.roleLabel(profileRole());
            elements.role.dataset.tone = roleTone(profileRole());
        }

        if (elements.department) {
            elements.department.textContent = departmentName() || "—";
        }

        if (elements.joined) {
            elements.joined.textContent =
                state.profile && state.profile.createdAt
                    ? I18N.formatDate(state.profile.createdAt)
                    : "—";
        }

        if (elements.emailInput) {
            elements.emailInput.value = profileEmail();
        }

        if (elements.nameInput && !state.nameDirty) {
            elements.nameInput.value = name;
        }
    }

    function renderLanguageChoice() {
        if (!elements.languageSegmented) {
            return;
        }

        elements.languageSegmented
            .querySelectorAll("[data-language]")
            .forEach((button) => {
                const active =
                    button.getAttribute("data-language") ===
                    I18N.currentLanguage();

                button.classList.toggle("is-active", active);
                button.setAttribute(
                    "aria-pressed",
                    active ? "true" : "false"
                );
            });
    }

    function renderPreferences() {
        const preferences = I18N.getPreferences();

        if (elements.motion) {
            elements.motion.checked = preferences.motion;
        }

        if (elements.largeText) {
            elements.largeText.checked = preferences.largeText;
        }

        renderLanguageChoice();
    }

    function updateInstallState() {
        if (!elements.installButton || !elements.installStatus) {
            return;
        }

        if (App.isStandalone()) {
            elements.installButton.hidden = true;
            elements.installStatus.textContent = t("profile.installed");
            return;
        }

        if (App.canInstall()) {
            elements.installButton.hidden = false;
            elements.installStatus.textContent = "";
            return;
        }

        elements.installButton.hidden = true;
        elements.installStatus.textContent = t("profile.installUnavailable");
    }

    function showLoadError(message) {
        if (!elements.loadError) {
            return;
        }

        elements.loadError.hidden = false;
        elements.loadError.innerHTML =
            '<span aria-hidden="true">' +
            icon("alert-circle") +
            "</span>" +
            "<div><strong>" +
            escape(t("common.errorTitle")) +
            "</strong><p>" +
            escape(message) +
            '</p><button type="button" class="btn btn-secondary btn-sm" data-retry-profile style="margin-top:9px">' +
            escape(t("common.retry")) +
            "</button></div>";
    }

    function clearLoadError() {
        if (!elements.loadError) {
            return;
        }

        elements.loadError.hidden = true;
        elements.loadError.innerHTML = "";
    }

    async function loadProfile() {
        clearLoadError();

        if (elements.card) {
            elements.card.setAttribute("aria-busy", "true");
        }

        try {
            const data = await App.api.get("/profile");
            state.profile = data.profile || null;
            renderSummary();
        } catch (error) {
            state.loadError = App.friendlyError(
                error,
                t("common.loadingError")
            );
            showLoadError(state.loadError);
        } finally {
            if (elements.card) {
                elements.card.removeAttribute("aria-busy");
            }
        }
    }

    function applyServerErrors(error) {
        if (!error || !Array.isArray(error.errors) || !error.errors.length) {
            return false;
        }

        const fields = {
            name: elements.nameInput,
            currentPassword: elements.currentPassword,
            newPassword: elements.newPassword
        };
        let first = null;

        error.errors.forEach((item) => {
            const input = fields[item.path];

            if (!input) {
                return;
            }

            App.fieldError(input, item.message);

            if (!first) {
                first = input;
            }
        });

        if (first) {
            first.focus();
            return true;
        }

        return false;
    }

    async function saveProfile(event) {
        event.preventDefault();

        App.clearFieldErrors(elements.form);

        const name = String(elements.nameInput.value || "").trim();

        if (!name) {
            App.fieldError(elements.nameInput, t("auth.nameRequired"));
            elements.nameInput.focus();
            return;
        }

        if (name.length > 120) {
            App.fieldError(
                elements.nameInput,
                t("auth.nameTooLong")
            );
            elements.nameInput.focus();
            return;
        }

        const restore = App.buttonLoading(
            elements.save,
            t("profile.saving")
        );

        try {
            const data = await App.api.patch("/profile", { name });
            state.profile = data.profile || Object.assign({}, state.profile, {
                name
            });
            state.nameDirty = false;
            renderSummary();

            if (window.CampusFixShell.updateUser) {
                window.CampusFixShell.updateUser({ name });
            }

            App.toast(t("profile.saved"), "success");
        } catch (error) {
            if (!applyServerErrors(error)) {
                App.fieldError(
                    elements.nameInput,
                    App.friendlyError(error, t("profile.savingFailed"))
                );
            }
        } finally {
            restore();
        }
    }

    function resetPasswordVisibility() {
        elements.passwordForm
            .querySelectorAll(".password-toggle")
            .forEach((wrapper) => {
                const input = wrapper.querySelector("input");
                const button = wrapper.querySelector(
                    "[data-password-toggle]"
                );

                if (input) {
                    input.type = "password";
                }

                if (button) {
                    button.innerHTML = icon("eye");
                    button.setAttribute(
                        "aria-label",
                        t("auth.showPassword")
                    );
                    button.setAttribute("aria-pressed", "false");
                }
            });
    }

    async function savePassword(event) {
        event.preventDefault();

        App.clearFieldErrors(elements.passwordForm);

        const currentPassword = elements.currentPassword.value;
        const newPassword = elements.newPassword.value;
        const confirmPassword = elements.confirmPassword.value;

        if (!currentPassword) {
            App.fieldError(
                elements.currentPassword,
                t("auth.passwordRequired")
            );
            elements.currentPassword.focus();
            return;
        }

        if (!newPassword) {
            App.fieldError(
                elements.newPassword,
                t("auth.passwordRequired")
            );
            elements.newPassword.focus();
            return;
        }

        if (newPassword.length < 6) {
            App.fieldError(
                elements.newPassword,
                t("auth.passwordTooShort")
            );
            elements.newPassword.focus();
            return;
        }

        if (!confirmPassword) {
            App.fieldError(
                elements.confirmPassword,
                t("profile.confirmRequired")
            );
            elements.confirmPassword.focus();
            return;
        }

        if (newPassword !== confirmPassword) {
            App.fieldError(
                elements.confirmPassword,
                t("profile.passwordMismatch")
            );
            elements.confirmPassword.focus();
            return;
        }

        if (newPassword === currentPassword) {
            App.fieldError(
                elements.newPassword,
                t("error.password_reused")
            );
            elements.newPassword.focus();
            return;
        }

        const restore = App.buttonLoading(
            elements.passwordSave,
            t("profile.updating")
        );

        try {
            await App.api.put("/profile/password", {
                currentPassword,
                newPassword
            });

            elements.passwordForm.reset();
            resetPasswordVisibility();
            App.toast(t("profile.passwordUpdated"), "success");
        } catch (error) {
            if (!applyServerErrors(error)) {
                App.fieldError(
                    elements.currentPassword,
                    App.friendlyError(
                        error,
                        t("common.errorBody")
                    )
                );
            }
        } finally {
            restore();
        }
    }

    async function installApp() {
        if (!elements.installButton) {
            return;
        }

        elements.installButton.disabled = true;

        try {
            await App.promptInstall();
        } finally {
            elements.installButton.disabled = false;
            updateInstallState();
        }
    }

    function bindEvents() {
        if (elements.nameInput) {
            elements.nameInput.addEventListener("input", () => {
                state.nameDirty = true;
            });
        }

        if (elements.form) {
            elements.form.addEventListener("submit", saveProfile);
        }

        if (elements.passwordForm) {
            elements.passwordForm.addEventListener("submit", savePassword);
        }

        if (elements.languageSegmented) {
            elements.languageSegmented.addEventListener("click", (event) => {
                const button = event.target.closest("[data-language]");

                if (!button) {
                    return;
                }

                I18N.setLanguage(button.getAttribute("data-language"));
            });
        }

        if (elements.motion) {
            elements.motion.addEventListener("change", () => {
                I18N.setPreference("motion", elements.motion.checked);
            });
        }

        if (elements.largeText) {
            elements.largeText.addEventListener("change", () => {
                I18N.setPreference(
                    "largeText",
                    elements.largeText.checked
                );
            });
        }

        if (elements.installButton) {
            elements.installButton.addEventListener("click", installApp);
        }

        if (elements.loadError) {
            elements.loadError.addEventListener("click", (event) => {
                if (event.target.closest("[data-retry-profile]")) {
                    loadProfile();
                }
            });
        }

        window.addEventListener("campusfix:installability", () => {
            updateInstallState();
        });

        window.addEventListener("campusfix:languagechange", () => {
            renderSummary();
            renderLanguageChoice();
            updateInstallState();

            if (state.loadError && elements.loadError && !elements.loadError.hidden) {
                showLoadError(state.loadError);
            }
        });
    }

    async function init() {
        const user = await window.CampusFixShell.ready;

        if (!user) {
            return;
        }

        state.user = user;
        renderSummary();
        renderPreferences();
        updateInstallState();
        bindEvents();

        await loadProfile();
    }

    init();
})();
