(function () {
    "use strict";

    const chatTitle = document.getElementById("chatTitle");
    const messagesContainer = document.getElementById("chatMessages");
    const chatForm = document.getElementById("chatForm");
    const chatInput = document.getElementById("chatInput");
    const adminButton = document.getElementById("adminBtn");
    const aiButton = document.getElementById("aiBtn");
    const dashboardButton = document.getElementById("dashboardButton");

    let user = null;
    let currentChatType = "admin";
    let adminUserId = null;
    let loadingMessages = false;

    function addMessage(options) {
        const row = document.createElement("div");
        row.className = "message";

        if (options.mine) {
            row.classList.add("mine");
        }

        if (options.system) {
            row.classList.add("system");
        }

        const bubble = document.createElement("div");
        bubble.className = "message-bubble";

        if (options.senderName) {
            const sender = document.createElement("strong");
            sender.textContent = options.senderName;
            bubble.appendChild(sender);
        }

        const text = document.createElement("p");
        text.textContent = options.text;
        bubble.appendChild(text);

        if (options.time) {
            const time = document.createElement("span");
            time.className = "message-time";
            time.textContent = options.time;
            bubble.appendChild(time);
        }

        row.appendChild(bubble);
        messagesContainer.appendChild(row);
        messagesContainer.scrollTop =
            messagesContainer.scrollHeight;
    }

    function addSystemMessage(text) {
        addMessage({ text, system: true });
    }

    function renderAdminMessages(messages) {
        messagesContainer.innerHTML = "";

        if (messages.length === 0) {
            addSystemMessage(
                "No messages yet. Send a message to the admin."
            );
            return;
        }

        messages.forEach(function (message) {
            addMessage({
                mine:
                    message.sender &&
                    message.sender.id === user.id,
                senderName: message.sender
                    ? message.sender.name
                    : "Unknown",
                text: message.message,
                time: new Date(
                    message.createdAt
                ).toLocaleTimeString()
            });
        });
    }

    function renderAiMessages(messages) {
        messagesContainer.innerHTML = "";

        if (messages.length === 0) {
            addSystemMessage(
                "AI Assistant is online. Type your question below!"
            );
            return;
        }

        messages.forEach(function (message) {
            addMessage({
                mine: !message.isAI,
                senderName: message.isAI
                    ? "🤖 AI Assistant"
                    : "You",
                text: message.message,
                time: new Date(
                    message.createdAt
                ).toLocaleTimeString()
            });
        });
    }

    async function loadAdminMessages() {
        if (!adminUserId || loadingMessages) {
            return;
        }

        loadingMessages = true;

        try {
            const data = await CampusFix.request(
                "/chat/" + encodeURIComponent(adminUserId)
            );
            renderAdminMessages(data.messages || []);
        } catch (error) {
            messagesContainer.innerHTML = "";
            addSystemMessage(
                error.message || "Could not load messages."
            );
        } finally {
            loadingMessages = false;
        }
    }

    async function loadAiMessages() {
        try {
            const data = await CampusFix.request(
                "/chat/ai/history"
            );
            renderAiMessages(data.messages || []);
        } catch (error) {
            messagesContainer.innerHTML = "";
            addSystemMessage(
                error.message || "Could not load AI chat."
            );
        }
    }

    async function findAdmin() {
        const data = await CampusFix.request("/users");
        const admins = data.users || [];

        return admins.length > 0 ? admins[0].id : null;
    }

    async function selectChat(type) {
        currentChatType = type;

        if (type === "admin") {
            adminButton.classList.add("active");
            aiButton.classList.remove("active");
            chatTitle.innerText = "👨‍💼 Chat with Admin";
            messagesContainer.innerHTML =
                '<div class="loading-inline">Loading messages...</div>';

            try {
                if (!adminUserId) {
                    adminUserId = await findAdmin();
                }

                if (!adminUserId) {
                    messagesContainer.innerHTML = "";
                    addSystemMessage(
                        "No administrator account is available yet."
                    );
                    return;
                }

                await loadAdminMessages();
            } catch (error) {
                messagesContainer.innerHTML = "";
                addSystemMessage(
                    error.message ||
                        "Could not load the admin chat."
                );
            }
        } else {
            aiButton.classList.add("active");
            adminButton.classList.remove("active");
            chatTitle.innerText = "🤖 AI Assistant";
            messagesContainer.innerHTML =
                '<div class="loading-inline">Loading messages...</div>';
            await loadAiMessages();
        }
    }

    chatForm.addEventListener("submit", async function (event) {
        event.preventDefault();

        const text = chatInput.value.trim();

        if (!text) {
            return;
        }

        const submitButton = chatForm.querySelector(
            "button[type=submit]"
        );

        submitButton.disabled = true;

        try {
            if (currentChatType === "admin") {
                if (!adminUserId) {
                    throw new Error(
                        "No administrator account is available."
                    );
                }

                await CampusFix.request("/chat", {
                    method: "POST",
                    body: JSON.stringify({
                        receiverId: adminUserId,
                        message: text
                    })
                });

                chatInput.value = "";
                await loadAdminMessages();
            } else {
                const data = await CampusFix.request("/chat/ai", {
                    method: "POST",
                    body: JSON.stringify({ message: text })
                });

                chatInput.value = "";

                if (data.chat) {
                    if (messagesContainer.querySelector(
                        ".loading-inline"
                    )) {
                        messagesContainer.innerHTML = "";
                    }

                    addMessage({
                        mine: true,
                        senderName: "You",
                        text: text,
                        time: new Date(
                            data.chat.createdAt
                        ).toLocaleTimeString()
                    });
                    addMessage({
                        mine: false,
                        senderName: "🤖 AI Assistant",
                        text: data.reply,
                        time: new Date(
                            data.chat.createdAt
                        ).toLocaleTimeString()
                    });
                } else {
                    await loadAiMessages();
                }
            }
        } catch (error) {
            addSystemMessage(
                error.message || "Could not send the message."
            );
        } finally {
            submitButton.disabled = false;
        }
    });

    adminButton.addEventListener("click", function () {
        selectChat("admin");
    });
    aiButton.addEventListener("click", function () {
        selectChat("ai");
    });
    dashboardButton.addEventListener("click", function () {
        window.location.href = "dashboard.html";
    });

    (async function start() {
        user = await CampusFix.requireUser();

        if (!user) {
            return;
        }

        chatTitle.innerText = "👋 Welcome, " + user.name;
        await selectChat("admin");

        setInterval(function () {
            if (
                currentChatType === "admin" &&
                adminUserId &&
                !document.hidden
            ) {
                loadAdminMessages();
            }
        }, 5000);
    })();
})();
