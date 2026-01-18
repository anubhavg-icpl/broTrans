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

// Text Generation Pipeline (instruction-tuned model for better summarization)
class SummaryPipeline {
    static task = 'text2text-generation';
    static model = 'Xenova/flan-t5-small';
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
    // Limit input to ~500 words for performance with Flan-T5
    const truncated = text.split(/\s+/).slice(0, 500).join(' ');
    // Use instruction format for Flan-T5
    const prompt = `Summarize the following webpage content in 2-3 sentences:\n\n${truncated}`;
    const result = await model(prompt, {
        max_new_tokens: 100,
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
                // Flan-T5 returns generated_text instead of summary_text
                const summaryText = result[0]?.generated_text || result[0]?.summary_text || 'No summary generated';
                sendResponse({ success: true, summary: summaryText });
            } catch (error) {
                console.error('Summarize error:', error);
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
                        // Try to find main content areas first
                        const mainSelectors = [
                            'article',
                            'main',
                            '[role="main"]',
                            '.post-content',
                            '.article-content',
                            '.entry-content',
                            '.content',
                            '#content',
                            '.readme',
                            '.markdown-body'
                        ];

                        let mainContent = null;
                        for (const selector of mainSelectors) {
                            const el = document.querySelector(selector);
                            if (el && el.innerText && el.innerText.length > 200) {
                                mainContent = el;
                                break;
                            }
                        }

                        // Fall back to body if no main content found
                        const source = mainContent || document.body;
                        const clone = source.cloneNode(true);

                        // Remove unwanted elements
                        clone.querySelectorAll('script, style, nav, header, footer, aside, iframe, noscript, button, input, form, [role="navigation"], [role="banner"], [role="complementary"]').forEach(el => el.remove());

                        // Get text content
                        let text = clone.innerText || clone.textContent || '';

                        // Clean up whitespace and remove very short lines (likely UI elements)
                        text = text
                            .split('\n')
                            .map(line => line.trim())
                            .filter(line => line.length > 20) // Filter short lines
                            .join(' ')
                            .replace(/\s+/g, ' ')
                            .trim();

                        // Get meta description as fallback context
                        const metaDesc = document.querySelector('meta[name="description"]')?.content || '';

                        return {
                            title: document.title,
                            url: window.location.href,
                            content: text,
                            description: metaDesc
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
