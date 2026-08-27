const mongoose = require("mongoose");

const chatSchema = new mongoose.Schema(
    {
        sender: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },

        receiver: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },

        message: {
            type: String,
            required: true,
            trim: true
        },

        isAI: {
            type: Boolean,
            default: false
        }
    },
    {
        timestamps: true
    }
);

module.exports = mongoose.model("Chat", chatSchema);
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">

    <title>CampusFix - Chat</title>

    <style>
        * {
            box-sizing: border-box;
        }

        body {
            margin: 0;
            font-family: Arial, sans-serif;
            background: #f4f6f8;
        }

        header {
            background: #222;
            color: white;
            padding: 15px 25px;

            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        header h1 {
            margin: 0;
        }

        header button {
            padding: 9px 15px;
            border: none;
            border-radius: 6px;
            cursor: pointer;
        }

        .container {
            max-width: 900px;
            margin: 30px auto;
            padding: 15px;
        }

        .chat-box {
            background: white;
            border-radius: 12px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            overflow: hidden;
        }

        .chat-header {
            background: #222;
            color: white;
            padding: 18px;
        }

        .chat-header h2 {
            margin: 0;
        }

        .chat-messages {
            height: 500px;
            overflow-y: auto;
            padding: 20px;
            background: #f8f9fa;
        }

        .message {
            margin-bottom: 15px;
            display: flex;
        }

        .message.mine {
            justify-content: flex-end;
        }

        .message-bubble {
            max-width: 70%;
            padding: 12px 15px;
            border-radius: 12px;
            background: #e9ecef;
        }

        .mine .message-bubble {
            background: #222;
            color: white;
        }

        .message-time {
            display: block;
            font-size: 11px;
            margin-top: 5px;
            opacity: 0.7;
        }

        .chat-input {
            display: flex;
            gap: 10px;
            padding: 15px;
            border-top: 1px solid #ddd;
        }

        .chat-input input {
            flex: 1;
            padding: 12px;
            border: 1px solid #ccc;
            border-radius: 7px;
            font-size: 15px;
        }

        .chat-input button {
            padding: 12px 20px;
            background: #222;
            color: white;
            border: none;
            border-radius: 7px;
            cursor: pointer;
        }

        .options {
            display: flex;
            gap: 10px;
            margin-bottom: 20px;
        }

        .options button {
            flex: 1;
            padding: 12px;
            border: none;
            border-radius: 7px;
            cursor: pointer;
            background: white;
            box-shadow: 0 2px 6px rgba(0,0,0,0.08);
        }

        .options button.active {
            background: #222;
            color: white;
        }

        #message {
            text-align: center;
            color: #777;
            margin: 10px;
        }

        @media(max-width:600px) {

            .container {
                margin: 10px auto;
            }

            .chat-messages {
                height: 400px;
            }

            .message-bubble {
                max-width: 85%;
            }
        }
    </style>
</head>

<body>

<header>

    <h1>CampusFix 🚀</h1>

    <button onclick="goDashboard()">
        Dashboard
    </button>

</header>

<div class="container">

    <div class="options">

        <button
            id="adminBtn"
            class="active"
            onclick="selectChat('admin')">

            👨‍💼 Admin Chat

        </button>

        <button
            id="aiBtn"
            onclick="selectChat('ai')">

            🤖 AI Assistant

        </button>

    </div>

    <div class="chat-box">

        <div class="chat-header">

            <h2 id="chatTitle">
                👨‍💼 Chat with Admin
            </h2>

        </div>

        <div
            id="chatMessages"
            class="chat-messages">

            <div id="message">
                Loading messages...
            </div>

        </div>

        <form
            id="chatForm"
            class="chat-input">

            <input
                type="text"
                id="chatInput"
                placeholder="Type your message..."
                autocomplete="off"
                required
            >

            <button type="submit">
                Send
            </button>

        </form>

    </div>

</div>

<script src="chat.js"></script>

</body>
</html>