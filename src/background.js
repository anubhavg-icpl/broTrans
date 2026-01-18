// background.js - Handles requests from the UI, runs the model, then sends back a response

import { pipeline } from '@huggingface/transformers';

// Sentiment Classification Pipeline
class SentimentPipeline {
    static task = 'text-classification';
    static model = 'Xenova/distilbert-base-uncased-finetuned-sst-2-english';
    static instance = null;

    static async getInstance() {
        this.instance ??= pipeline(this.task, this.model);
        return this.instance;
    }
}

// Summarization Pipeline (small model)
class SummaryPipeline {
    static task = 'summarization';
    static model = 'Xenova/distilbart-cnn-6-6';
    static instance = null;

    static async getInstance() {
        this.instance ??= pipeline(this.task, this.model);
        return this.instance;
    }
}

// Classify sentiment
const classify = async (text) => {
    const model = await SentimentPipeline.getInstance();
    return await model(text);
};

// Summarize text
const summarize = async (text) => {
    const model = await SummaryPipeline.getInstance();
    // Limit input to ~1000 words for performance
    const truncated = text.split(/\s+/).slice(0, 1000).join(' ');
    const result = await model(truncated, {
        max_new_tokens: 150,
        min_length: 30,
    });
    return result;
};

////////////////////// 1. Context Menus //////////////////////
chrome.runtime.onInstalled.addListener(function () {
    chrome.contextMenus.create({
        id: 'classify-selection',
        title: 'Analyze sentiment: "%s"',
        contexts: ['selection'],
    });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== 'classify-selection' || !info.selectionText) return;

    const result = await classify(info.selectionText);

    chrome.scripting.executeScript({
        target: { tabId: tab.id },
        args: [result],
        function: (result) => {
            const label = result[0]?.label || 'Unknown';
            const score = Math.round((result[0]?.score || 0) * 100);
            alert(`Sentiment: ${label}\nConfidence: ${score}%`);
        },
    });
});

////////////////////// 2. Message Events /////////////////////
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Message received:', message.action);

    if (message.action === 'classify') {
        (async () => {
            const result = await classify(message.text);
            sendResponse(result);
        })();
        return true;
    }

    if (message.action === 'summarize') {
        (async () => {
            try {
                const result = await summarize(message.text);
                sendResponse({ success: true, summary: result[0].summary_text });
            } catch (error) {
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true;
    }

    if (message.action === 'getPageContent') {
        // Execute script in the active tab to get page content
        (async () => {
            try {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                const results = await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    function: () => {
                        // Extract main text content from the page
                        const elementsToRemove = document.querySelectorAll('script, style, nav, header, footer, aside, iframe, noscript');
                        const clone = document.body.cloneNode(true);
                        clone.querySelectorAll('script, style, nav, header, footer, aside, iframe, noscript').forEach(el => el.remove());

                        // Get text content
                        let text = clone.innerText || clone.textContent || '';

                        // Clean up whitespace
                        text = text.replace(/\s+/g, ' ').trim();

                        // Get page title and URL
                        return {
                            title: document.title,
                            url: window.location.href,
                            content: text
                        };
                    }
                });
                sendResponse({ success: true, data: results[0].result });
            } catch (error) {
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true;
    }
});

console.log('BroTrans background service worker loaded');
