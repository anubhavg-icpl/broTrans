// popup.js - BroTrans Gmail Assistant with Transformers.js
// Uses SmolLM-360M-Instruct for local AI inference

import { pipeline, env } from '@huggingface/transformers';

// Configure transformers.js for browser
env.allowLocalModels = false;
env.useBrowserCache = true;

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
let generator = null;
let isReady = false;
let isGenerating = false;

// Model config - SmolLM is small but capable
const MODEL_ID = 'HuggingFaceTB/SmolLM-360M-Instruct';

// System prompt for Gmail assistant
const SYSTEM_PROMPT = `You are BroTrans, a helpful Gmail assistant. Be concise and helpful.

When users want to perform an action, respond with a JSON command:
{"action": "ACTION_NAME", "params": {}}

Available actions:
- summarize_inbox: Summarize visible emails
- summarize_email: Summarize the currently open email
- filter_unread: Show only unread emails
- search: Search emails (params: {query: "search terms"})
- analyze_sentiment: Analyze the tone of the open email
- draft_reply: Draft a reply (params: {text: "reply text"})
- open_email: Open email by number (params: {index: 0})
- scroll: Scroll the inbox (params: {direction: "up" or "down"})

For questions or conversation, respond naturally without JSON.`;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initModel();

    userInput.addEventListener('input', handleInput);
    userInput.addEventListener('keydown', handleKeydown);
    sendBtn.addEventListener('click', handleSend);

    quickActions.forEach(btn => {
        btn.addEventListener('click', () => handleQuickAction(btn.dataset.action));
    });
});

// Load the model
async function initModel() {
    updateStatus('loading', 'Loading AI model...');
    statusDetail.textContent = 'First load downloads ~720MB (cached after)';

    try {
        generator = await pipeline('text-generation', MODEL_ID, {
            dtype: 'q4',  // 4-bit quantization for smaller size
            device: 'wasm', // Use WASM (works everywhere)
            progress_callback: (progress) => {
                if (progress.status === 'downloading') {
                    const pct = Math.round((progress.loaded / progress.total) * 100);
                    statusDetail.textContent = `Downloading: ${pct}%`;
                } else if (progress.status === 'loading') {
                    statusDetail.textContent = 'Loading model into memory...';
                }
            }
        });

        isReady = true;
        updateStatus('ready', 'Ready');
        statusDetail.textContent = '';
        enableInputs();
        console.log('[BroTrans] Model loaded successfully');

    } catch (error) {
        console.error('[BroTrans] Model load error:', error);
        updateStatus('error', 'Load failed');
        statusDetail.textContent = error.message;
    }
}

// Update status display
function updateStatus(status, text) {
    statusBadge.className = 'status-badge ' + status;
    statusText.textContent = text;
}

// Enable UI inputs
function enableInputs() {
    userInput.disabled = false;
    userInput.placeholder = 'Ask about your emails...';
    sendBtn.disabled = false;
    quickActions.forEach(btn => btn.disabled = false);
}

// Disable UI inputs
function disableInputs() {
    sendBtn.disabled = true;
    quickActions.forEach(btn => btn.disabled = true);
}

// Handle text input
function handleInput(e) {
    const text = e.target.value;
    charCount.textContent = text.length > 0 ? text.length + ' chars' : '';

    // Auto-resize textarea
    userInput.style.height = 'auto';
    userInput.style.height = Math.min(userInput.scrollHeight, 100) + 'px';

    sendBtn.disabled = !isReady || !text.trim() || isGenerating;
}

// Handle keyboard shortcuts
function handleKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
    }
}

// Handle send button
async function handleSend() {
    const text = userInput.value.trim();
    if (!text || !isReady || isGenerating) return;

    addMessage(text, 'user');

    userInput.value = '';
    userInput.style.height = 'auto';
    charCount.textContent = '';
    sendBtn.disabled = true;

    await generateResponse(text);
}

// Handle quick action buttons
async function handleQuickAction(action) {
    if (!isReady || isGenerating) return;

    const messages = {
        summarize_inbox: 'Summarize my inbox',
        filter_unread: 'Show my unread emails',
        summarize_email: 'Summarize the current email',
    };

    const message = messages[action] || action;
    addMessage(message, 'user');
    await generateResponse(message);
}

// Get email context from Gmail via background script
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

// Generate AI response
async function generateResponse(userMessage) {
    isGenerating = true;
    updateStatus('loading', 'Thinking...');
    disableInputs();

    const msgEl = addMessage('', 'assistant', true);

    try {
        // Get email context from Gmail
        const emailContext = await getEmailContext();

        // Build prompt with context
        let contextStr = '';
        if (emailContext?.emails?.length > 0) {
            contextStr += '\n\nCurrent inbox:\n' + emailContext.emails.slice(0, 10).map((e, i) =>
                `${i + 1}. ${e.unread ? '[UNREAD] ' : ''}From: ${e.sender} | Subject: ${e.subject}`
            ).join('\n');
        }
        if (emailContext?.openEmail) {
            const e = emailContext.openEmail;
            contextStr += `\n\nCurrently open email:\nFrom: ${e.sender}\nSubject: ${e.subject}\nContent: ${e.body?.slice(0, 500)}...`;
        }

        // Format as chat
        const prompt = `<|im_start|>system
${SYSTEM_PROMPT}${contextStr}
<|im_end|>
<|im_start|>user
${userMessage}
<|im_end|>
<|im_start|>assistant
`;

        // Generate response
        const result = await generator(prompt, {
            max_new_tokens: 256,
            temperature: 0.7,
            do_sample: true,
            top_p: 0.9,
            repetition_penalty: 1.1,
        });

        // Extract response text
        let response = result[0].generated_text;
        // Remove the prompt from output
        response = response.split('<|im_start|>assistant\n').pop();
        response = response.split('<|im_end|>')[0].trim();

        // Check for action JSON
        let action = null;
        const actionMatch = response.match(/\{[\s\S]*?"action"[\s\S]*?\}/);
        if (actionMatch) {
            try {
                action = JSON.parse(actionMatch[0]);
            } catch (e) { }
        }

        // Clean response for display
        let cleanResponse = response;
        if (action) {
            cleanResponse = response.replace(/\{[\s\S]*?"action"[\s\S]*?\}/, '').trim();
            if (!cleanResponse) {
                cleanResponse = `Executing: ${action.action}`;
            }
        }

        msgEl.innerHTML = formatMessage(cleanResponse);

        // Execute action if found
        if (action) {
            const result = await executeAction(action);
            if (result) {
                handleActionResult(result);
            }
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

// Format message text with markdown-like styling
function formatMessage(text) {
    if (!text) return '';

    // Escape HTML
    text = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    // Simple markdown
    text = text.replace(/```([\s\S]*?)```/g, '<pre>$1</pre>');
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/^\s*[-*]\s+(.+)$/gm, '<li>$1</li>');
    text = text.replace(/\n/g, '<br>');

    return text;
}

// Handle action results from Gmail
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
