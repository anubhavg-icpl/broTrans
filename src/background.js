// background.js - Service worker for BroTrans Gmail Assistant
// Routes messages between popup, content script, and offscreen document

console.log('[BroTrans] Background service worker starting...');

// Offscreen document management
let creatingOffscreen = null;

async function setupOffscreenDocument() {
    const offscreenUrl = chrome.runtime.getURL('offscreen.html');

    // Check if offscreen document already exists
    const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [offscreenUrl]
    });

    if (existingContexts.length > 0) {
        return;
    }

    // Create offscreen document
    if (creatingOffscreen) {
        await creatingOffscreen;
    } else {
        creatingOffscreen = chrome.offscreen.createDocument({
            url: offscreenUrl,
            reasons: ['WORKERS'],
            justification: 'Run WebLLM with WebGPU for local AI inference'
        });
        await creatingOffscreen;
        creatingOffscreen = null;
    }

    console.log('[BroTrans] Offscreen document created');
}

// Send message to offscreen document
async function sendToOffscreen(type, data = {}) {
    await setupOffscreenDocument();
    return chrome.runtime.sendMessage({
        target: 'offscreen',
        type,
        data
    });
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
    // Ignore messages meant for offscreen
    if (message.target === 'offscreen') {
        return;
    }

    // Handle progress messages from offscreen
    if (message.type === 'model_progress') {
        // Broadcast to popup
        chrome.runtime.sendMessage(message).catch(() => { });
        return;
    }

    const { action, userMessage } = message;

    (async () => {
        try {
            switch (action) {
                case 'load_model': {
                    const result = await sendToOffscreen('load_model');
                    sendResponse(result);
                    break;
                }

                case 'check_status': {
                    const result = await sendToOffscreen('check_status');
                    sendResponse(result);
                    break;
                }

                case 'chat': {
                    // Get email context from Gmail
                    const context = await sendToContentScript('get_email_context');

                    // Generate response using offscreen LLM
                    const result = await sendToOffscreen('generate', {
                        userMessage,
                        emailContext: context?.emailContext
                    });

                    // Execute action if any
                    if (result.action) {
                        result.actionResult = await executeAction(result.action);
                    }

                    sendResponse({
                        success: result.success,
                        response: result.response,
                        action: result.action,
                        actionResult: result.actionResult,
                        error: result.error
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
        const result = await sendToOffscreen('generate', {
            userMessage: `Analyze this text and provide insights: "${info.selectionText}"`,
            emailContext: null
        });

        chrome.scripting.executeScript({
            target: { tabId: tab.id },
            args: [result.response || result.error || 'Analysis failed'],
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

console.log('[BroTrans] Background service worker loaded');
