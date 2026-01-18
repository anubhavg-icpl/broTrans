// popup.js - BroTrans Gmail Assistant with Chrome Built-in AI (Gemini Nano)
// AI runs directly in popup (not service worker - API limitation)
// Comprehensive error handling for all Gemini Nano states

// DOM Elements
const statusBadge = document.getElementById('status-badge');
const statusText = document.getElementById('status-text');
const statusDetail = document.getElementById('status-detail');
const chatContainer = document.getElementById('chat-container');
const chatMessages = document.getElementById('chat-messages');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const charCount = document.getElementById('char-count');
const quickActions = document.querySelectorAll('.quick-action');

// State
let aiSession = null;
let aiReady = false;
let isGenerating = false;
let api = null;
let lastAvailability = null;

// System prompt for practical Gmail assistance
const SYSTEM_PROMPT = `You are BroTrans, a smart Gmail assistant. Be concise and actionable.

When summarizing emails, provide:
- Key points (what's important)
- Action items (what needs response/action)
- Priority level (urgent/normal/low)

For inbox summaries:
- Group by category (work, personal, notifications, promotions)
- Highlight urgent items first
- Mention unread count

When users want Gmail actions, respond with JSON:
{"action": "ACTION_NAME", "params": {}}

Actions: summarize_inbox, summarize_email, filter_unread, search (params: query), draft_reply (params: text), open_email (params: index)

Keep responses short and practical. Use bullet points.`;

// Diagnostic checks
async function runDiagnostics() {
    const results = {
        chromeVersion: null,
        hasLanguageModel: false,
        hasAiNamespace: false,
        availability: null,
        canCreate: false,
        error: null
    };

    // Check Chrome version
    const match = navigator.userAgent.match(/Chrome\/(\d+)/);
    results.chromeVersion = match ? parseInt(match[1]) : 'Unknown';

    // Check API availability
    results.hasLanguageModel = typeof LanguageModel !== 'undefined';
    results.hasAiNamespace = typeof ai !== 'undefined' && ai?.languageModel;

    // Check model availability
    if (results.hasLanguageModel || results.hasAiNamespace) {
        try {
            const api = results.hasLanguageModel ? LanguageModel : ai.languageModel;
            results.availability = await api.availability();
        } catch (e) {
            results.error = e.message;
        }
    }

    return results;
}

// Show diagnostic results
function showDiagnostics(results) {
    const checks = [
        {
            name: 'Chrome Version',
            status: results.chromeVersion >= 128 ? 'pass' : 'fail',
            value: `${results.chromeVersion} ${results.chromeVersion >= 128 ? '(OK)' : '(Need 128+)'}`
        },
        {
            name: 'LanguageModel API',
            status: results.hasLanguageModel ? 'pass' : 'fail',
            value: results.hasLanguageModel ? 'Available' : 'Not found'
        },
        {
            name: 'ai.languageModel API',
            status: results.hasAiNamespace ? 'pass' : 'warn',
            value: results.hasAiNamespace ? 'Available' : 'Not found'
        },
        {
            name: 'Model Status',
            status: results.availability === 'available' || results.availability === 'readily' ? 'pass' :
                    results.availability === 'downloadable' || results.availability === 'downloading' ? 'warn' : 'fail',
            value: results.availability || 'Unknown'
        }
    ];

    let html = '<div class="diagnostics"><div class="diag-title">System Check</div>';

    checks.forEach(check => {
        const icon = check.status === 'pass' ? '✓' : check.status === 'warn' ? '⚠' : '✗';
        const colorClass = check.status === 'pass' ? 'diag-pass' : check.status === 'warn' ? 'diag-warn' : 'diag-fail';
        html += `<div class="diag-row"><span class="diag-icon ${colorClass}">${icon}</span><span class="diag-name">${check.name}</span><span class="diag-value">${check.value}</span></div>`;
    });

    if (results.error) {
        html += `<div class="diag-error">Error: ${results.error}</div>`;
    }

    // Add setup instructions based on results
    if (!results.hasLanguageModel && !results.hasAiNamespace) {
        html += `<div class="diag-instructions">
            <strong>Enable these Chrome flags:</strong><br>
            1. <code>chrome://flags/#optimization-guide-on-device-model</code><br>
            → Set to "Enabled BypassPerfRequirement"<br><br>
            2. <code>chrome://flags/#prompt-api-for-gemini-nano</code><br>
            → Set to "Enabled"<br><br>
            3. Restart Chrome
        </div>`;
    } else if (results.availability === 'downloadable' || results.availability === 'after-download') {
        html += `<div class="diag-instructions">
            <strong>Model needs to download:</strong><br>
            Go to <code>chrome://on-device-internals</code><br>
            Wait for "Foundational model state: Ready"
        </div>`;
    } else if (results.availability === 'unavailable') {
        html += `<div class="diag-instructions">
            <strong>Device not supported:</strong><br>
            • Need 22GB+ free disk space<br>
            • macOS 13+ / Windows 10+ / Linux<br>
            • 4GB+ VRAM or 16GB+ RAM
        </div>`;
    }

    html += '<button class="error-action" onclick="location.reload()">Retry</button>';
    html += '</div>';

    statusDetail.innerHTML = html;
}

