// offscreen.js - Runs WebLLM in offscreen document with WebGPU access
// Chrome extension service workers don't have WebGPU, so we use offscreen document

import { CreateMLCEngine } from '@mlc-ai/web-llm';

console.log('[BroTrans Offscreen] Starting...');

// Model configuration
const MODEL_ID = 'Llama-3.2-1B-Instruct-q4f16_1-MLC';

// Engine state
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

// Initialize MLCEngine
async function initializeEngine() {
    if (engine) return engine;
    if (isLoading) {
        while (isLoading) {
            await new Promise(r => setTimeout(r, 100));
        }
        return engine;
    }

    isLoading = true;

    try {
        console.log('[BroTrans Offscreen] Initializing MLCEngine...');

        engine = await CreateMLCEngine(MODEL_ID, {
            initProgressCallback: (progress) => {
                console.log('[BroTrans Offscreen] Progress:', progress);
                // Send progress to background script
                chrome.runtime.sendMessage({
                    type: 'model_progress',
                    progress: progress
                }).catch(() => { });
            }
        });

        isLoaded = true;
        console.log('[BroTrans Offscreen] Engine ready');
        return engine;

    } catch (error) {
        console.error('[BroTrans Offscreen] Failed to initialize:', error);
        throw error;
    } finally {
        isLoading = false;
    }
}

// Generate response using LLM
async function generateResponse(userMessage, emailContext) {
    const llm = await initializeEngine();

    // Build context
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

        // Parse action from response
        let action = null;
        const actionMatch = responseText.match(/\{[\s\S]*"action"[\s\S]*\}/);
        if (actionMatch) {
            try {
                action = JSON.parse(actionMatch[0]);
            } catch (e) {
                // Not valid JSON
            }
        }

        // Clean response
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
        console.error('[BroTrans Offscreen] Generation error:', error);
        throw error;
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

// Message handler from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.target !== 'offscreen') {
        return;
    }

    handleMessage(message).then(sendResponse);
    return true;
});

async function handleMessage(message) {
    const { type, data } = message;

    try {
        switch (type) {
            case 'load_model':
                await initializeEngine();
                return { success: true, loaded: true };

            case 'check_status':
                return { loaded: isLoaded, loading: isLoading };

            case 'generate':
                const result = await generateResponse(data.userMessage, data.emailContext);
                return {
                    success: true,
                    response: result.response,
                    action: result.action
                };

            default:
                return { error: `Unknown message type: ${type}` };
        }
    } catch (error) {
        console.error('[BroTrans Offscreen] Error:', error);
        return { success: false, error: error.message };
    }
}

console.log('[BroTrans Offscreen] Loaded');
