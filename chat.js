// =====================================================
// CAMPUSFIX CHAT
// =====================================================

const API_URL = ""; // relative - works locally and once deployed


// =====================================================
// LOGIN DATA
// =====================================================

const token = localStorage.getItem("campusfixToken");
const userData = localStorage.getItem("campusfixUser");

let user;


// =====================================================
// CHECK LOGIN
// =====================================================

if (!token || !userData) {
    alert("Please login first.");
    window.location.href = "login.html";
}

try {
    user = JSON.parse(userData);
} catch (error) {
    console.error("User data error:", error);
    localStorage.removeItem("campusfixToken");
    localStorage.removeItem("campusfixUser");
    window.location.href = "login.html";
}


// =====================================================
// WELCOME / PAGE TITLE
// =====================================================

document.getElementById("chatTitle").innerText = "👋 Welcome, " + user.name;


// =====================================================
// LOGOUT
// =====================================================

function goDashboard() {
    window.location.href = "dashboard.html";
}


// =====================================================
// CHAT STATE
// =====================================================

let currentChatType = "admin"; // "admin" or "ai"
let adminUserId = null;
let messagesContainer = document.getElementById("chatMessages");
let chatForm = document.getElementById("chatForm");
let chatInput = document.getElementById("chatInput");
let chatTitle = document.getElementById("chatTitle");
let adminBtn = document.getElementById("adminBtn");
let aiBtn = document.getElementById("aiBtn");


// =====================================================
// SELECT CHAT TYPE
// =====================================================

async function selectChat(type) {
    currentChatType = type;

    if (type === "admin") {
        adminBtn.classList.add("active");
        aiBtn.classList.remove("active");
        chatTitle.innerText = "👨‍💼 Chat with Admin";

        // Fetch admin user ID
        try {
            const response = await fetch(`${API_URL}/api/users`, {
                headers: {
                    "Authorization": `Bearer ${token}`
                }
            });
            const data = await response.json();
            if (response.ok && data.users && data.users.length > 0) {
                adminUserId = data.users[0]._id;
                await loadMessages();
            }
        } catch (error) {
            console.error("Error fetching admin:", error);
        }
    } else {
        aiBtn.classList.add("active");
        adminBtn.classList.remove("active");
        chatTitle.innerText = "🤖 AI Assistant";
        messagesContainer.innerHTML = "";
        addSystemMessage("AI Assistant is online. Type your question below!");
    }
}


// =====================================================
// LOAD MESSAGES
// =====================================================

async function loadMessages() {
    if (!adminUserId || currentChatType !== "admin") return;

    try {
        const response = await fetch(
            `${API_URL}/api/chat/${adminUserId}`,
            {
                headers: {
                    "Authorization": `Bearer ${token}`
                }
            }
        );
        const data = await response.json();

        if (response.ok) {
            messagesContainer.innerHTML = "";
            data.messages.forEach(function(msg) {
                appendMessage(msg);
            });
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
    } catch (error) {
        console.error("Load Messages Error:", error);
    }
}


// =====================================================
// APPEND MESSAGE TO CHAT BOX
// =====================================================

function appendMessage(msg) {
    const msgDiv = document.createElement("div");
    msgDiv.className = "message";

    if (msg.sender && msg.sender._id) {
        // It's a populated message from server
        const isMine = msg.sender._id === user.id ||
                       msg.sender === user.id;
        if (isMine) msgDiv.classList.add("mine");

        const senderName = msg.sender.name || "You";
        const time = msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString() : "";

        msgDiv.innerHTML = `
            <div class="message-bubble">
                <strong>${escapeHTML(senderName)}</strong>
                <p>${escapeHTML(msg.message)}</p>
                <span class="message-time">${time}</span>
            </div>
        `;
    } else if (msg.isAI) {
        msgDiv.classList.add("mine");
        const time = msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString() : "";
        msgDiv.innerHTML = `
            <div class="message-bubble">
                <strong>🤖 AI</strong>
                <p>${escapeHTML(msg.message)}</p>
                <span class="message-time">${time}</span>
            </div>
        `;
    } else {
        const isMine = msg.sender === user.id;
        if (isMine) msgDiv.classList.add("mine");
        const time = msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString() : "";
        msgDiv.innerHTML = `
            <div class="message-bubble">
                <p>${escapeHTML(msg.message)}</p>
                <span class="message-time">${time}</span>
            </div>
        `;
    }

    messagesContainer.appendChild(msgDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}


// =====================================================
// ADD SYSTEM MESSAGE
// =====================================================

function addSystemMessage(text) {
    const msgDiv = document.createElement("div");
    msgDiv.className = "message";
    msgDiv.innerHTML = `
        <div class="message-bubble" style="background:#e9ecef; text-align:center; font-style:italic;">
            <p>${escapeHTML(text)}</p>
        </div>
    `;
    messagesContainer.appendChild(msgDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}


// =====================================================
// SEND MESSAGE
// =====================================================

chatForm.addEventListener("submit", async function(event) {
    event.preventDefault();

    const message = chatInput.value.trim();
    if (!message) return;

    const submitBtn = chatForm.querySelector("button[type=submit]");
    submitBtn.disabled = true;

    // Optimistically add own message
    const tempMsg = {
        sender: user.id,
        message: message,
        isAI: false,
        createdAt: new Date().toISOString()
    };
    appendMessage(tempMsg);
    chatInput.value = "";

    try {
        if (currentChatType === "admin") {
            const response = await fetch(`${API_URL}/api/chat`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`
                },
                body: JSON.stringify({
                    receiverId: adminUserId,
                    message: message
                })
            });

            if (response.ok) {
                const data = await response.json();
                // Reload messages to show the fresh ones
                await loadMessages();
            } else {
                const data = await response.json();
                addSystemMessage("Failed to send message: " + (data.message || "Unknown error"));
            }
        } else {
            // AI Assistant
            const response = await fetch(`${API_URL}/api/chat/ai`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`
                },
                body: JSON.stringify({ message: message })
            });

            if (response.ok) {
                const data = await response.json();
                await loadMessages();
            } else {
                const data = await response.json();
                addSystemMessage("AI assistant unavailable: " + (data.message || "Unknown error"));
            }
        }
    } catch (error) {
        console.error("Send Message Error:", error);
        addSystemMessage("Cannot connect to server ❌");
    }

    submitBtn.disabled = false;
});


// =====================================================
// SECURITY - HTML ESCAPE
// =====================================================

function escapeHTML(text) {
    if (text === null || text === undefined) return "";
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


// =====================================================
// AUTO-REFRESH MESSAGES FOR ADMIN CHAT
// =====================================================

setInterval(function() {
    if (currentChatType === "admin" && adminUserId) {
        loadMessages();
    }
}, 5000);


// =====================================================
// DEFAULT: LOAD ADMIN CHAT ON PAGE START
// =====================================================

selectChat("admin");