// Error messages with helpful instructions
const ERROR_MESSAGES = {
    NO_API: {
        title: 'Setup Required',
        detail: `Enable Chrome flags:
1. chrome://flags/#optimization-guide-on-device-model → Enabled BypassPerfRequirement
2. chrome://flags/#prompt-api-for-gemini-nano → Enabled
3. Restart Chrome`,
        action: 'Run Diagnostics',
        actionUrl: null,
        runDiagnostics: true
    },
    UNAVAILABLE: {
        title: 'Not Supported',
        detail: `Your device doesn't meet requirements:
• macOS 13+ / Windows 10+ / Linux / ChromeOS
• 22GB free disk space
• 4GB+ VRAM or 16GB RAM`,
        action: 'Check Requirements',
        actionUrl: 'chrome://on-device-internals'
    },
    DISK_SPACE: {
        title: 'Insufficient Disk Space',
        detail: `Gemini Nano needs ~22GB free space.
Current: Check chrome://on-device-internals
Free up disk space and restart Chrome.`,
        action: 'Check Status',
        actionUrl: 'chrome://on-device-internals'
    },
    DOWNLOADING: {
        title: 'Model Downloading',
        detail: `Gemini Nano is being downloaded (~2GB).
This may take a few minutes.
Check progress at chrome://on-device-internals`,
        action: 'Check Progress',
        actionUrl: 'chrome://on-device-internals'
    },
    INSTALL_INCOMPLETE: {
        title: 'Installation In Progress',
        detail: `Model is still installing.
Wait for completion at chrome://on-device-internals
"Foundational model state" should show "Ready"`,
        action: 'Check Status',
        actionUrl: 'chrome://on-device-internals'
    },
    SESSION_ERROR: {
        title: 'Session Error',
        detail: 'AI session was lost. Click to reinitialize.',
        action: 'Retry',
        actionUrl: null
    },
    PROMPT_API_DISABLED: {
        title: 'Prompt API Disabled',
        detail: `Enable PromptApi in chrome://on-device-internals
Under "Feature Adaptations", click "set to true" next to PromptApi`,
        action: 'Enable PromptApi',
        actionUrl: 'chrome://on-device-internals'
    },
    GENERIC: {
        title: 'Error',
        detail: 'Something went wrong. Check chrome://on-device-internals for details.',
        action: 'Check Status',
        actionUrl: 'chrome://on-device-internals'
    }
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initAI();

    userInput.addEventListener('input', handleInput);
    userInput.addEventListener('keydown', handleKeydown);
    sendBtn.addEventListener('click', handleSend);

    quickActions.forEach(btn => {
        btn.addEventListener('click', () => handleQuickAction(btn.dataset.action));
    });
});

// Show error with action button
async function showError(errorType, customMessage = null) {
    const error = ERROR_MESSAGES[errorType] || ERROR_MESSAGES.GENERIC;

    updateStatus('error', error.title);

    // Run diagnostics for setup errors
    if (error.runDiagnostics || errorType === 'NO_API' || errorType === 'UNAVAILABLE') {
        const results = await runDiagnostics();
        showDiagnostics(results);
        return;
    }

    // Create detailed error message with action button
    let html = `<div class="error-detail">${customMessage || error.detail.replace(/\n/g, '<br>')}</div>`;

    if (error.action) {
        if (error.actionUrl) {
            html += `<button class="error-action" onclick="copyToClipboard('${error.actionUrl}')">${error.action}</button>`;
            html += `<div class="error-hint">Click to copy URL, then paste in address bar</div>`;
        } else if (errorType === 'SESSION_ERROR') {
            html += `<button class="error-action" onclick="location.reload()">Retry</button>`;
        }
    }

    statusDetail.innerHTML = html;
}

