// background.js - Service worker for BroTrans Gmail Assistant
// Uses WebLLM for local LLM inference in Chrome extension service worker

import { CreateServiceWorkerMLCEngine } from '@mlc-ai/web-llm';

// Model configuration - using Llama 3.2 1B Instruct (quantized for efficiency)
const MODEL_ID = 'Llama-3.2-1B-Instruct-q4f16_1-MLC';

// Engine singleton
let engine = null;
let isLoading = false;
let isLoaded = false;

// System prompt for Gmail assistant
const SYSTEM_PROMPT = `You are BroTrans, a helpful Gmail assistant. You help users manage their emails efficiently.

When users ask about their emails, you should:
1. Provide concise, helpful responses
2. Suggest relevant actions when appropriate
3. Be friendly but professional

You can help with:
- Summarizing emails and inbox
- Finding specific emails
- Analyzing email sentiment/tone
- Drafting replies
- Navigating Gmail

When you determine a user wants to perform an action, respond with JSON in this exact format:
{"action": "ACTION_NAME", "params": {}}

Available actions:
- summarize_inbox: Get summary of visible emails
- summarize_email: Summarize the currently open email
- filter_unread: Show only unread emails
- search: Search for emails (params: {"query": "search term"})
- analyze_sentiment: Analyze tone of current email
- draft_reply: Help draft a reply (params: {"text": "draft text"})
- open_email: Open an email by index (params: {"index": 0})
- scroll: Scroll the inbox (params: {"direction": "up|down"})

If no action is needed, just respond conversationally.`;

// Initialize WebLLM engine
async function initializeEngine(progressCallback) {
    if (engine) return engine;
    if (isLoading) {
        // Wait for existing load to complete
        while (isLoading) {
            await new Promise(r => setTimeout(r, 100));
        }
        return engine;
    }

    isLoading = true;

    try {
        console.log('[BroTrans] Initializing WebLLM engine...');

        engine = await CreateServiceWorkerMLCEngine(MODEL_ID, {
            initProgressCallback: (progress) => {
                console.log('[BroTrans] Progress:', progress);
                if (progressCallback) {
                    progressCallback(progress);
                }
                // Broadcast progress to popup
                chrome.runtime.sendMessage({
                    type: 'model_progress',
                    progress: progress
                }).catch(() => { });
            }
        });

        isLoaded = true;
        console.log('[BroTrans] WebLLM engine ready');
        return engine;

    } catch (error) {
        console.error('[BroTrans] Failed to initialize engine:', error);
        throw error;
    } finally {
        isLoading = false;
    }
}

// Generate response using LLM
async function generateResponse(userMessage, emailContext) {
    const llm = await initializeEngine();

    // Build context message
    let contextInfo = '';
    if (emailContext?.emails) {
        contextInfo = `\n\nCurrent inbox context:\n${emailContext.emails.map((e, i) =>
            `${i + 1}. From: ${e.sender} | Subject: ${e.subject} | ${e.unread ? 'UNREAD' : 'read'}`
        ).join('\n')}`;
    }
    if (emailContext?.openEmail) {
        contextInfo += `\n\nCurrently open email:\nFrom: ${emailContext.openEmail.sender}\nSubject: ${emailContext.openEmail.subject}\nContent: ${emailContext.openEmail.body?.slice(0, 500)}...`;
    }

    const messages = [
        { role: 'system', content: SYSTEM_PROMPT + contextInfo },
        { role: 'user', content: userMessage }
    ];

    try {
        const response = await llm.chat.completions.create({
            messages,
            temperature: 0.7,
            max_tokens: 512,
        });

        const responseText = response.choices[0]?.message?.content || '';

        // Try to parse action from response
        let action = null;
        const actionMatch = responseText.match(/\{[\s\S]*"action"[\s\S]*\}/);
        if (actionMatch) {
            try {
                action = JSON.parse(actionMatch[0]);
            } catch (e) {
                // Not valid JSON, ignore
            }
        }

        // Clean response (remove action JSON if present)
        let cleanResponse = responseText;
        if (action) {
            cleanResponse = responseText.replace(/\{[\s\S]*"action"[\s\S]*\}/, '').trim();
            if (!cleanResponse) {
                cleanResponse = getActionConfirmation(action);
            }
        }

        return {
            response: cleanResponse,
            action: action
        };

    } catch (error) {
        console.error('[BroTrans] Generation error:', error);
        throw error;
    }
}

// Generate streaming response
async function* generateResponseStream(userMessage, emailContext) {
    const llm = await initializeEngine();

    let contextInfo = '';
    if (emailContext?.emails) {
        contextInfo = `\n\nCurrent inbox context:\n${emailContext.emails.map((e, i) =>
            `${i + 1}. From: ${e.sender} | Subject: ${e.subject} | ${e.unread ? 'UNREAD' : 'read'}`
        ).join('\n')}`;
    }
    if (emailContext?.openEmail) {
        contextInfo += `\n\nCurrently open email:\nFrom: ${emailContext.openEmail.sender}\nSubject: ${emailContext.openEmail.subject}\nContent: ${emailContext.openEmail.body?.slice(0, 500)}...`;
    }

    const messages = [
        { role: 'system', content: SYSTEM_PROMPT + contextInfo },
        { role: 'user', content: userMessage }
    ];

    const stream = await llm.chat.completions.create({
        messages,
        temperature: 0.7,
        max_tokens: 512,
        stream: true
    });

    let fullResponse = '';
    for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        fullResponse += content;
        yield { content, fullResponse };
    }
}

