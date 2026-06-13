let isRequestPending = false;
let isServerOnline = true; // Tracks the last known connection state to manage welcome messages

// Run everything safely after DOM loads
document.addEventListener("DOMContentLoaded", () => {
    loadServers();
    setInterval(loadServers, 30000);

    const chatForm = document.getElementById("chatForm");
    if (chatForm) {
        chatForm.addEventListener("submit", handleChatSubmit);
    }
});

// =====================================================
// UPDATE STATUS BADGE & INPUT GUI ACTIONS
// =====================================================
function updateStatusGUI(isOnline) {
    const badge = document.getElementById("status-badge");
    const sendBtn = document.querySelector("#chatForm button");
    const promptInput = document.getElementById("prompt");
    const chat = document.getElementById("chat");
    
    if (!badge) return;

    if (isOnline) {
        badge.textContent = "Online";
        badge.className = "status-badge online";
        
        // If the system was previously offline, unlock and announce recovery
        if (!isServerOnline) {
            isServerOnline = true;
            
            if (sendBtn && !isRequestPending) {
                sendBtn.disabled = false;
                sendBtn.innerText = "Send";
            }
            if (promptInput) {
                promptInput.removeAttribute("disabled");
                promptInput.placeholder = "Ask something...";
            }
            if (chat) {
                chat.innerHTML += `
                    <div class="agent">
                        <div class="answer">🟢 <b>System Update:</b> The connection is restored! The system is back online and ready for your requests.</div>
                    </div>
                `;
                chat.scrollTop = chat.scrollHeight;
            }
        }
    } else {
        badge.textContent = "Offline";
        badge.className = "status-badge offline";
        
        // If the system was previously online, lock elements and notify state
        if (isServerOnline) {
            isServerOnline = false;
            
            if (sendBtn) {
                sendBtn.disabled = true;
                sendBtn.innerText = "System Offline...";
            }
            if (promptInput) {
                promptInput.setAttribute("disabled", "true");
                promptInput.placeholder = "Please wait till the system is back...";
            }
            if (chat) {
                chat.innerHTML += `
                    <div class="agent">
                        <div class="answer">⚠️ <b>Connection Lost:</b> Unstable gateway configuration detected. Please wait while the system attempts to reconnect...</div>
                    </div>
                `;
                chat.scrollTop = chat.scrollHeight;
            }
        }
    }
}

// =====================================================
// LOAD SERVERS (WITH GUI STATUS DETECTOR)
// =====================================================
async function loadServers() {
    try {
        const response = await fetch("/servers");
        if (!response.ok) throw new Error("Network response was not ok");
        
        const data = await response.json();
        
        // Network connection is functional: Update UI to Online
        updateStatusGUI(true);

        const container = document.getElementById("servers");
        if (!container) return;

        let finalHtml = "";
        const serversList = data.servers || [];

        serversList.forEach(server => {
            const status = server.status || "down";
            const isUp = status === "up";

            let serverHtml = `
            <div class="server">
                <h3>
                    <span style="
                        display:inline-block;
                        width:10px;
                        height:10px;
                        border-radius:50%;
                        margin-right:6px;
                        background:${isUp ? "limegreen" : "red"};
                    "></span>
                    ${escapeHtml(server.name)}
                </h3>
                <div>${escapeHtml(server.url)} (${escapeHtml(server.transport)})</div>
                <br>
            `;

            if (Array.isArray(server.tools)) {
                server.tools.forEach(tool => {
                    serverHtml += `
                        <div class="tool" title="${escapeHtml(tool.description || "")}">
                            <strong>${escapeHtml(tool.name)}</strong>
                        </div>
                    `;
                });
            }

            serverHtml += `</div>`;
            finalHtml += serverHtml;
        });

        container.innerHTML = finalHtml;

    } catch (error) {
        console.error("Failed to refresh servers:", error);
        
        // Catch network connection loss / TypeError: Update UI to Offline
        updateStatusGUI(false);
    }
}

// =====================================================
// SAFE HTML ESCAPE
// =====================================================
function escapeHtml(text) {
    if (!text) return "";
    return text
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}

