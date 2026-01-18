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

// System prompt
const SYSTEM_PROMPT = `You are BroTrans, a helpful Gmail assistant. Be concise.

When users want to perform an action, respond with JSON:
{"action": "ACTION_NAME", "params": {}}

Actions: summarize_inbox, summarize_email, filter_unread, search (params: query), analyze_sentiment, draft_reply (params: text), open_email (params: index), scroll (params: direction)

Otherwise respond conversationally.`;

// Error messages with helpful instructions
const ERROR_MESSAGES = {
    NO_API: {
        title: 'AI API Not Found',
        detail: `Enable Chrome flags:
1. chrome://flags/#optimization-guide-on-device-model → Enabled BypassPerfRequirement
2. chrome://flags/#prompt-api-for-gemini-nano → Enabled
3. Restart Chrome`,
        action: 'Open Chrome Flags',
        actionUrl: 'chrome://flags/#prompt-api-for-gemini-nano'
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
function showError(errorType, customMessage = null) {
    const error = ERROR_MESSAGES[errorType] || ERROR_MESSAGES.GENERIC;

    updateStatus('error', error.title);

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

    // Step 1: Check if API exists
    if (typeof LanguageModel === 'undefined' && typeof ai === 'undefined') {
        console.log('[BroTrans] No AI API found');
        showError('NO_API');
        return;
    }

    // Get API reference
    api = typeof LanguageModel !== 'undefined' ? LanguageModel :
          (typeof ai !== 'undefined' && ai.languageModel ? ai.languageModel : null);

    if (!api) {
        showError('NO_API');
        return;
    }

    try {
        updateStatus('loading', 'Checking model...');

        // Step 2: Check availability
        let availability;
        try {
            availability = await api.availability();
        } catch (e) {
            // availability() might fail if API is not fully ready
            console.error('[BroTrans] availability() failed:', e);
            showError('NO_API', `API check failed: ${e.message}`);
            return;
        }

        console.log('[BroTrans] AI availability:', availability);

        // Step 3: Handle different availability states
        switch (availability) {
            case 'unavailable':
            case 'no':
                showError('UNAVAILABLE');
                return;

            case 'downloadable':
            case 'after-download':
                showError('DOWNLOADING');
                // Try to trigger download by creating session
                updateStatus('loading', 'Downloading model...');
                break;

            case 'downloading':
                showError('INSTALL_INCOMPLETE');
                return;

            case 'available':
            case 'readily':
            case 'yes':
                // Model is ready, continue to create session
                break;

            default:
                console.warn('[BroTrans] Unknown availability:', availability);
                // Try to continue anyway
                break;
        }

        // Step 4: Create AI session
        updateStatus('loading', 'Starting AI...');

        try {
            aiSession = await api.create({
                systemPrompt: SYSTEM_PROMPT
            });
        } catch (createError) {
            console.error('[BroTrans] Session create error:', createError);

            const errorMsg = createError.message.toLowerCase();

            if (errorMsg.includes('disk') || errorMsg.includes('space')) {
                showError('DISK_SPACE');
            } else if (errorMsg.includes('download') || errorMsg.includes('install')) {
                showError('INSTALL_INCOMPLETE');
            } else if (errorMsg.includes('unavailable') || errorMsg.includes('not supported')) {
                showError('UNAVAILABLE');
            } else {
                showError('GENERIC', `Failed to start AI: ${createError.message}`);
            }
            return;
        }

        // Success!
        aiReady = true;
        updateStatus('ready', 'Ready');
        statusDetail.textContent = '';
        enableInputs();
        console.log('[BroTrans] AI ready!');

        // Show success message in chat
        addSystemMessage('Gemini Nano is ready! Open Gmail and ask me anything about your emails.');

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

// Handle send
async function handleSend() {
    const text = userInput.value.trim();
    if (!text || !aiReady || isGenerating) return;

    addMessage(text, 'user');

    userInput.value = '';
    userInput.style.height = 'auto';
    charCount.textContent = '';
    sendBtn.disabled = true;

    await generateResponse(text);
}

// Handle quick action
async function handleQuickAction(action) {
    if (!aiReady || isGenerating) return;

    const messages = {
        summarize_inbox: 'Summarize my inbox',
        filter_unread: 'Show my unread emails',
        summarize_email: 'Summarize the current email',
    };

    const message = messages[action] || action;
    addMessage(message, 'user');
    await generateResponse(message);
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
            if (emailContext?.emails?.length > 0) {
                prompt += '\n\nInbox:\n' + emailContext.emails.slice(0, 10).map((e, i) =>
                    `${i + 1}. ${e.unread ? '[UNREAD] ' : ''}From: ${e.sender} | ${e.subject}`
                ).join('\n');
            }
            if (emailContext?.openEmail) {
                const e = emailContext.openEmail;
                prompt += `\n\nOpen email:\nFrom: ${e.sender}\nSubject: ${e.subject}\n${e.body?.slice(0, 300)}...`;
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

    text = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    text = text.replace(/```([\s\S]*?)```/g, '<pre>$1</pre>');
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/^\s*[-*]\s+(.+)$/gm, '<li>$1</li>');
    text = text.replace(/\n/g, '<br>');

    return text;
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
