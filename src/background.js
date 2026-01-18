// background.js - Handles requests from the UI, runs the model, then sends back a response

import { pipeline } from '@huggingface/transformers';

// Text classification pipeline for sentiment analysis
class TextPipelineSingleton {
    static task = 'text-classification';
    static model = 'Xenova/distilbert-base-uncased-finetuned-sst-2-english';
    static instance = null;

    static async getInstance(progress_callback = null) {
        this.instance ??= pipeline(this.task, this.model, { progress_callback });
        return this.instance;
    }
}

// Image captioning pipeline for screenshot analysis
class ImagePipelineSingleton {
    static task = 'image-to-text';
    static model = 'Xenova/vit-gpt2-image-captioning';
    static instance = null;

    static async getInstance(progress_callback = null) {
        this.instance ??= pipeline(this.task, this.model, { progress_callback });
        return this.instance;
    }
}

// Text classification function for sentiment analysis
const classify = async (text) => {
    let model = await TextPipelineSingleton.getInstance((data) => {
        // Track progress of model loading
    });
    let result = await model(text);
    return result;
};

// Image analysis function for screenshot captioning
const analyzeImage = async (imageDataUrl) => {
    let model = await ImagePipelineSingleton.getInstance((data) => {
        // Track progress of model loading
    });
    let result = await model(imageDataUrl);
    return result;
};

// Capture screenshot of current tab
const captureScreenshot = async () => {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
        return dataUrl;
    } catch (error) {
        console.error('Screenshot capture error:', error);
        throw error;
    }
};

////////////////////// 1. Context Menus //////////////////////
//
// Add a listener to create the initial context menu items,
// context menu items only need to be created at runtime.onInstalled
chrome.runtime.onInstalled.addListener(function () {
    // Register a context menu item that will only show up for selection text.
    chrome.contextMenus.create({
        id: 'classify-selection',
        title: 'Classify "%s"',
        contexts: ['selection'],
    });
});

// Perform inference when the user clicks a context menu
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    // Ignore context menu clicks that are not for classifications (or when there is no input)
    if (info.menuItemId !== 'classify-selection' || !info.selectionText) return;

    // Perform classification on the selected text
    let result = await classify(info.selectionText);

    // Do something with the result
    chrome.scripting.executeScript({
        target: { tabId: tab.id },    // Run in the tab that the user clicked in
        args: [result],               // The arguments to pass to the function
        function: (result) => {       // The function to run
            // NOTE: This function is run in the context of the web page, meaning that `document` is available.
            console.log('result', result)
            console.log('document', document)
        },
    });
});
//////////////////////////////////////////////////////////////

////////////////////// 2. Message Events /////////////////////
//
// Listen for messages from the UI, process it, and send the result back.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Message received:', message.action);

    if (message.action === 'classify') {
        // Text sentiment classification
        (async function () {
            let result = await classify(message.text);
            sendResponse(result);
        })();
        return true;
    }

    if (message.action === 'screenshot') {
        // Capture screenshot only
        (async function () {
            try {
                let dataUrl = await captureScreenshot();
                sendResponse({ success: true, dataUrl });
            } catch (error) {
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true;
    }

    if (message.action === 'analyze-screenshot') {
        // Capture and analyze screenshot
        (async function () {
            try {
                let dataUrl = await captureScreenshot();
                let analysis = await analyzeImage(dataUrl);
                sendResponse({ success: true, dataUrl, analysis });
            } catch (error) {
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true;
    }

    if (message.action === 'analyze-image') {
        // Analyze provided image data
        (async function () {
            try {
                let analysis = await analyzeImage(message.imageData);
                sendResponse({ success: true, analysis });
            } catch (error) {
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true;
    }
});
//////////////////////////////////////////////////////////////

