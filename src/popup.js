// popup.js - Chat interface for BroTrans Gmail Assistant with WebLLM

// DOM Elements
const statusBadge = document.getElementById('status-badge');
const statusText = document.getElementById('status-text');
const progressContainer = document.getElementById('progress-container');
const progressFill = document.getElementById('progress-fill');
const progressText = document.getElementById('progress-text');
const progressDetail = document.getElementById('progress-detail');
const chatContainer = document.getElementById('chat-container');
const chatMessages = document.getElementById('chat-messages');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const charCount = document.getElementById('char-count');
const quickActions = document.querySelectorAll('.quick-action');

// State
let modelReady = false;
let isGenerating = false;
let streamingMessage = null;

// Track file downloads for WebLLM
const downloadProgress = new Map();

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadModel();

    // Event listeners
    userInput.addEventListener('input', handleInput);
    userInput.addEventListener('keydown', handleKeydown);
    sendBtn.addEventListener('click', handleSend);

    // Quick action buttons
    quickActions.forEach(btn => {
        btn.addEventListener('click', () => handleQuickAction(btn.dataset.action));
    });

    // Listen for model progress updates from background
    chrome.runtime.onMessage.addListener((message) => {
        if (message.type === 'model_progress') {
            updateLoadProgress(message.progress);
        }
    });
});

// Load the LLM model
async function loadModel() {
    updateStatus('loading', 'Loading Llama 3.2...');
    progressFill.classList.add('indeterminate');
    progressText.textContent = 'Initializing WebLLM...';
    progressDetail.textContent = 'First load downloads ~680MB model (cached after)';

    try {
        const response = await chrome.runtime.sendMessage({ action: 'load_model' });

        if (response?.success || response?.loaded) {
            modelReady = true;
            updateStatus('ready', 'Ready');
            enableInputs();
            progressContainer.classList.add('hidden');
        } else if (response?.error) {
            updateStatus('error', 'Load failed');
            progressText.textContent = response.error;
            progressDetail.textContent = 'Try refreshing the extension';
        }
    } catch (error) {
        console.error('[BroTrans] Model load error:', error);
        updateStatus('error', 'Load failed');
        progressText.textContent = error.message;
        progressDetail.textContent = 'Try refreshing the extension';
    }
}

// Update loading progress - WebLLM format
function updateLoadProgress(progress) {
    console.log('[BroTrans Popup] Progress:', progress);

    // WebLLM uses { text: string, progress: number } format
    if (progress.text) {
        progressText.textContent = progress.text;

        if (typeof progress.progress === 'number') {
            const percent = Math.round(progress.progress * 100);
            progressFill.classList.remove('indeterminate');
            progressFill.style.width = `${percent}%`;
            updateStatus('loading', `Loading ${percent}%`);

            // Extract file info if available
            const fileMatch = progress.text.match(/Loading model from cache\[(\d+)\/(\d+)\]/);
            if (fileMatch) {
                progressDetail.textContent = `File ${fileMatch[1]} of ${fileMatch[2]}`;
            } else if (progress.text.includes('Fetching')) {
                progressDetail.textContent = 'Downloading model files...';
            } else if (progress.text.includes('Loading')) {
                progressDetail.textContent = 'Loading into memory...';
            }
        }
        return;
    }

    // Fallback: Handle transformers.js style progress
    const fileName = progress.file ? progress.file.split('/').pop() : (progress.name || 'model');

    if (progress.status === 'progress' && progress.total > 0) {
        downloadProgress.set(progress.file || progress.name, {
            loaded: progress.loaded,
            total: progress.total
        });

        let overallLoaded = 0;
        let overallTotal = 0;
        downloadProgress.forEach(({ loaded, total }) => {
            overallLoaded += loaded;
            overallTotal += total;
        });

        const percent = Math.round((overallLoaded / overallTotal) * 100);
        progressFill.classList.remove('indeterminate');
        progressFill.style.width = `${percent}%`;

        progressText.textContent = `${fileName}: ${formatBytes(progress.loaded)} / ${formatBytes(progress.total)}`;
        progressDetail.textContent = `Total: ${formatBytes(overallLoaded)} / ${formatBytes(overallTotal)}`;
        updateStatus('loading', `Downloading ${percent}%`);

    } else if (progress.status === 'ready' || progress.status === 'done') {
        progressText.textContent = 'Model loaded successfully!';
        progressDetail.textContent = 'Ready to chat';
        progressFill.style.width = '100%';
        progressFill.classList.remove('indeterminate');

    } else if (progress.status === 'initiate') {
        progressText.textContent = `Initializing: ${fileName}...`;
        progressDetail.textContent = 'Preparing model files';
        progressFill.classList.add('indeterminate');

    } else if (progress.status === 'download') {
        progressText.textContent = `Starting: ${fileName}`;
        progressDetail.textContent = 'Beginning download...';
    }
}

// Format bytes to human readable
function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

// Update status badge
function updateStatus(status, text) {
    statusBadge.className = 'status-badge ' + status;
    statusText.textContent = text;
}

// Enable inputs after model loads
function enableInputs() {
    userInput.disabled = false;
    userInput.placeholder = 'Ask about your emails...';
    sendBtn.disabled = false;
    quickActions.forEach(btn => btn.disabled = false);
}

