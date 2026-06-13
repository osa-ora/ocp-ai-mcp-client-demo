let isRequestPending = false;

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
// LOAD SERVERS
// =====================================================
async function loadServers() {
    try {
        const response = await fetch("/servers");
        if (!response.ok) throw new Error("Network response was not ok");
        
        const data = await response.json();
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
                <div>${escapeHtml(server.transport)}</div>
                <small>${escapeHtml(server.url)}</small>
                <br><br>
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
        // This forces JavaScript to natively parse the string exactly like a browser JSON engine would,
        // instantly converting all \u00b0 and \ud83d\ude0e sequences into perfect visual emojis.
        return JSON.parse('"' + text.replace(/"/g, '\\"') + '"');
    } catch (e) {
        // Fallback just in case the string manipulation fails
        return text;
    }
}

// =====================================================
// CHAT HANDLER (WITH FIXED BUTTON LOCK)
// =====================================================
async function handleChatSubmit(e) {
    e.preventDefault();

    if (isRequestPending) return;

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

    // show user message immediately (safe)
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

        // SAFE render blocks AFTER data exists
        if (chat && Array.isArray(data.blocks)) {
            renderBlocks(data.blocks);
            chat.scrollTop = chat.scrollHeight;
        }

        // tools rendering
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
            // Read raw text, escape standard layout characters, then decode unicode hex characters cleanly
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

        if (sendBtn) {
            sendBtn.disabled = false;
            sendBtn.classList.remove("loading");
            sendBtn.innerText = "Send";
        }
    }
}

function addWelcomeMessage() {
    const chat = document.getElementById("chat");

    chat.innerHTML += `
        <div class="agent">
            <div class="answer">👋 Hi, how can I help you today?</div>
        </div>
    `;
}

function renderBlocks(blocks) {
    const chat = document.getElementById("chat");

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