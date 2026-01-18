// popup.ts - Extension popup UI handler

// Types
interface ClassificationResult {
    label: string;
    score: number;
}

interface ScreenshotResponse {
    success: boolean;
    dataUrl?: string;
    error?: string;
}

interface AnalyzeImageResponse {
    success: boolean;
    analysis?: Array<{ generated_text: string }>;
    error?: string;
}

// DOM Elements
const elements = {
    // Sentiment tab
    textInput: document.getElementById('text') as HTMLTextAreaElement,
    charCount: document.getElementById('char-count') as HTMLDivElement,
    analyzeBtn: document.getElementById('analyze-btn') as HTMLButtonElement,
    resultContainer: document.getElementById('result-container') as HTMLDivElement,
    resultIcon: document.getElementById('result-icon') as HTMLDivElement,
    resultLabel: document.getElementById('result-label') as HTMLDivElement,
    scoreValue: document.getElementById('score-value') as HTMLDivElement,
    confidenceFill: document.getElementById('confidence-fill') as HTMLDivElement,

    // Screenshot tab
    captureBtn: document.getElementById('capture-btn') as HTMLButtonElement,
    screenshotPreview: document.getElementById('screenshot-preview') as HTMLDivElement,
    screenshotImg: document.getElementById('screenshot-img') as HTMLImageElement,
    screenshotPlaceholder: document.querySelector('.screenshot-placeholder') as HTMLDivElement,
    screenshotResult: document.getElementById('screenshot-result') as HTMLDivElement,
    analysisText: document.getElementById('analysis-text') as HTMLParagraphElement,

    // Status
    statusBadge: document.getElementById('status-badge') as HTMLDivElement,
    statusText: document.getElementById('status-text') as HTMLSpanElement,
    progressContainer: document.getElementById('progress-container') as HTMLDivElement,
    progressFill: document.getElementById('progress-fill') as HTMLDivElement,

    // Tabs
    tabBtns: document.querySelectorAll('.tab-btn') as NodeListOf<HTMLButtonElement>,
    tabContents: document.querySelectorAll('.tab-content') as NodeListOf<HTMLDivElement>,
};

// State
let modelReady = false;
let isAnalyzing = false;
let isCapturing = false;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initializeModel();
    setupEventListeners();
});

function setupEventListeners(): void {
    // Text input
    elements.textInput.addEventListener('input', handleTextInput);
    elements.textInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleAnalyze();
        }
    });

    // Buttons
    elements.analyzeBtn.addEventListener('click', handleAnalyze);
    elements.captureBtn.addEventListener('click', handleCapture);

    // Tab switching
    elements.tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabName = btn.dataset.tab;
            if (tabName) switchTab(tabName);
        });
    });
}

function switchTab(tabName: string): void {
    elements.tabBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    elements.tabContents.forEach(content => {
        content.classList.toggle('active', content.id === `${tabName}-tab`);
    });
}

async function initializeModel(): Promise<void> {
    updateStatus('loading', 'Loading model...');
    elements.progressFill.classList.add('indeterminate');

    try {
        // Trigger model loading by sending a test classification
        await chrome.runtime.sendMessage({
            action: 'classify',
            text: 'test'
        });

        modelReady = true;
        updateStatus('ready', 'Ready');
        elements.progressContainer.classList.add('hidden');
        elements.analyzeBtn.disabled = !elements.textInput.value.trim();
    } catch (error) {
        console.error('Model initialization error:', error);
        updateStatus('error', 'Failed to load');
    }
}

function updateStatus(status: 'loading' | 'ready' | 'error', text: string): void {
    elements.statusBadge.className = `status-badge ${status}`;
    elements.statusText.textContent = text;

    if (status === 'ready') {
        elements.progressContainer.classList.add('hidden');
    }
}

function handleTextInput(): void {
    const text = elements.textInput.value;

    // Update character count
    elements.charCount.textContent = text.length > 0 ? `${text.length} chars` : '';

    // Enable/disable button
    elements.analyzeBtn.disabled = !modelReady || !text.trim() || isAnalyzing;
}

