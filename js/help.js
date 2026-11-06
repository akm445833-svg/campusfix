/* CampusFix help center: searchable FAQs, shortcuts, support links and install. */
(function () {
    "use strict";

    const App = window.CampusFix;
    const I18N = window.CampusFixI18n;

    if (!App || !I18N || !window.CampusFixShell) {
        return;
    }

    const FAQS = [
        ["help.faq1Q", "help.faq1A"],
        ["help.faq2Q", "help.faq2A"],
        ["help.faq3Q", "help.faq3A"],
        ["help.faq4Q", "help.faq4A"],
        ["help.faq5Q", "help.faq5A"],
        ["help.faq6Q", "help.faq6A"],
        ["help.faq7Q", "help.faq7A"],
        ["help.faq8Q", "help.faq8A"],
        ["help.faq9Q", "help.faq9A"],
        ["help.faq10Q", "help.faq10A"],
        ["help.installTitle", "help.installBody"],
        ["help.offlineTitle", "help.offlineBody"]
    ];

    const elements = {
        search: document.getElementById("helpSearch"),
        list: document.getElementById("faqList"),
        install: document.getElementById("helpInstall")
    };

    const state = {
        query: "",
        renderTimer: null
    };

    const escape = App.escapeHTML;
    const icon = (name) => App.icon(name);
    const t = (key) => I18N.t(key);

    function normalize(value) {
        return String(value || "")
            .toLocaleLowerCase(I18N.locale())
            .trim();
    }

    function parseQuery() {
        const params = new URLSearchParams(window.location.search);
        state.query = String(params.get("q") || "").slice(0, 160);
    }

    function syncUrl() {
        const url = new URL(window.location.href);

        if (state.query.trim()) {
            url.searchParams.set("q", state.query.trim());
        } else {
            url.searchParams.delete("q");
        }

        window.history.replaceState(
            null,
            "",
            url.pathname + url.search + url.hash
        );
    }

    function matchingFaqs() {
        const needle = normalize(state.query);

        if (!needle) {
            return FAQS.map((entry) => ({
                question: t(entry[0]),
                answer: t(entry[1])
            }));
        }

        return FAQS.map((entry) => ({
            question: t(entry[0]),
            answer: t(entry[1])
        })).filter((entry) =>
            normalize(entry.question + " " + entry.answer).includes(needle)
        );
    }

    function renderFaqs() {
        if (!elements.list) {
            return;
        }

        const entries = matchingFaqs();
        const searching = Boolean(state.query.trim());

        if (entries.length === 0) {
            elements.list.innerHTML =
                '<div class="faq-empty">' +
                "<p>" +
                escape(t("help.faqEmpty")) +
                "</p>" +
                '<button type="button" class="btn btn-secondary btn-sm" data-clear-help style="margin-top:10px">' +
                escape(t("common.clear")) +
                "</button></div>";
            return;
        }

        elements.list.innerHTML = entries
            .map(
                (entry, index) =>
                    '<details class="faq-item"' +
                    (searching ? " open" : "") +
                    ">" +
                    "<summary>" +
                    icon("life-buoy") +
                    "<span>" +
                    escape(entry.question) +
                    "</span></summary>" +
                    "<div><p>" +
                    escape(entry.answer) +
                    "</p></div></details>"
            )
            .join("");
    }

    function scheduleRender() {
        window.clearTimeout(state.renderTimer);
        state.renderTimer = window.setTimeout(() => {
            syncUrl();
            renderFaqs();
        }, 120);
    }

    function clearSearch() {
        state.query = "";

        if (elements.search) {
            elements.search.value = "";
            elements.search.focus();
        }

        syncUrl();
        renderFaqs();
    }

    function updateInstallState() {
        if (!elements.install) {
            return;
        }

        elements.install.hidden = !App.canInstall();
    }

    async function installApp() {
        if (!elements.install) {
            return;
        }

        elements.install.disabled = true;

        try {
            await App.promptInstall();
        } finally {
            elements.install.disabled = false;
            updateInstallState();
        }
    }

    function bindEvents() {
        if (elements.search) {
            elements.search.addEventListener("input", () => {
                state.query = elements.search.value;
                scheduleRender();
            });
        }

        if (elements.list) {
            elements.list.addEventListener("click", (event) => {
                if (event.target.closest("[data-clear-help]")) {
                    clearSearch();
                }
            });
        }

        if (elements.install) {
            elements.install.addEventListener("click", installApp);
        }

        window.addEventListener("campusfix:installability", () => {
            updateInstallState();
        });

        window.addEventListener("campusfix:languagechange", () => {
            renderFaqs();
        });
    }

    async function init() {
        const user = await window.CampusFixShell.ready;

        if (!user) {
            return;
        }

        parseQuery();

        if (elements.search) {
            elements.search.value = state.query;
        }

        updateInstallState();
        bindEvents();
        renderFaqs();
    }

    init();
})();