// Copy URL to clipboard (chrome:// URLs can't be opened programmatically)
window.copyToClipboard = async function(url) {
    try {
        await navigator.clipboard.writeText(url);
        const btn = statusDetail.querySelector('.error-action');
        if (btn) {
            const originalText = btn.textContent;
            btn.textContent = 'Copied!';
            btn.classList.add('copied');
            setTimeout(() => {
                btn.textContent = originalText;
                btn.classList.remove('copied');
            }, 2000);
        }
    } catch (e) {
        console.error('Failed to copy:', e);
    }
};

// Check AI availability and initialize
async function initAI() {
    updateStatus('loading', 'Checking AI...');
    statusDetail.textContent = '';

    // Try multiple API access patterns
    api = null;

    // Try LanguageModel global (newer API)
    if (typeof LanguageModel !== 'undefined') {
        api = LanguageModel;
    }
    // Try window.ai.languageModel
    else if (typeof window.ai !== 'undefined' && window.ai?.languageModel) {
        api = window.ai.languageModel;
    }
    // Try self.ai.languageModel (extension context)
    else if (typeof self.ai !== 'undefined' && self.ai?.languageModel) {
        api = self.ai.languageModel;
    }

    if (!api) {
        showError('NO_API');
        return;
    }

    try {
        updateStatus('loading', 'Checking model...');

        // Check availability
        let availability;
        try {
            availability = await api.availability();
            lastAvailability = availability;
        } catch (e) {
            statusDetail.innerHTML = `<div class="error-detail">
                <strong>API check failed:</strong><br>
                ${e.message}<br>
                <button class="error-action" onclick="location.reload()">Retry</button>
            </div>`;
            updateStatus('error', 'API Check Failed');
            return;
        }

        // Handle different availability states

        // Normalize availability to string
        const availStr = String(availability).toLowerCase();

        if (availStr === 'unavailable' || availStr === 'no') {
            showError('UNAVAILABLE');
            return;
        }

        // If model needs download, show button (requires user gesture)
        if (availStr === 'downloadable' || availStr === 'after-download' || availStr === 'downloading') {
            updateStatus('loading', 'Model Ready to Download');
            statusDetail.innerHTML = `<div class="error-detail">
                <strong>Gemini Nano needs to download (~2GB)</strong><br><br>
                Click the button below to start. This is a one-time download.<br><br>
                <button class="error-action" id="download-model-btn">Download & Start AI</button>
            </div>`;

            // Add click handler for download button
            document.getElementById('download-model-btn').addEventListener('click', async () => {
                await createSession();
            });
            return;
        }

        // Step 4: Create AI session
        await createSession();
    } catch (error) {
        console.error('[BroTrans] AI init error:', error);
        showError('GENERIC', `Initialization failed: ${error.message}`);
    }
}

// Create AI session (must be called from user gesture if downloading)
async function createSession() {
    try {
        updateStatus('loading', 'Starting AI...');
        statusDetail.innerHTML = '<div class="error-detail">Connecting to Gemini Nano...<br>This may take a moment if model is downloading.</div>';

        try {
            // Add timeout for session creation (60s)
            const timeoutMs = 60000;
            const sessionPromise = api.create({
                systemPrompt: SYSTEM_PROMPT,
                expectedInputs: [{ type: 'text', languages: ['en'] }],
                expectedOutputs: [{ type: 'text', languages: ['en'] }],
                monitor(m) {
                    m.addEventListener('downloadprogress', (e) => {
                        const percent = Math.round(e.loaded * 100);
                        console.log(`[BroTrans] Download progress: ${percent}%`);
                        statusDetail.innerHTML = `<div class="error-detail">
                            <strong>Downloading Gemini Nano...</strong><br>
                            Progress: ${percent}%<br>
                            <div style="background:#49454F;border-radius:4px;height:8px;margin-top:8px;">
                                <div style="background:#D0BCFF;height:100%;border-radius:4px;width:${percent}%;transition:width 0.3s;"></div>
                            </div>
                        </div>`;
                    });
                }
            });

            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Session creation timed out after 60s. The model may still be downloading - check chrome://on-device-internals')), timeoutMs);
            });

            aiSession = await Promise.race([sessionPromise, timeoutPromise]);
        } catch (createError) {
            statusDetail.innerHTML = `<div class="error-detail">
                <strong>Session failed:</strong><br>
                ${createError.message}<br>
                <button class="error-action" onclick="location.reload()">Retry</button>
            </div>`;
            updateStatus('error', 'Session Failed');
            return;
        }

        // Success!
        aiReady = true;
        updateStatus('ready', 'Ready');
        statusDetail.textContent = '';
        enableInputs();

    } catch (error) {
        console.error('[BroTrans] AI init error:', error);
        showError('GENERIC', `Initialization failed: ${error.message}`);
    }
}