// =====================================================
// UNICODE ESCAPE DECODER (BULLETPROOF VERSION)
// =====================================================
function decodeUnicode(text) {
    if (!text) return "";
    try {
        return JSON.parse('"' + text.replace(/"/g, '\\"') + '"');
    } catch (e) {
        return text;
    }
}

// =====================================================
// CHAT HANDLER (WITH FIXED BUTTON LOCK)
// =====================================================
async function handleChatSubmit(e) {
    e.preventDefault();

    // Prevent submission if a request is already pending or if the server is down
    if (isRequestPending || !isServerOnline) return;

    const prompt = document.getElementById("prompt");
    const text = prompt ? prompt.value : "";

    if (!text) return;

    const chat = document.getElementById("chat");
    const sendBtn = document.querySelector("#chatForm button");

    isRequestPending = true;

    if (sendBtn) {
        sendBtn.disabled = true;
        sendBtn.classList.add("loading");
        sendBtn.innerText = "Sending...";
    }

    if (chat) {
        chat.innerHTML += `<div class="user">${escapeHtml(text)}</div>`;
        chat.scrollTop = chat.scrollHeight;
    }

    prompt.value = "";

    try {
        const response = await fetch("/chat", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                message: text
            })
        });

        const data = await response.json();

        if (chat && Array.isArray(data.blocks)) {
            renderBlocks(data.blocks);
            chat.scrollTop = chat.scrollHeight;
        }

        let toolHtml = "";

        if (Array.isArray(data.tools) && data.tools.length > 0) {
            toolHtml = `<div class="tools-used">`;
            data.tools.forEach(t => {
                toolHtml += `
                    <div class="tool-box">
                        <div><b>Tool:</b> ${escapeHtml(t.tool)} - <b>MCP Server:</b> ${escapeHtml(t.server)}</div>
                    </div>
                `;
            });
            toolHtml += `</div>`;
        }

        if (chat) {
            const rawAnswer = data.response || data.answer || "";
            const cleanDisplayAnswer = decodeUnicode(escapeHtml(rawAnswer));

            chat.innerHTML += `
                <div class="agent">
                    <div class="answer">${cleanDisplayAnswer}</div>
                    ${toolHtml}
                </div>
            `;
            chat.scrollTop = chat.scrollHeight;
        }

    } catch (err) {
        console.error("Chat error:", err);
    } finally {
        isRequestPending = false;

        // Only restore the send button if the server didn't drop offline while waiting
        if (sendBtn && isServerOnline) {
            sendBtn.disabled = false;
            sendBtn.classList.remove("loading");
            sendBtn.innerText = "Send";
        }
    }
}

function addWelcomeMessage() {
    const chat = document.getElementById("chat");
    if (!chat) return;

    chat.innerHTML += `
        <div class="agent">
            <div class="answer">👋 Hi, how can I help you today?</div>
        </div>
    `;
}

function renderBlocks(blocks) {
    const chat = document.getElementById("chat");
    if (!chat) return;

    let html = "";

    blocks.forEach(b => {
        if (b.kind === "text") {
            html += `<div class="text">${decodeUnicode(escapeHtml(b.value))}</div>`;
        }

        if (b.kind === "kv") {
            html += `<div class="kv">`;

            for (const [k, v] of Object.entries(b.data)) {
                html += `<div><b>${escapeHtml(k)}:</b> ${decodeUnicode(escapeHtml(v))}</div>`;
            }

            html += `</div>`;
        }

        if (b.kind === "table") {
            html += `<table><tr>`;

            b.columns.forEach(c => {
                html += `<th>${escapeHtml(c)}</th>`;
            });

            html += `</tr>`;

            b.rows.forEach(r => {
                html += `<tr>`;
                r.forEach(cell => {
                    html += `<td>${decodeUnicode(escapeHtml(cell))}</td>`;
                });
                html += `</tr>`;
            });

            html += `</table>`;
        }
    });

    chat.innerHTML += `<div class="agent">${html}</div>`;
}

addWelcomeMessage();