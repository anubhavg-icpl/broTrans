// popup.js - BroTrans Gmail Assistant with Gemini Nano

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
let aiReady = false;
let isGenerating = false;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    checkAI();

    userInput.addEventListener('input', handleInput);
    userInput.addEventListener('keydown', handleKeydown);
    sendBtn.addEventListener('click', handleSend);

    quickActions.forEach(btn => {
        btn.addEventListener('click', () => handleQuickAction(btn.dataset.action));
    });
});

// Check AI availability
async function checkAI() {
    updateStatus('loading', 'Checking AI...');

    try {
        const response = await chrome.runtime.sendMessage({ action: 'check_ai' });

        if (response?.available) {
            // AI available, now load it
            updateStatus('loading', 'Loading Gemini Nano...');
            const loadResult = await chrome.runtime.sendMessage({ action: 'load_model' });

            if (loadResult?.success) {
                aiReady = true;
                updateStatus('ready', 'Ready');
                statusDetail.textContent = '';
                enableInputs();
            } else {
                updateStatus('error', 'Load failed');
                statusDetail.textContent = loadResult?.error || 'Unknown error';
            }
        } else {
            updateStatus('error', 'AI not available');
            statusDetail.textContent = response?.error || 'Enable Gemini Nano in chrome://flags';
        }
    } catch (error) {
        console.error('[BroTrans] Check AI error:', error);
        updateStatus('error', 'Error');
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

    // Auto-resize
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

// Generate response
async function generateResponse(userMessage) {
    isGenerating = true;
    updateStatus('loading', 'Thinking...');
    disableInputs();

    const msgEl = addMessage('', 'assistant', true);

    try {
        const response = await chrome.runtime.sendMessage({
            action: 'chat',
            userMessage,
        });

        if (response?.success) {
            msgEl.innerHTML = formatMessage(response.response);

            if (response.actionResult) {
                handleActionResult(response.actionResult);
            }
        } else {
            msgEl.innerHTML = formatMessage(`Error: ${response?.error || 'Unknown error'}`);
        }
    } catch (error) {
        console.error('[BroTrans] Generate error:', error);
        msgEl.innerHTML = formatMessage(`Error: ${error.message}`);
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
