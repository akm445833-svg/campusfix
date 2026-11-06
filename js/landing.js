/* CampusFix public landing page. */
(function () {
    "use strict";

    const App = window.CampusFix;
    const I18N = window.CampusFixI18n;

    if (!App || !I18N) {
        return;
    }

    const nav = document.getElementById("landingNav");
    const menuButton = document.getElementById("landingMenuButton");
    const languageButton = document.getElementById("landingLanguage");
    const languageLabel = document.getElementById("landingLanguageLabel");

    function syncLanguageLabel() {
        if (languageLabel) {
            languageLabel.textContent =
                I18N.currentLanguage() === "hi" ? "हिं" : "EN";
        }
    }

    function syncFooter() {
        document.querySelectorAll("[data-footer-copyright]").forEach((node) => {
            node.textContent = I18N.t("landing.footerCopyright", {
                year: new Date().getFullYear()
            });
        });
    }

    function closeNav() {
        if (!nav || !menuButton) {
            return;
        }

        nav.classList.remove("is-open");
        menuButton.setAttribute("aria-expanded", "false");
        menuButton.setAttribute(
            "aria-label",
            I18N.t("nav.openMenu")
        );
    }

    function toggleNav() {
        if (!nav || !menuButton) {
            return;
        }

        const open = !nav.classList.contains("is-open");
        nav.classList.toggle("is-open", open);
        menuButton.setAttribute("aria-expanded", String(open));
        menuButton.setAttribute(
            "aria-label",
            I18N.t(open ? "nav.closeMenu" : "nav.openMenu")
        );
    }

    async function loadPublicConfig() {
        try {
            const config = await App.api.get("/public-config");
            const collegeName = String(config.collegeName || "CampusFix");

            document.querySelectorAll("[data-public-college]").forEach((node) => {
                node.textContent = collegeName;
            });

            if (collegeName && collegeName !== "CampusFix") {
                document.title =
                    collegeName + " · CampusFix smart campus issue management";
            }
        } catch (error) {
            /* Default identity remains visible when configuration is unavailable. */
        }
    }

    if (menuButton && nav) {
        menuButton.addEventListener("click", toggleNav);

        nav.addEventListener("click", (event) => {
            if (event.target.closest("a")) {
                closeNav();
            }
        });
    }

    if (languageButton) {
        languageButton.addEventListener("click", () => {
            I18N.toggleLanguage();
        });
    }

    window.addEventListener("campusfix:languagechange", () => {
        syncLanguageLabel();
        syncFooter();
        closeNav();
    });

    window.addEventListener("resize", () => {
        if (window.innerWidth > 840) {
            closeNav();
        }
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            closeNav();
        }
    });

    syncLanguageLabel();
    syncFooter();
    loadPublicConfig();
})();