// Handle input changes
function handleInput(e) {
    const text = e.target.value;

    if (text.length > 0) {
        charCount.textContent = text.length + ' chars';
    } else {
        charCount.textContent = '';
    }

    // Auto-resize textarea
    userInput.style.height = 'auto';
    userInput.style.height = Math.min(userInput.scrollHeight, 100) + 'px';

    sendBtn.disabled = !modelReady || !text.trim() || isGenerating;
}

// Handle keyboard events
function handleKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
    }
}

// Handle send button click
async function handleSend() {
    const text = userInput.value.trim();
    if (!text || !modelReady || isGenerating) return;

    addMessage(text, 'user');

    userInput.value = '';
    userInput.style.height = 'auto';
    charCount.textContent = '';
    sendBtn.disabled = true;

    await generateResponse(text);
}

// Handle quick action buttons
async function handleQuickAction(action) {
    if (!modelReady || isGenerating) return;

    const actionMessages = {
        summarize_inbox: 'Summarize my inbox',
        filter_unread: 'Show my unread emails',
        summarize_email: 'Summarize the current email',
    };

    const message = actionMessages[action] || action;
    addMessage(message, 'user');
    await generateResponse(message);
}

// Generate LLM response - with streaming support
async function generateResponse(userMessage) {
    isGenerating = true;
    updateStatus('loading', 'Thinking...');
    disableInputs();

    streamingMessage = addMessage('', 'assistant', true);

    try {
        // Try streaming first via port
        const useStreaming = false; // Set to true to enable streaming

        if (useStreaming) {
            await generateResponseStreaming(userMessage);
        } else {
            // Non-streaming request
            const response = await chrome.runtime.sendMessage({
                action: 'chat',
                userMessage,
            });

            if (response?.success) {
                finalizeStreamingMessage(response.response);

                if (response.actionResult) {
                    handleActionResult(response.actionResult);
                }
            } else if (response?.error) {
                finalizeStreamingMessage(`Error: ${response.error}`);
            }
        }
    } catch (error) {
        console.error('[BroTrans] Generate error:', error);
        finalizeStreamingMessage(`Error: ${error.message}`);
    } finally {
        isGenerating = false;
        streamingMessage = null;
        updateStatus('ready', 'Ready');
        enableInputs();
    }
}

// Generate response with streaming
async function generateResponseStreaming(userMessage) {
    return new Promise((resolve, reject) => {
        const port = chrome.runtime.connect({ name: 'chat_stream' });

        port.onMessage.addListener((message) => {
            if (message.type === 'chunk') {
                updateStreamingMessage(message.fullResponse);
            } else if (message.type === 'action') {
                if (message.actionResult) {
                    handleActionResult(message.actionResult);
                }
            } else if (message.type === 'done') {
                resolve();
            } else if (message.type === 'error') {
                finalizeStreamingMessage(`Error: ${message.error}`);
                reject(new Error(message.error));
            }
        });

        port.onDisconnect.addListener(() => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            }
        });

        port.postMessage({ userMessage });
    });
}

// Add message to chat
function addMessage(content, role, isStreaming = false) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    if (isStreaming) {
        contentDiv.innerHTML = '<span class="typing-indicator"><span></span><span></span><span></span></span>';
    } else {
        contentDiv.innerHTML = formatMessage(content);
    }

    messageDiv.appendChild(contentDiv);
    chatMessages.appendChild(messageDiv);

    chatContainer.scrollTop = chatContainer.scrollHeight;

    return contentDiv;
}

// Update streaming message
function updateStreamingMessage(text) {
    if (streamingMessage) {
        streamingMessage.innerHTML = formatMessage(text);
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }
}

// Finalize streaming message
function finalizeStreamingMessage(text) {
    if (streamingMessage) {
        streamingMessage.innerHTML = formatMessage(text);
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }
}

// Format message content (basic markdown-like formatting)
function formatMessage(text) {
    if (!text) return '';

    // Escape HTML
    text = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    // Format JSON blocks
    text = text.replace(/```json([\s\S]*?)```/g, '<pre class="json">$1</pre>');
    text = text.replace(/```([\s\S]*?)```/g, '<pre>$1</pre>');

    // Format inline code
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Format bold
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Format lists
    text = text.replace(/^\s*[-*]\s+(.+)$/gm, '<li>$1</li>');
    text = text.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');

    // Format numbered lists
    text = text.replace(/^\s*\d+\.\s+(.+)$/gm, '<li>$1</li>');

    // Format line breaks
    text = text.replace(/\n/g, '<br>');

    return text;
}

// Handle action results
function handleActionResult(result) {
    if (!result || result.error) {
        if (result?.error) {
            addMessage(`Action failed: ${result.error}`, 'system');
        }
        return;
    }

    if (result.summary) {
        const summary = result.summary;
        const summaryText = `
**Inbox Summary:**
- Total emails: ${summary.total}
- Unread: ${summary.unread}
- Starred: ${summary.starred}
- Top senders: ${summary.topSenders?.join(', ') || 'N/A'}
        `.trim();
        addMessage(summaryText, 'system');
    }

    if (result.email) {
        const email = result.email;
        const emailText = `
**Email Details:**
- From: ${email.from}
- Subject: ${email.subject}
- Date: ${email.date}
- Words: ${email.wordCount}
        `.trim();
        addMessage(emailText, 'system');
    }

    if (result.message) {
        addMessage(result.message, 'system');
    }
}

// Disable inputs during generation
function disableInputs() {
    sendBtn.disabled = true;
    quickActions.forEach(btn => btn.disabled = true);
}