// Update status badge
function updateStatus(status, text) {
    statusBadge.className = 'status-badge ' + status;
    statusText.textContent = text;
}

// Enable inputs
function enableInputs() {
    userInput.disabled = false;
    userInput.placeholder = 'Ask about your emails...';
    sendBtn.disabled = false;
    quickActions.forEach(btn => btn.disabled = false);
}

// Disable inputs
function disableInputs() {
    sendBtn.disabled = true;
    quickActions.forEach(btn => btn.disabled = true);
}

// Handle input
function handleInput(e) {
    const text = e.target.value;
    charCount.textContent = text.length > 0 ? text.length + ' chars' : '';

    userInput.style.height = 'auto';
    userInput.style.height = Math.min(userInput.scrollHeight, 100) + 'px';

    sendBtn.disabled = !aiReady || !text.trim() || isGenerating;
}

// Handle keyboard
function handleKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
    }
}

// Handle send (with debounce)
let lastSend = 0;
async function handleSend() {
    // Prevent double-click (500ms debounce)
    const now = Date.now();
    if (now - lastSend < 500) return;
    lastSend = now;

    const text = userInput.value.trim();
    if (!text || !aiReady || isGenerating) return;

    addMessage(text, 'user');

    userInput.value = '';
    userInput.style.height = 'auto';
    charCount.textContent = '';
    sendBtn.disabled = true;

    await generateResponse(text);
}

// Handle quick action (with strict debounce)
let isProcessing = false;
async function handleQuickAction(action) {
    // Strict guard - only one action at a time
    if (isProcessing || !aiReady || isGenerating) {
        console.log('[BroTrans] Blocked duplicate action');
        return;
    }
    isProcessing = true;

    // Disable all buttons immediately
    quickActions.forEach(btn => btn.disabled = true);

    const messages = {
        summarize_inbox: 'Give me a quick overview of my inbox - categorize by type and highlight anything urgent',
        filter_unread: 'What urgent or important emails need my attention right now?',
        summarize_email: 'Summarize this email - key points, action items, and suggested reply if needed',
    };

    const message = messages[action] || action;
    addMessage(message, 'user');

    try {
        await generateResponse(message);
    } finally {
        isProcessing = false;
    }
}

// Get email context from Gmail
async function getEmailContext() {
    try {
        const response = await chrome.runtime.sendMessage({ action: 'get_email_context' });
        if (response?.error) {
            console.warn('[BroTrans] Gmail error:', response.error);
            return { error: response.error };
        }
        return response?.emailContext || null;
    } catch (e) {
        console.warn('[BroTrans] Could not get email context:', e);
        return { error: 'Open Gmail first' };
    }
}

// Execute action in Gmail
async function executeAction(action) {
    if (!action?.action) return null;
    try {
        return await chrome.runtime.sendMessage({
            action: 'execute_action',
            gmailAction: action.action,
            params: action.params || {}
        });
    } catch (e) {
        console.warn('[BroTrans] Could not execute action:', e);
        return { error: e.message };
    }
}

