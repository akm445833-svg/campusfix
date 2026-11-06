/* CampusFix sign-in page. */
(function () {
    "use strict";

    const App = window.CampusFix;
    const I18N = window.CampusFixI18n;

    if (!App || !I18N) {
        return;
    }

    const form = document.getElementById("loginForm");
    const emailInput = document.getElementById("loginEmail");
    const passwordInput = document.getElementById("loginPassword");
    const submitButton = document.getElementById("loginSubmit");
    const errorBox = document.getElementById("loginError");
    const errorText = document.getElementById("loginErrorText");
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

    function redirectTarget(user) {
        const requested = App.safeNextPath();

        if (requested) {
            return requested;
        }

        return App.homeFor(user);
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
                window.location.replace(redirectTarget(user));
                return true;
            }
        } catch (error) {
            /* Allow the form to work even if the session check fails. */
        }

        return false;
    }

    function readQuery() {
        const params = new URLSearchParams(window.location.search);
        const email = String(params.get("email") || "").trim();

        if (email) {
            emailInput.value = email;
        }

        if (params.get("registered") === "1") {
            App.toast(I18N.t("auth.registrationSuccess"), "success", 6000);
        }
    }

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        hideError();
        App.clearFieldErrors(form);

        const email = emailInput.value.trim();
        const password = passwordInput.value;

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

        const restore = App.buttonLoading(
            submitButton,
            I18N.t("auth.signingIn")
        );

        try {
            const data = await App.api.post("/login", {
                email,
                password
            });

            window.location.replace(redirectTarget(data.user));
        } catch (error) {
            restore();
            showError(App.friendlyError(error, I18N.t("auth.genericError")));
            passwordInput.select();
        }
    });

    if (languageButton) {
        languageButton.addEventListener("click", () => {
            I18N.toggleLanguage();
        });
    }

    window.addEventListener("campusfix:languagechange", () => {
        setLanguageLabel();
        if (!errorBox.classList.contains("is-visible")) {
            hideError();
        }
    });

    setLanguageLabel();
    loadIdentity();
    readQuery();
    checkExistingSession();
})();