// Get confirmation message for action
function getActionConfirmation(action) {
    const confirmations = {
        summarize_inbox: "I'll summarize your inbox for you.",
        summarize_email: "Let me summarize this email.",
        filter_unread: "Filtering to show unread emails.",
        search: `Searching for: ${action.params?.query || ''}`,
        analyze_sentiment: "Analyzing the sentiment of this email.",
        draft_reply: "I'll help you draft a reply.",
        open_email: `Opening email ${(action.params?.index || 0) + 1}.`,
        scroll: `Scrolling ${action.params?.direction || 'down'}.`
    };
    return confirmations[action.action] || "Executing action...";
}

// Get Gmail tab
async function getGmailTab() {
    const tabs = await chrome.tabs.query({ url: 'https://mail.google.com/*' });
    return tabs.length > 0 ? tabs[0] : null;
}

// Send message to content script
async function sendToContentScript(action, params = {}) {
    const tab = await getGmailTab();
    if (!tab) {
        return { error: 'No Gmail tab found. Please open Gmail first.' };
    }
    try {
        return await chrome.tabs.sendMessage(tab.id, { action, params });
    } catch (e) {
        return { error: 'Content script not loaded. Please refresh Gmail.' };
    }
}

// Execute action via content script
async function executeAction(action) {
    if (!action?.action) return null;
    return sendToContentScript(action.action, action.params || {});
}

// Message handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const { action, text, userMessage, emailContext } = message;

    (async () => {
        try {
            switch (action) {
                case 'load_model': {
                    await initializeEngine((progress) => {
                        chrome.runtime.sendMessage({
                            type: 'model_progress',
                            progress
                        }).catch(() => { });
                    });
                    sendResponse({ success: true, loaded: true });
                    break;
                }

                case 'check_status': {
                    sendResponse({ loaded: isLoaded, loading: isLoading });
                    break;
                }

                case 'chat': {
                    // Get email context from Gmail
                    const context = await sendToContentScript('get_email_context');

                    // Generate response using LLM
                    const result = await generateResponse(userMessage, context?.emailContext);

                    // Execute action if any
                    if (result.action) {
                        result.actionResult = await executeAction(result.action);
                    }

                    sendResponse({
                        success: true,
                        response: result.response,
                        action: result.action,
                        actionResult: result.actionResult
                    });
                    break;
                }

                case 'chat_stream': {
                    // For streaming, we use a different approach with ports
                    // This handler just confirms streaming is available
                    sendResponse({ streaming: true });
                    break;
                }

                case 'get_emails': {
                    const emails = await sendToContentScript('get_emails');
                    sendResponse(emails);
                    break;
                }

                default:
                    sendResponse({ error: `Unknown action: ${action}` });
            }
        } catch (error) {
            console.error('[BroTrans] Error:', error);
            sendResponse({ error: error.message });
        }
    })();

    return true;
});

// Handle streaming via long-lived connections
chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'chat_stream') return;

    port.onMessage.addListener(async (message) => {
        const { userMessage, emailContext } = message;

        try {
            const generator = generateResponseStream(userMessage, emailContext);

            for await (const chunk of generator) {
                port.postMessage({
                    type: 'chunk',
                    content: chunk.content,
                    fullResponse: chunk.fullResponse
                });
            }

            // Parse action from final response
            const fullResponse = (await generator.next()).value?.fullResponse || '';
            let action = null;
            const actionMatch = fullResponse.match(/\{[\s\S]*"action"[\s\S]*\}/);
            if (actionMatch) {
                try {
                    action = JSON.parse(actionMatch[0]);
                    const actionResult = await executeAction(action);
                    port.postMessage({ type: 'action', action, actionResult });
                } catch (e) { }
            }

            port.postMessage({ type: 'done' });
        } catch (error) {
            port.postMessage({ type: 'error', error: error.message });
        }
    });
});

// Context menu for analyzing selected text
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: 'analyze-selection',
        title: 'Analyze with BroTrans',
        contexts: ['selection'],
    });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== 'analyze-selection' || !info.selectionText) return;

    try {
        await initializeEngine();
        const result = await generateResponse(
            `Analyze this text and provide insights: "${info.selectionText}"`,
            null
        );

        chrome.scripting.executeScript({
            target: { tabId: tab.id },
            args: [result.response],
            func: (response) => {
                alert(`BroTrans Analysis:\n\n${response}`);
            },
        });
    } catch (error) {
        chrome.scripting.executeScript({
            target: { tabId: tab.id },
            args: [error.message],
            func: (errMsg) => {
                alert(`BroTrans Error: ${errMsg}`);
            },
        });
    }
});

console.log('[BroTrans] Background service worker loaded with WebLLM');
