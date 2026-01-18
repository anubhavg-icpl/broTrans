// popup.js - BroTrans Gmail Assistant with Chrome Built-in AI (Gemini Nano)
// AI runs directly in popup (not service worker - API limitation)

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

// System prompt
const SYSTEM_PROMPT = `You are BroTrans, a helpful Gmail assistant. Be concise.

When users want to perform an action, respond with JSON:
{"action": "ACTION_NAME", "params": {}}

Actions: summarize_inbox, summarize_email, filter_unread, search (params: query), analyze_sentiment, draft_reply (params: text), open_email (params: index), scroll (params: direction)

Otherwise respond conversationally.`;

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

// Check AI availability and initialize
async function initAI() {
    updateStatus('loading', 'Checking AI...');

    // Check if API exists (new global namespace)
    if (typeof LanguageModel === 'undefined' && typeof ai === 'undefined') {
        updateStatus('error', 'AI not available');
        statusDetail.innerHTML = `Enable at:<br>chrome://flags/#prompt-api-for-gemini-nano<br>Then restart Chrome`;
        return;
    }

    try {
        // Try new API first (LanguageModel global), then fallback to ai.languageModel
        const api = typeof LanguageModel !== 'undefined' ? LanguageModel :
                    (typeof ai !== 'undefined' && ai.languageModel ? ai.languageModel : null);

        if (!api) {
            throw new Error('No AI API found');
        }

        updateStatus('loading', 'Checking model...');

        // Check availability
        const availability = await api.availability();
        console.log('[BroTrans] AI availability:', availability);

        if (availability === 'unavailable' || availability === 'no') {
            updateStatus('error', 'Model unavailable');
            statusDetail.textContent = 'Gemini Nano not supported on this device';
            return;
        }

        if (availability === 'downloadable' || availability === 'after-download') {
            updateStatus('loading', 'Model downloading...');
            statusDetail.textContent = 'Go to chrome://components and update "Optimization Guide On Device Model"';
        }

        // Create session
        updateStatus('loading', 'Loading model...');
        aiSession = await api.create({
            systemPrompt: SYSTEM_PROMPT
        });

        aiReady = true;
        updateStatus('ready', 'Ready');
        statusDetail.textContent = '';
        enableInputs();
        console.log('[BroTrans] AI ready');

    } catch (error) {
        console.error('[BroTrans] AI init error:', error);
        updateStatus('error', 'Init failed');
        statusDetail.textContent = error.message;
    }
}

// Update status
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
        return response?.emailContext || null;
    } catch (e) {
        console.warn('[BroTrans] Could not get email context:', e);
        return null;
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
        if (emailContext?.emails?.length > 0) {
            prompt += '\n\nInbox:\n' + emailContext.emails.slice(0, 10).map((e, i) =>
                `${i + 1}. ${e.unread ? '[UNREAD] ' : ''}From: ${e.sender} | ${e.subject}`
            ).join('\n');
        }
        if (emailContext?.openEmail) {
            const e = emailContext.openEmail;
            prompt += `\n\nOpen email:\nFrom: ${e.sender}\nSubject: ${e.subject}\n${e.body?.slice(0, 300)}...`;
        }

        // Generate response
        const response = await aiSession.prompt(prompt);

        // Parse action
        let action = null;
        const actionMatch = response.match(/\{[\s\S]*?"action"[\s\S]*?\}/);
        if (actionMatch) {
            try {
                action = JSON.parse(actionMatch[0]);
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
        msgEl.innerHTML = formatMessage(`Error: ${error.message}`);

        // Reset session on error
        if (error.message.includes('session') || error.message.includes('destroyed')) {
            aiSession = null;
            aiReady = false;
            updateStatus('error', 'Session expired');
            statusDetail.textContent = 'Refresh to restart';
            return;
        }
    } finally {
        isGenerating = false;
        updateStatus('ready', 'Ready');
        enableInputs();
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }
}

// Add message
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

// Format message
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
            addMessage(`Action failed: ${result.error}`, 'system');
        }
        return;
    }

    if (result.summary) {
        const s = result.summary;
        addMessage(`**Inbox:** ${s.total} emails, ${s.unread} unread, ${s.starred} starred`, 'system');
    }

    if (result.email) {
        const e = result.email;
        addMessage(`**Email:** From ${e.from} | ${e.subject}`, 'system');
    }

    if (result.message) {
        addMessage(result.message, 'system');
    }
}

// Disable inputs
function disableInputs() {
    sendBtn.disabled = true;
    quickActions.forEach(btn => btn.disabled = true);
}
