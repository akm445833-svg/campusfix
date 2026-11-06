/* CampusFix messages: direct staff conversations and a clearly limited helper. */
(function () {
    "use strict";

    const App = window.CampusFix;
    const I18N = window.CampusFixI18n;

    if (!App || !I18N || !window.CampusFixShell) {
        return;
    }

    const POLL_INTERVAL = 20000;
    const OPERATIONS_ROLES = ["staff", "department_manager", "admin"];

    const elements = {
        contactList: document.getElementById("chatContactList"),
        tabs: document.querySelectorAll("[data-chat-tab]"),
        helperTab: document.getElementById("chatTabHelper"),
        staffTabLabel: document.getElementById("chatStaffTabLabel"),
        sidebarTitle: document.getElementById("chatSidebarTitle"),
        pageSubtitle: document.getElementById("chatPageSubtitle"),
        mainAvatar: document.getElementById("chatMainAvatar"),
        mainName: document.getElementById("chatMainName"),
        mainSubtitle: document.getElementById("chatMainSubtitle"),
        messages: document.getElementById("chatMessages"),
        form: document.getElementById("chatForm"),
        input: document.getElementById("chatInput"),
        send: document.getElementById("chatSend"),
        disclaimer: document.getElementById("chatDisclaimer"),
        refresh: document.getElementById("refreshChat")
    };

    const state = {
        user: null,
        tab: "staff",
        contacts: [],
        contactsLoading: false,
        contactsError: null,
        selectedId: null,
        messages: [],
        messagesContactId: null,
        messagesLoading: false,
        messagesError: null,
        messageRequestId: 0,
        helperMessages: [],
        helperLoaded: false,
        helperLoading: false,
        helperError: null,
        helperRequestId: 0,
        sending: false,
        pollTimer: null,
        refreshBusy: false
    };

    const escape = App.escapeHTML;
    const icon = (name) => App.icon(name);
    const t = (key, vars) => I18N.t(key, vars);

    function isOperations() {
        return Boolean(
            state.user &&
                OPERATIONS_ROLES.includes(state.user.role)
        );
    }

    function selectBodyText() {
        return t(
            isOperations()
                ? "chat.selectBodyOperations"
                : "chat.selectBody"
        );
    }

    function applyRoleCopy() {
        const operations = isOperations();

        if (elements.pageSubtitle) {
            elements.pageSubtitle.textContent = t(
                operations
                    ? "chat.subtitleOperations"
                    : "chat.subtitle"
            );
        }

        if (elements.sidebarTitle) {
            elements.sidebarTitle.textContent = t(
                operations
                    ? "chat.contactsTitleOperations"
                    : "chat.contactsTitle"
            );
        }

        if (elements.staffTabLabel) {
            elements.staffTabLabel.textContent = t(
                operations ? "chat.studentsTab" : "chat.staffTab"
            );
        }

        if (elements.helperTab) {
            elements.helperTab.hidden = operations;
        }
    }

    function contactName(contact) {
        return contact && contact.name ? contact.name : "";
    }

    function contactSubtitle(contact) {
        const parts = [I18N.roleLabel(contact.role)];

        if (contact.departmentName) {
            parts.push(contact.departmentName);
        }

        return parts.join(" · ");
    }

    function selectedContact() {
        return (
            state.contacts.find(
                (contact) => contact.id === state.selectedId
            ) || null
        );
    }

    function formatBubbleTime(value) {
        if (!value) {
            return "";
        }

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {
            return "";
        }

        return new Intl.DateTimeFormat(I18N.locale(), {
            hour: "numeric",
            minute: "2-digit"
        }).format(date);
    }

    function syncUrl() {
        const url = new URL(window.location.href);

        if (state.tab === "helper") {
            url.searchParams.set("tab", "helper");
            url.searchParams.delete("contact");
        } else {
            url.searchParams.delete("tab");

            if (state.selectedId) {
                url.searchParams.set("contact", state.selectedId);
            } else {
                url.searchParams.delete("contact");
            }
        }

        window.history.replaceState(
            null,
            "",
            url.pathname + url.search + url.hash
        );
    }

    function parseUrl() {
        const params = new URLSearchParams(window.location.search);

        state.tab = params.get("tab") === "helper" ? "helper" : "staff";
        state.selectedId = params.get("contact") || null;
    }

    function updateTabButtons() {
        elements.tabs.forEach((button) => {
            const active =
                button.getAttribute("data-chat-tab") === state.tab;

            button.classList.toggle("is-active", active);
            button.setAttribute(
                "aria-pressed",
                active ? "true" : "false"
            );
        });
    }

    function contactMarkup(contact) {
        const active = contact.id === state.selectedId;

        return (
            '<button type="button" class="conversation-item' +
            (active ? " is-active" : "") +
            '" data-contact-id="' +
            escape(contact.id) +
            '"' +
            (active ? ' aria-current="true"' : "") +
            ">" +
            '<span class="avatar" aria-hidden="true">' +
            escape(I18N.initials(contact.name)) +
            "</span>" +
            '<span class="conversation-copy"><strong>' +
            escape(contact.name) +
            "</strong><span>" +
            escape(contactSubtitle(contact)) +
            "</span></span></button>"
        );
    }

    function contactsSkeleton() {
        let rows = "";

        for (let index = 0; index < 4; index += 1) {
            rows +=
                '<div class="skeleton-row">' +
                '<span class="skeleton" style="width:34px;height:34px;border-radius:10px"></span>' +
                '<span class="skeleton skeleton-line" style="flex:1"></span>' +
                "</div>";
        }

        return rows;
    }

    function contactsErrorMarkup(message) {
        return (
            '<div class="error-state" style="margin:10px">' +
            '<span aria-hidden="true">' +
            icon("alert-circle") +
            "</span>" +
            "<div><strong>" +
            escape(t("common.errorTitle")) +
            "</strong><p>" +
            escape(message) +
            '</p><button type="button" class="btn btn-secondary btn-sm" data-retry-contacts style="margin-top:9px">' +
            escape(t("common.retry")) +
            "</button></div></div>"
        );
    }

    function renderSidebar() {
        if (!elements.contactList) {
            return;
        }

        if (state.tab === "helper") {
            elements.contactList.innerHTML =
                '<div class="conversation-item is-active" aria-current="true">' +
                '<span class="avatar" aria-hidden="true">' +
                icon("life-buoy") +
                "</span>" +
                '<span class="conversation-copy"><strong>' +
                escape(t("chat.assistantTitle")) +
                "</strong><span>" +
                escape(t("chat.helperSubtitle")) +
                "</span></span></div>";
            return;
        }

        if (state.contactsLoading) {
            elements.contactList.innerHTML = contactsSkeleton();
            return;
        }

        if (state.contactsError) {
            elements.contactList.innerHTML = contactsErrorMarkup(
                state.contactsError
            );
            return;
        }

        if (state.contacts.length === 0) {
            elements.contactList.innerHTML =
                '<div class="empty-state" style="padding:32px 18px">' +
                '<span class="empty-icon">' +
                icon("users") +
                "</span><p>" +
                escape(
                    t(
                        isOperations()
                            ? "chat.noContactsOperations"
                            : "chat.noContacts"
                    )
                ) +
                "</p></div>";
            return;
        }

        elements.contactList.innerHTML = state.contacts
            .map(contactMarkup)
            .join("");
    }

    function setHeader(avatar, name, subtitle) {
        if (elements.mainAvatar) {
            if (avatar === "helper") {
                elements.mainAvatar.innerHTML = icon("life-buoy");
            } else {
                elements.mainAvatar.textContent = avatar;
            }
        }

        if (elements.mainName) {
            elements.mainName.textContent = name;
        }

        if (elements.mainSubtitle) {
            elements.mainSubtitle.textContent = subtitle;
        }
    }

    function setComposer(visible) {
        if (elements.form) {
            elements.form.hidden = !visible;
        }

        if (!visible) {
            return;
        }

        if (elements.input) {
            elements.input.placeholder = t(
                state.tab === "helper"
                    ? "chat.assistantPlaceholder"
                    : "chat.messagePlaceholder"
            );
        }
    }

    function messageSkeleton() {
        return (
            '<div class="skeleton" style="width:54%;height:52px;border-radius:4px 12px 12px 12px;margin-right:auto"></div>' +
            '<div class="skeleton" style="width:38%;height:42px;border-radius:12px 4px 12px 12px;margin-left:auto"></div>' +
            '<div class="skeleton" style="width:61%;height:60px;border-radius:4px 12px 12px 12px;margin-right:auto"></div>'
        );
    }

    function messageError(message, retryAttribute) {
        return (
            '<div class="error-state" style="margin:8px">' +
            '<span aria-hidden="true">' +
            icon("alert-circle") +
            "</span>" +
            "<div><strong>" +
            escape(t("common.errorTitle")) +
            "</strong><p>" +
            escape(message) +
            '</p><button type="button" class="btn btn-secondary btn-sm" ' +
            retryAttribute +
            ' style="margin-top:9px">' +
            escape(t("common.retry")) +
            "</button></div></div>"
        );
    }

    function chatBubble(options) {
        const initials = options.mine
            ? I18N.initials(state.user.name)
            : options.helper
              ? ""
              : I18N.initials(options.name || "?");
        const avatar = options.helper
            ? icon("life-buoy")
            : escape(initials);
        const time = formatBubbleTime(options.createdAt);
        const exact = options.createdAt
            ? I18N.formatDateTime(options.createdAt)
            : "";

        return (
            '<div class="chat-message' +
            (options.mine ? " is-mine" : "") +
            '">' +
            '<span class="avatar" aria-hidden="true">' +
            avatar +
            "</span>" +
            '<div class="chat-bubble">' +
            escape(options.text) +
            (time
                ? '<time datetime="' +
                  escape(options.createdAt) +
                  '" title="' +
                  escape(exact) +
                  '">' +
                  escape(time) +
                  "</time>"
                : "") +
            "</div></div>"
        );
    }

    function renderStaffMessages() {
        const contact = selectedContact();

        if (!contact) {
            const body = selectBodyText();

            setHeader(
                "·",
                t("chat.selectTitle"),
                body
            );
            elements.messages.innerHTML =
                '<div class="chat-empty">' +
                '<span class="empty-icon">' +
                icon("message") +
                "</span>" +
                "<strong>" +
                escape(t("chat.selectTitle")) +
                "</strong><p>" +
                escape(body) +
                "</p></div>";
            setComposer(false);
            elements.messages.removeAttribute("aria-busy");

            if (elements.disclaimer) {
                elements.disclaimer.hidden = true;
            }

            return;
        }

        setHeader(
            I18N.initials(contact.name),
            contact.name,
            contactSubtitle(contact)
        );

        if (elements.disclaimer) {
            elements.disclaimer.hidden = true;
        }

        if (state.messagesLoading) {
            elements.messages.setAttribute("aria-busy", "true");
            elements.messages.innerHTML = messageSkeleton();
            setComposer(false);
            return;
        }

        if (state.messagesError) {
            elements.messages.removeAttribute("aria-busy");
            elements.messages.innerHTML = messageError(
                state.messagesError,
                "data-retry-messages"
            );
            setComposer(false);
            return;
        }

        elements.messages.removeAttribute("aria-busy");
        setComposer(true);

        if (state.messages.length === 0) {
            elements.messages.innerHTML =
                '<div class="chat-empty">' +
                '<span class="empty-icon">' +
                icon("message") +
                "</span><p>" +
                escape(t("chat.noMessages")) +
                "</p></div>";
            return;
        }

        elements.messages.innerHTML = state.messages
            .map((message) => {
                const mine =
                    message.sender && message.sender.id === state.user.id;

                return chatBubble({
                    mine,
                    helper: false,
                    name: message.sender ? message.sender.name : "",
                    text: message.message,
                    createdAt: message.createdAt
                });
            })
            .join("");
    }

    function renderHelperMessages() {
        setHeader(
            "helper",
            t("chat.assistantTitle"),
            t("chat.helperSubtitle")
        );

        if (elements.disclaimer) {
            elements.disclaimer.hidden = false;
        }

        if (state.helperLoading) {
            elements.messages.setAttribute("aria-busy", "true");
            elements.messages.innerHTML = messageSkeleton();
            setComposer(false);
            return;
        }

        if (state.helperError) {
            elements.messages.removeAttribute("aria-busy");
            elements.messages.innerHTML = messageError(
                state.helperError,
                "data-retry-helper"
            );
            setComposer(false);
            return;
        }

        elements.messages.removeAttribute("aria-busy");
        setComposer(true);

        if (state.helperMessages.length === 0) {
            elements.messages.innerHTML =
                '<div class="chat-message">' +
                '<span class="avatar" aria-hidden="true">' +
                icon("life-buoy") +
                "</span>" +
                '<div class="chat-bubble">' +
                escape(t("chat.assistantIntro")) +
                "</div></div>";
            return;
        }

        elements.messages.innerHTML = state.helperMessages
            .map((message) =>
                chatBubble({
                    mine: !message.isAI,
                    helper: Boolean(message.isAI),
                    text: message.message,
                    createdAt: message.createdAt
                })
            )
            .join("");
    }

    function renderMain() {
        if (!elements.messages) {
            return;
        }

        updateTabButtons();

        if (state.tab === "helper") {
            renderHelperMessages();
        } else {
            renderStaffMessages();
        }
    }

    function isNearBottom() {
        if (!elements.messages) {
            return true;
        }

        return (
            elements.messages.scrollHeight -
                elements.messages.scrollTop -
                elements.messages.clientHeight <
            90
        );
    }

    function scrollToBottom() {
        if (!elements.messages) {
            return;
        }

        elements.messages.scrollTop = elements.messages.scrollHeight;
    }

    function autoResize() {
        if (!elements.input) {
            return;
        }

        elements.input.style.height = "auto";
        elements.input.style.height =
            Math.min(elements.input.scrollHeight, 120) + "px";
    }

    function stopPolling() {
        if (state.pollTimer) {
            window.clearInterval(state.pollTimer);
            state.pollTimer = null;
        }
    }

    function startPolling() {
        stopPolling();

        if (state.tab !== "staff" || !state.selectedId) {
            return;
        }

        state.pollTimer = window.setInterval(() => {
            if (
                document.visibilityState !== "visible" ||
                state.sending ||
                !state.selectedId
            ) {
                return;
            }

            loadMessages({ silent: true });
        }, POLL_INTERVAL);
    }

    async function loadContacts() {
        if (state.contactsLoading) {
            return;
        }

        state.contactsLoading = true;
        state.contactsError = null;
        renderSidebar();

        try {
            const data = await App.api.get("/users");
            const rows = Array.isArray(data.users) ? data.users : [];

            state.contacts = rows.filter(
                (contact) =>
                    contact &&
                    contact.id !== state.user.id &&
                    (isOperations() ||
                        OPERATIONS_ROLES.includes(contact.role))
            );
        } catch (error) {
            state.contactsError = App.friendlyError(
                error,
                t("chat.loadError")
            );
        } finally {
            state.contactsLoading = false;
        }

        if (
            state.selectedId &&
            !state.contacts.some(
                (contact) => contact.id === state.selectedId
            )
        ) {
            state.selectedId = null;
            state.messages = [];
            state.messagesContactId = null;
            state.messagesError = null;
        }

        if (!state.selectedId && state.contacts.length > 0) {
            state.selectedId = state.contacts[0].id;
        }

        syncUrl();
        renderSidebar();
        renderMain();

        if (
            state.tab === "staff" &&
            state.selectedId &&
            state.messagesContactId !== state.selectedId
        ) {
            loadMessages();
        }
    }

    async function selectContact(contactId, options) {
        if (!contactId || contactId === state.selectedId) {
            if (options && options.focus && elements.input) {
                elements.input.focus();
            }

            return;
        }

        state.selectedId = contactId;
        state.messages = [];
        state.messagesContactId = null;
        state.messagesError = null;
        state.messagesLoading = true;
        state.messageRequestId += 1;
        syncUrl();
        renderSidebar();
        renderMain();
        startPolling();
        await loadMessages();

        if (options && options.focus && elements.input) {
            elements.input.focus();
        }
    }

    async function loadMessages(options) {
        const settings = options || {};

        if (state.tab !== "staff" || !state.selectedId) {
            return;
        }

        const contactId = state.selectedId;
        const requestId = ++state.messageRequestId;
        const wasNearBottom = isNearBottom();

        if (!settings.silent) {
            state.messagesLoading = true;
            state.messagesError = null;
            renderMain();
        }

        try {
            const data = await App.api.get(
                "/chat/" + encodeURIComponent(contactId)
            );

            if (
                requestId !== state.messageRequestId ||
                contactId !== state.selectedId
            ) {
                return;
            }

            state.messages = Array.isArray(data.messages)
                ? data.messages
                : [];
            state.messagesContactId = contactId;
            state.messagesError = null;
        } catch (error) {
            if (requestId !== state.messageRequestId) {
                return;
            }

            if (settings.silent) {
                return;
            }

            state.messagesError = App.friendlyError(
                error,
                t("chat.loadError")
            );
        } finally {
            if (requestId === state.messageRequestId) {
                state.messagesLoading = false;
                renderMain();

                if (!settings.silent || wasNearBottom) {
                    window.requestAnimationFrame(scrollToBottom);
                }
            }
        }
    }

    async function loadHelperMessages(options) {
        const settings = options || {};
        const requestId = ++state.helperRequestId;

        if (!settings.silent) {
            state.helperLoading = true;
            state.helperError = null;
            renderMain();
        }

        try {
            const data = await App.api.get("/chat/ai/history");

            if (requestId !== state.helperRequestId) {
                return;
            }

            state.helperMessages = Array.isArray(data.messages)
                ? data.messages
                : [];
            state.helperLoaded = true;
            state.helperError = null;
        } catch (error) {
            if (requestId !== state.helperRequestId) {
                return;
            }

            if (settings.silent) {
                return;
            }

            state.helperError = App.friendlyError(
                error,
                t("chat.loadError")
            );
        } finally {
            if (requestId === state.helperRequestId) {
                state.helperLoading = false;
                renderMain();
                window.requestAnimationFrame(scrollToBottom);
            }
        }
    }

    async function setTab(tab, options) {
        if (tab === "helper" && isOperations()) {
            return;
        }

        const next = tab === "helper" ? "helper" : "staff";

        if (state.tab === next) {
            if (next === "helper" && !state.helperLoaded) {
                loadHelperMessages();
            }

            if (options && options.focus && elements.input && !elements.form.hidden) {
                elements.input.focus();
            }

            return;
        }

        state.tab = next;
        syncUrl();
        renderSidebar();
        renderMain();

        if (state.tab === "helper") {
            stopPolling();

            if (!state.helperLoaded) {
                await loadHelperMessages();
            } else {
                renderMain();
                window.requestAnimationFrame(scrollToBottom);
            }
        } else {
            if (
                state.selectedId &&
                state.messagesContactId !== state.selectedId
            ) {
                await loadMessages();
            } else {
                renderMain();
            }

            startPolling();
        }

        if (options && options.focus && elements.input) {
            elements.input.focus();
        }
    }

    async function sendMessage(event) {
        event.preventDefault();

        if (state.sending) {
            return;
        }

        const text = String(elements.input.value || "").trim();

        if (!text) {
            elements.input.focus();
            return;
        }

        if (state.tab === "staff" && !state.selectedId) {
            return;
        }

        state.sending = true;
        const restore = App.buttonLoading(
            elements.send,
            t("chat.sending")
        );

        if (elements.input) {
            elements.input.disabled = true;
        }

        try {
            if (state.tab === "helper") {
                await App.api.post("/chat/ai", { message: text });
                elements.input.value = "";
                autoResize();
                await loadHelperMessages({ silent: true });
            } else {
                const contact = selectedContact();
                const data = await App.api.post("/chat", {
                    receiverId: state.selectedId,
                    message: text
                });

                if (data.chat) {
                    state.messages.push({
                        id: data.chat.id,
                        message: data.chat.message,
                        isAI: false,
                        createdAt: data.chat.createdAt,
                        sender: {
                            id: state.user.id,
                            name: state.user.name
                        },
                        receiver: {
                            id: contact ? contact.id : state.selectedId,
                            name: contactName(contact)
                        }
                    });
                } else {
                    await loadMessages({ silent: true });
                }

                elements.input.value = "";
                autoResize();
                renderMain();
                window.requestAnimationFrame(scrollToBottom);
            }

            elements.input.focus();
        } catch (error) {
            App.toast(
                App.friendlyError(error, t("chat.sendError")),
                "error"
            );
        } finally {
            state.sending = false;

            if (elements.input) {
                elements.input.disabled = false;
            }

            restore();
            autoResize();
        }
    }

    async function refreshAll() {
        if (state.refreshBusy) {
            return;
        }

        state.refreshBusy = true;
        const restore = App.buttonLoading(
            elements.refresh,
            t("common.loading")
        );

        try {
            await loadContacts();

            if (state.tab === "helper") {
                await loadHelperMessages({ silent: true });
            } else if (state.selectedId) {
                await loadMessages({ silent: true });
            }
        } finally {
            state.refreshBusy = false;
            restore();
        }
    }

    function bindEvents() {
        elements.tabs.forEach((button) => {
            button.addEventListener("click", () => {
                setTab(button.getAttribute("data-chat-tab"), {
                    focus: true
                });
            });
        });

        if (elements.contactList) {
            elements.contactList.addEventListener("click", (event) => {
                if (event.target.closest("[data-retry-contacts]")) {
                    loadContacts();
                    return;
                }

                const item = event.target.closest("[data-contact-id]");

                if (item) {
                    selectContact(item.getAttribute("data-contact-id"), {
                        focus: true
                    });
                }
            });
        }

        if (elements.messages) {
            elements.messages.addEventListener("click", (event) => {
                if (event.target.closest("[data-retry-messages]")) {
                    loadMessages();
                }

                if (event.target.closest("[data-retry-helper]")) {
                    loadHelperMessages();
                }
            });
        }

        if (elements.form) {
            elements.form.addEventListener("submit", sendMessage);
        }

        if (elements.input) {
            elements.input.addEventListener("input", autoResize);

            elements.input.addEventListener("keydown", (event) => {
                if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.isComposing
                ) {
                    event.preventDefault();

                    if (elements.form && !elements.send.disabled) {
                        elements.form.requestSubmit();
                    }
                }
            });
        }

        if (elements.refresh) {
            elements.refresh.addEventListener("click", refreshAll);
        }

        window.addEventListener("campusfix:languagechange", () => {
            applyRoleCopy();
            renderSidebar();
            renderMain();
            autoResize();
        });

        document.addEventListener("visibilitychange", () => {
            if (
                document.visibilityState === "visible" &&
                state.tab === "staff" &&
                state.selectedId &&
                !state.sending
            ) {
                loadMessages({ silent: true });
            }
        });

        window.addEventListener("beforeunload", stopPolling);
    }

    async function init() {
        const user = await window.CampusFixShell.ready;

        if (!user) {
            return;
        }

        state.user = user;
        parseUrl();

        if (isOperations() && state.tab === "helper") {
            state.tab = "staff";
            state.selectedId = null;
            syncUrl();
        }

        applyRoleCopy();
        bindEvents();
        updateTabButtons();
        renderMain();

        if (state.tab === "helper") {
            await loadContacts();
            await loadHelperMessages();
        } else {
            await loadContacts();
            startPolling();
        }
    }

    init();
})();
