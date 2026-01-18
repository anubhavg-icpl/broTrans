// background.js - BroTrans Gmail Assistant
// Routes messages between popup and Gmail content script
// Note: Chrome AI API not available in service workers, AI runs in popup

console.log('[BroTrans] Background service worker starting...');

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

// Message handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const { action, gmailAction, params } = message;

    (async () => {
        try {
            switch (action) {
                case 'get_email_context': {
                    const result = await sendToContentScript('get_email_context');
                    sendResponse(result);
                    break;
                }

                case 'execute_action': {
                    const result = await sendToContentScript(gmailAction, params);
                    sendResponse(result);
                    break;
                }

                case 'get_emails': {
                    const result = await sendToContentScript('get_emails');
                    sendResponse(result);
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

    // Can't use AI in service worker, just show the selection
    chrome.scripting.executeScript({
        target: { tabId: tab.id },
        args: [info.selectionText],
        func: (text) => {
            alert(`BroTrans: Open the extension popup to analyze:\n\n"${text.slice(0, 200)}${text.length > 200 ? '...' : ''}"`);
        },
    });
});

console.log('[BroTrans] Background loaded (message router only)');
