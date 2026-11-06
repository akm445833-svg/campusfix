/* CampusFix student account registration. */
(function () {
    "use strict";

    const App = window.CampusFix;
    const I18N = window.CampusFixI18n;

    if (!App || !I18N) {
        return;
    }

    const form = document.getElementById("registerForm");
    const nameInput = document.getElementById("registerName");
    const emailInput = document.getElementById("registerEmail");
    const passwordInput = document.getElementById("registerPassword");
    const confirmInput = document.getElementById("registerConfirm");
    const submitButton = document.getElementById("registerSubmit");
    const errorBox = document.getElementById("registerError");
    const errorText = document.getElementById("registerErrorText");
    const languageButton = document.getElementById("authLanguage");
    const languageLabel = document.getElementById("authLanguageLabel");

    function showError(message) {
        errorText.textContent = message;
        errorBox.classList.add("is-visible");
    }

    function hideError() {
        errorText.textContent = "";
        errorBox.classList.remove("is-visible");
    }

    function setLanguageLabel() {
        if (languageLabel) {
            languageLabel.textContent =
                I18N.currentLanguage() === "hi" ? "हिं" : "EN";
        }
    }

    function validEmail(value) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    }

    function clearInvalid() {
        App.clearFieldErrors(form);
        hideError();
    }

    function showServerFieldErrors(error) {
        let mapped = 0;

        (error.errors || []).forEach((issue) => {
            const input = form.querySelector(
                '[name="' + String(issue.path || "").split(".")[0] + '"]'
            );

            if (input) {
                App.fieldError(input, issue.message || I18N.t("common.requiredField"));
                mapped += 1;
            }
        });

        return mapped > 0;
    }

    async function loadIdentity() {
        try {
            const config = await App.api.get("/public-config");
            const name = String(config.collegeName || "CampusFix");

            document.querySelectorAll("[data-public-college]").forEach((node) => {
                node.textContent = name;
            });
        } catch (error) {
            /* Default identity remains visible. */
        }
    }

    async function checkExistingSession() {
        try {
            const user = await App.getCurrentUser();

            if (user) {
                window.location.replace(App.homeFor(user));
            }
        } catch (error) {
            /* Registration remains available if the session check fails. */
        }
    }

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        clearInvalid();

        const name = nameInput.value.trim();
        const email = emailInput.value.trim();
        const password = passwordInput.value;
        const confirmation = confirmInput.value;

        if (!name) {
            App.fieldError(nameInput, I18N.t("auth.nameRequired"));
            nameInput.focus();
            return;
        }

        if (!email) {
            App.fieldError(emailInput, I18N.t("auth.emailRequired"));
            emailInput.focus();
            return;
        }

        if (!validEmail(email)) {
            App.fieldError(emailInput, I18N.t("auth.emailInvalid"));
            emailInput.focus();
            return;
        }

        if (!password) {
            App.fieldError(passwordInput, I18N.t("auth.passwordRequired"));
            passwordInput.focus();
            return;
        }

        if (password.length < 6) {
            App.fieldError(passwordInput, I18N.t("auth.passwordTooShort"));
            passwordInput.focus();
            return;
        }

        if (!confirmation) {
            App.fieldError(confirmInput, I18N.t("auth.confirmRequired"));
            confirmInput.focus();
            return;
        }

        if (password !== confirmation) {
            App.fieldError(confirmInput, I18N.t("auth.passwordMismatch"));
            confirmInput.focus();
            return;
        }

        const restore = App.buttonLoading(
            submitButton,
            I18N.t("auth.creating")
        );

        try {
            await App.api.post("/register", { name, email, password });

            window.location.replace(
                "login.html?registered=1&email=" + encodeURIComponent(email)
            );
        } catch (error) {
            restore();

            if (error.code === "email_exists") {
                App.fieldError(emailInput, App.friendlyError(error));
                emailInput.focus();
                return;
            }

            if (!showServerFieldErrors(error)) {
                showError(
                    App.friendlyError(error, I18N.t("auth.genericError"))
                );
            }
        }
    });

    if (languageButton) {
        languageButton.addEventListener("click", () => {
            I18N.toggleLanguage();
        });
    }

    window.addEventListener("campusfix:languagechange", () => {
        setLanguageLabel();
    });

    setLanguageLabel();
    loadIdentity();
    checkExistingSession();
})();