async function handleAnalyze(): Promise<void> {
    const text = elements.textInput.value.trim();
    if (!text || !modelReady || isAnalyzing) return;

    isAnalyzing = true;
    elements.analyzeBtn.disabled = true;
    elements.analyzeBtn.classList.add('loading');
    setButtonText(elements.analyzeBtn, 'Analyzing...');

    elements.resultContainer.classList.add('hidden');

    try {
        const response = await chrome.runtime.sendMessage({
            action: 'classify',
            text
        }) as ClassificationResult[];

        if (response && response.length > 0) {
            displaySentimentResult(response[0]);
        }
    } catch (error) {
        console.error('Classification error:', error);
    } finally {
        isAnalyzing = false;
        elements.analyzeBtn.classList.remove('loading');
        setButtonText(elements.analyzeBtn, 'Analyze Sentiment');
        elements.analyzeBtn.disabled = !elements.textInput.value.trim();
    }
}

function displaySentimentResult(result: ClassificationResult): void {
    const isPositive = result.label === 'POSITIVE';
    const score = Math.round(result.score * 100);

    // Update container
    elements.resultContainer.className = `result-container ${isPositive ? 'positive' : 'negative'}`;

    // Update icon
    elements.resultIcon.innerHTML = isPositive
        ? '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>'
        : '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M16 16s-1.5-2-4-2-4 2-4 2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>';

    // Update text
    elements.resultLabel.textContent = isPositive ? 'Positive' : 'Negative';
    elements.scoreValue.textContent = `${score}%`;

    // Update confidence bar
    elements.confidenceFill.style.width = `${score}%`;

    // Show result
    elements.resultContainer.classList.remove('hidden');
}

async function handleCapture(): Promise<void> {
    if (isCapturing) return;

    isCapturing = true;
    elements.captureBtn.disabled = true;
    elements.captureBtn.classList.add('loading');
    setButtonText(elements.captureBtn, 'Capturing...');

    elements.screenshotResult.classList.add('hidden');

    try {
        // Step 1: Capture screenshot from background
        const screenshotResponse = await chrome.runtime.sendMessage({
            action: 'screenshot'
        }) as ScreenshotResponse;

        if (!screenshotResponse?.success || !screenshotResponse.dataUrl) {
            throw new Error(screenshotResponse?.error || 'Failed to capture screenshot');
        }

        // Display the captured screenshot
        elements.screenshotImg.src = screenshotResponse.dataUrl;
        elements.screenshotImg.classList.remove('hidden');
        elements.screenshotPlaceholder.style.display = 'none';

        setButtonText(elements.captureBtn, 'Analyzing...');

        // Step 2: Analyze the image
        const analyzeResponse = await chrome.runtime.sendMessage({
            action: 'analyze-image',
            imageData: screenshotResponse.dataUrl
        }) as AnalyzeImageResponse;

        if (!analyzeResponse?.success) {
            throw new Error(analyzeResponse?.error || 'Failed to analyze image');
        }

        // Display analysis
        if (analyzeResponse.analysis && analyzeResponse.analysis.length > 0) {
            elements.analysisText.textContent = analyzeResponse.analysis[0].generated_text;
        } else {
            elements.analysisText.textContent = 'No description generated';
        }
        elements.screenshotResult.classList.remove('hidden');

    } catch (error) {
        console.error('Capture error:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        elements.analysisText.textContent = `Error: ${errorMessage}`;
        elements.screenshotResult.classList.remove('hidden');
    } finally {
        isCapturing = false;
        elements.captureBtn.classList.remove('loading');
        setButtonText(elements.captureBtn, 'Capture & Analyze');
        elements.captureBtn.disabled = false;
    }
}

function setButtonText(button: HTMLButtonElement, text: string): void {
    const span = button.querySelector('span');
    if (span) span.textContent = text;
}
