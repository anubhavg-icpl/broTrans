// background.js - BroTrans Gmail Assistant with Chrome Built-in AI (Gemini Nano)
// No external downloads - uses Chrome's native AI

console.log('[BroTrans] Background service worker starting...');

// AI Session state
let aiSession = null;
let isCreatingSession = false;

// System prompt for Gmail assistant
const SYSTEM_PROMPT = `You are BroTrans, a helpful Gmail assistant. Be concise and helpful.

When users want to perform an action, respond with a JSON object on a new line:
{"action": "ACTION_NAME", "params": {}}

Available actions:
- summarize_inbox: Summarize visible emails
- summarize_email: Summarize open email
- filter_unread: Show unread emails
- search: Search emails (params: {"query": "term"})
- analyze_sentiment: Analyze email tone
- draft_reply: Draft reply (params: {"text": "draft"})
- open_email: Open email (params: {"index": 0})
- scroll: Scroll inbox (params: {"direction": "up|down"})

Otherwise, respond conversationally.`;

// Check if Chrome AI is available
async function checkAIAvailability() {
    if (!self.ai || !self.ai.languageModel) {
        return { available: false, error: 'Chrome AI not available. Enable at chrome://flags/#prompt-api-for-gemini-nano' };
    }

    try {
        const capabilities = await self.ai.languageModel.capabilities();
        if (capabilities.available === 'no') {
            return { available: false, error: 'Gemini Nano not available on this device' };
        }
        if (capabilities.available === 'after-download') {
            return { available: false, error: 'Gemini Nano needs to download. Visit chrome://components and update "Optimization Guide On Device Model"' };
        }
        return { available: true, capabilities };
    } catch (e) {
        return { available: false, error: e.message };
    }
}

// Create AI session
async function getAISession() {
    if (aiSession) return aiSession;

    if (isCreatingSession) {
        while (isCreatingSession) {
            await new Promise(r => setTimeout(r, 100));
        }
        return aiSession;
    }

    isCreatingSession = true;

    try {
        const check = await checkAIAvailability();
        if (!check.available) {
            throw new Error(check.error);
        }

        console.log('[BroTrans] Creating AI session...');
        aiSession = await self.ai.languageModel.create({
            systemPrompt: SYSTEM_PROMPT
        });
        console.log('[BroTrans] AI session ready');
        return aiSession;

    } catch (error) {
        console.error('[BroTrans] Failed to create AI session:', error);
        throw error;
    } finally {
        isCreatingSession = false;
    }
}

// Generate response
async function generateResponse(userMessage, emailContext) {
    const session = await getAISession();

    // Build context
    let contextInfo = '';
    if (emailContext?.emails?.length > 0) {
        contextInfo = '\n\nInbox:\n' + emailContext.emails.map((e, i) =>
            `${i + 1}. ${e.unread ? '[UNREAD] ' : ''}From: ${e.sender} | ${e.subject}`
        ).join('\n');
    }
    if (emailContext?.openEmail) {
        const e = emailContext.openEmail;
        contextInfo += `\n\nOpen email:\nFrom: ${e.sender}\nSubject: ${e.subject}\n${e.body?.slice(0, 300)}...`;
    }

    const prompt = contextInfo ? `${userMessage}\n${contextInfo}` : userMessage;

    try {
        const response = await session.prompt(prompt);

        // Parse action from response
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
                cleanResponse = getActionConfirmation(action);
            }
        }

        return { response: cleanResponse, action };

    } catch (error) {
        console.error('[BroTrans] Generation error:', error);
        // Reset session on error
        aiSession = null;
        throw error;
    }
}

// Action confirmations
function getActionConfirmation(action) {
    const msgs = {
        summarize_inbox: "Summarizing your inbox...",
        summarize_email: "Summarizing this email...",
        filter_unread: "Showing unread emails...",
        search: `Searching for: ${action.params?.query || ''}`,
        analyze_sentiment: "Analyzing sentiment...",
        draft_reply: "Drafting reply...",
        open_email: `Opening email ${(action.params?.index || 0) + 1}...`,
        scroll: `Scrolling ${action.params?.direction || 'down'}...`
    };
    return msgs[action.action] || "Processing...";
}

// Get Gmail tab
async function getGmailTab() {
    const tabs = await chrome.tabs.query({ url: 'https://mail.google.com/*' });
    return tabs[0] || null;
}

// Send to content script
async function sendToContentScript(action, params = {}) {
    const tab = await getGmailTab();
    if (!tab) return { error: 'Open Gmail first' };
    try {
        return await chrome.tabs.sendMessage(tab.id, { action, params });
    } catch (e) {
        return { error: 'Refresh Gmail page' };
    }
}

// Execute action
async function executeAction(action) {
    if (!action?.action) return null;
    return sendToContentScript(action.action, action.params || {});
}

// Message handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const { action, userMessage } = message;

    (async () => {
        try {
            switch (action) {
                case 'check_ai': {
                    const result = await checkAIAvailability();
                    sendResponse(result);
                    break;
                }

                case 'load_model': {
                    await getAISession();
                    sendResponse({ success: true, loaded: true });
                    break;
                }

                case 'check_status': {
                    const available = await checkAIAvailability();
                    sendResponse({
                        loaded: aiSession !== null,
                        available: available.available,
                        error: available.error
                    });
                    break;
                }

                case 'chat': {
                    const context = await sendToContentScript('get_email_context');
                    const result = await generateResponse(userMessage, context?.emailContext);

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

// Context menu
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
        const result = await generateResponse(`Analyze: "${info.selectionText}"`, null);
        chrome.scripting.executeScript({
            target: { tabId: tab.id },
            args: [result.response],
            func: (r) => alert(`BroTrans:\n\n${r}`),
        });
    } catch (error) {
        chrome.scripting.executeScript({
            target: { tabId: tab.id },
            args: [error.message],
            func: (e) => alert(`BroTrans Error: ${e}`),
        });
    }
});

console.log('[BroTrans] Background loaded with Gemini Nano');