// Generate response
async function generateResponse(userMessage) {
    isGenerating = true;
    updateStatus('loading', 'Thinking...');
    disableInputs();

    const msgEl = addMessage('', 'assistant', true);

    try {
        // Get email context
        const emailContext = await getEmailContext();

        // Build prompt with context
        let prompt = userMessage;

        if (emailContext?.error) {
            prompt += `\n\n[Note: ${emailContext.error}]`;
        } else {
            const emails = emailContext?.emails || [];
            const unreadCount = emails.filter(e => e.unread).length;
            const totalVisible = emails.length;

            if (totalVisible > 0) {
                prompt += `\n\n📧 Inbox (${totalVisible} visible, ${unreadCount} unread):\n`;
                prompt += emails.slice(0, 25).map((e, i) =>
                    `${i + 1}. ${e.unread ? '🔵 ' : ''}${e.sender} - "${e.subject}" ${e.snippet ? `(${e.snippet.slice(0, 50)}...)` : ''}`
                ).join('\n');
            }

            if (emailContext?.openEmail) {
                const e = emailContext.openEmail;
                prompt += `\n\n📖 Currently Open Email:\nFrom: ${e.sender}\nSubject: ${e.subject}\nContent:\n${e.body?.slice(0, 500)}...`;
            }
        }

        // Generate response with timeout
        let response;
        try {
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Response timeout')), 30000)
            );
            response = await Promise.race([
                aiSession.prompt(prompt),
                timeoutPromise
            ]);
        } catch (promptError) {
            throw new Error(`AI response failed: ${promptError.message}`);
        }

        // Parse action
        let action = null;
        const actionMatch = response.match(/\{[\s\S]*?"action"[\s\S]*?\}/);
        if (actionMatch) {
            try {
                action = JSON.parse(actionMatch[0]);
                // Normalize to lowercase
                if (action.action) {
                    action.action = action.action.toLowerCase();
                }
            } catch (e) { }
        }

        // Clean response
        let cleanResponse = response;
        if (action) {
            cleanResponse = response.replace(/\{[\s\S]*?"action"[\s\S]*?\}/, '').trim();
            if (!cleanResponse) {
                cleanResponse = `Executing: ${action.action}`;
            }
        }

        msgEl.innerHTML = formatMessage(cleanResponse);

        // Execute action
        if (action) {
            const result = await executeAction(action);
            if (result) {
                handleActionResult(result);
            }
        }

    } catch (error) {
        console.error('[BroTrans] Generate error:', error);

        const errorMsg = error.message.toLowerCase();

        // Handle session errors
        if (errorMsg.includes('session') || errorMsg.includes('destroyed') || errorMsg.includes('invalid')) {
            msgEl.innerHTML = formatMessage('Session expired. Reinitializing...');
            aiSession = null;
            aiReady = false;

            // Try to reinitialize
            setTimeout(() => initAI(), 1000);
            return;
        }

        // Handle quota/rate limit
        if (errorMsg.includes('quota') || errorMsg.includes('rate') || errorMsg.includes('limit')) {
            msgEl.innerHTML = formatMessage('Rate limit reached. Please wait a moment and try again.');
            return;
        }

        // Generic error
        msgEl.innerHTML = formatMessage(`Error: ${error.message}`);

    } finally {
        isGenerating = false;
        if (aiReady) {
            updateStatus('ready', 'Ready');
            enableInputs();
        }
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }
}

// Add message to chat
function addMessage(content, role, isLoading = false) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    if (isLoading) {
        contentDiv.innerHTML = '<span class="typing-indicator"><span></span><span></span><span></span></span>';
    } else {
        contentDiv.innerHTML = formatMessage(content);
    }

    messageDiv.appendChild(contentDiv);
    chatMessages.appendChild(messageDiv);
    chatContainer.scrollTop = chatContainer.scrollHeight;

    return contentDiv;
}

// Add system message
function addSystemMessage(content) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message system';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.innerHTML = formatMessage(content);

    messageDiv.appendChild(contentDiv);
    chatMessages.appendChild(messageDiv);
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

// Format message text
function formatMessage(text) {
    if (!text) return '';

    // Escape HTML
    text = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    // Code blocks
    text = text.replace(/```([\s\S]*?)```/g, '<pre>$1</pre>');
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Bold
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Convert bullet points to proper list
    const lines = text.split('\n');
    let inList = false;
    let result = [];

    for (let line of lines) {
        const bulletMatch = line.match(/^[\s]*[-*•]\s+(.+)$/);
        const numberedMatch = line.match(/^[\s]*(\d+)[.)]\s+(.+)$/);

        if (bulletMatch) {
            if (!inList) {
                result.push('<ul class="response-list">');
                inList = true;
            }
            result.push(`<li>${bulletMatch[1]}</li>`);
        } else if (numberedMatch) {
            if (!inList) {
                result.push('<ul class="response-list">');
                inList = true;
            }
            result.push(`<li>${numberedMatch[2]}</li>`);
        } else {
            if (inList) {
                result.push('</ul>');
                inList = false;
            }
            if (line.trim()) {
                result.push(`<p>${line}</p>`);
            }
        }
    }

    if (inList) {
        result.push('</ul>');
    }

    return result.join('');
}

// Handle action result
function handleActionResult(result) {
    if (!result || result.error) {
        if (result?.error) {
            addSystemMessage(`Action failed: ${result.error}`);
        }
        return;
    }

    if (result.summary) {
        const s = result.summary;
        addSystemMessage(`**Inbox:** ${s.total} emails, ${s.unread} unread, ${s.starred} starred`);
    }

    if (result.email) {
        const e = result.email;
        addSystemMessage(`**Email:** From ${e.from} | ${e.subject}`);
    }

    if (result.message) {
        addSystemMessage(result.message);
    }
}
