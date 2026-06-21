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

    // Secure Event Delegation: Catching example clicks without global scope leaks
    const serverContainer = document.getElementById("servers");
    if (serverContainer) {
        serverContainer.addEventListener("click", (event) => {
            const exampleLink = event.target.closest(".mcp-example-link");
            if (exampleLink) {
                event.preventDefault();
                
                // Block interactions if button is explicitly disabled (server offline or request pending)
                if (exampleLink.classList.contains("disabled") || isRequestPending || !isServerOnline) return;
                
                const targetPrompt = exampleLink.getAttribute("data-prompt");
                if (targetPrompt) {
                    executeChatMessage(targetPrompt);
                }
            }
        });
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
            toggleExampleButtonsGUI(false);
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
            toggleExampleButtonsGUI(true);
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

// Helper routine to switch active states on interactive components
function toggleExampleButtonsGUI(shouldDisable) {
    document.querySelectorAll(".mcp-example-link").forEach(btn => {
        if (shouldDisable) {
            btn.classList.add("disabled");
        } else {
            // Only re-enable the button if its parent server context is online
            const serverBlock = btn.closest(".server");
            const isServerUp = serverBlock ? serverBlock.getAttribute("data-status") === "up" : true;
            if (isServerUp) {
                btn.classList.remove("disabled");
            }
        }
    });
}

// =====================================================
// LOAD SERVERS (DECOUPLED FROM INLINE GLOBAL LISTENERS)
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

        serversList.forEach((server, index) => {
            const status = server.status || "down";
            const isUp = status === "up";

            let serverHtml = `
            <div class="server" data-status="${status}">
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

            // --- RENDER EXAMPLES SECTION ---
            if (Array.isArray(server.examples) && server.examples.length > 0) {
                // Keep examples visible, but grey them out if the specific server is offline
                const isItemDisabled = isRequestPending || !isServerOnline || !isUp;
                const disableClass = isItemDisabled ? " disabled" : "";
                
                serverHtml += `
                    <div class="server-examples-container">
                        <span class="server-examples-title">Try Examples:</span>
                        <div class="server-examples-wrapper">
                `;
                server.examples.forEach(example => {
                    serverHtml += `
                        <a href="#" class="mcp-example-link${disableClass}" data-prompt="${escapeHtml(example)}">
                            💡 ${escapeHtml(example)}
                        </a>
                    `;
                });
                serverHtml += `
                        </div>
                    </div>
                `;
            }

            serverHtml += `</div>`;
            finalHtml += serverHtml;
        });

        container.innerHTML = finalHtml;

    } catch (error) {
        console.error("Failed to refresh servers:", error);
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
// CHAT HANDLERS & CORE CONTEXT PIPELINE
// =====================================================
async function handleChatSubmit(e) {
    e.preventDefault();

    if (isRequestPending || !isServerOnline) return;

    const promptInput = document.getElementById("prompt");
    const text = promptInput ? promptInput.value : "";

    if (!text) return;

    // Clear input field right away for explicit manual entries
    promptInput.value = "";
    
    await executeChatMessage(text);
}

// Unified transmission processor utilized by forms and example clicks alike
async function executeChatMessage(text) {
    if (isRequestPending || !isServerOnline) return;

    const chat = document.getElementById("chat");
    const sendBtn = document.querySelector("#chatForm button");
    const promptInput = document.getElementById("prompt");

    isRequestPending = true;
    toggleExampleButtonsGUI(true);

    // Lock Down GUI components to disable extra messages from firing
    if (sendBtn) {
        sendBtn.disabled = true;
        sendBtn.classList.add("loading");
        sendBtn.innerText = "Sending...";
    }
    if (promptInput) {
        promptInput.setAttribute("disabled", "true");
    }

    // Append User Prompt to view log
    if (chat) {
        chat.innerHTML += `<div class="user">${escapeHtml(text)}</div>`;
        chat.scrollTop = chat.scrollHeight;
    }

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

        // Restore form inputs and reset layout only if the gateway remains active
        if (isServerOnline) {
            toggleExampleButtonsGUI(false);
            if (sendBtn) {
                sendBtn.disabled = false;
                sendBtn.classList.remove("loading");
                sendBtn.innerText = "Send";
            }
            if (promptInput) {
                promptInput.removeAttribute("disabled");
                promptInput.placeholder = "Ask something...";
            }
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