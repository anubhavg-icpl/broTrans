// background.ts - Service worker for ML inference and screenshot capture

import { pipeline } from '@huggingface/transformers';

// Types
interface ClassifyMessage {
    action: 'classify';
    text: string;
}

interface ScreenshotMessage {
    action: 'screenshot';
}

interface AnalyzeImageMessage {
    action: 'analyze-image';
    imageData: string;
}

type Message = ClassifyMessage | ScreenshotMessage | AnalyzeImageMessage;

interface ClassificationResult {
    label: string;
    score: number;
}

interface ImageCaptionResult {
    generated_text: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PipelineInstance = any;

// Pipeline Singletons
class TextClassifier {
    private static instance: Promise<PipelineInstance> | null = null;
    private static readonly MODEL = 'Xenova/distilbert-base-uncased-finetuned-sst-2-english';

    static async getInstance(): Promise<PipelineInstance> {
        if (!this.instance) {
            this.instance = pipeline('text-classification', this.MODEL);
        }
        return this.instance;
    }
}

class ImageOCR {
    private static instance: Promise<PipelineInstance> | null = null;
    // TrOCR for printed text OCR
    private static readonly MODEL = 'Xenova/trocr-small-printed';

    static async getInstance(): Promise<PipelineInstance> {
        if (!this.instance) {
            this.instance = pipeline('image-to-text', this.MODEL);
        }
        return this.instance;
    }
}

// Text classification
async function classifyText(text: string): Promise<ClassificationResult[]> {
    const classifier = await TextClassifier.getInstance();
    const result = await classifier(text);
    return result as ClassificationResult[];
}

// OCR - Extract text from image
async function extractTextFromImage(imageData: string): Promise<ImageCaptionResult[]> {
    const ocr = await ImageOCR.getInstance();
    // Use OCR task prompt for Florence-2
    const result = await ocr(imageData, {
        max_new_tokens: 1024,
    });
    return result as ImageCaptionResult[];
}

// Screenshot capture using chrome.tabs API
async function captureScreenshot(): Promise<string> {
    // Get all normal browser windows
    const windows = await chrome.windows.getAll({
        populate: true,
        windowTypes: ['normal']
    });

    // Find a window with an active tab (prefer focused)
    let targetWindowId: number | undefined;

    for (const win of windows) {
        if (win.focused && win.id !== undefined) {
            targetWindowId = win.id;
            break;
        }
    }

    // Fallback to first window
    if (!targetWindowId && windows.length > 0 && windows[0].id !== undefined) {
        targetWindowId = windows[0].id;
    }

    if (!targetWindowId) {
        throw new Error('No browser window available');
    }

    // Capture the visible tab
    const dataUrl = await chrome.tabs.captureVisibleTab(targetWindowId, {
        format: 'png'
    });

    return dataUrl;
}

// Context menu setup
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: 'classify-selection',
        title: 'Analyze sentiment: "%s"',
        contexts: ['selection'],
    });
});

// Context menu click handler
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== 'classify-selection' || !info.selectionText || !tab?.id) {
        return;
    }

    try {
        const result = await classifyText(info.selectionText);

        chrome.scripting.executeScript({
            target: { tabId: tab.id },
            args: [result],
            func: (result) => {
                const label = result[0]?.label || 'Unknown';
                const score = Math.round((result[0]?.score || 0) * 100);
                alert(`Sentiment: ${label}\nConfidence: ${score}%`);
            },
        });
    } catch (error) {
        console.error('Context menu classification error:', error);
    }
});

// Message handler
chrome.runtime.onMessage.addListener((
    message: Message,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void
) => {
    console.log('Message received:', message.action);

    const handleMessage = async () => {
        try {
            switch (message.action) {
                case 'classify': {
                    const result = await classifyText(message.text);
                    return result;
                }
                case 'screenshot': {
                    const dataUrl = await captureScreenshot();
                    return { success: true, dataUrl };
                }
                case 'analyze-image': {
                    const analysis = await extractTextFromImage(message.imageData);
                    return { success: true, analysis };
                }
                default:
                    return { success: false, error: 'Unknown action' };
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error('Message handler error:', error);
            return { success: false, error: errorMessage };
        }
    };

    handleMessage().then(sendResponse);
    return true; // Keep channel open for async response
});

console.log('BroTrans background service worker loaded');
