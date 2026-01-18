// popup.js - handles interaction with the extension's popup

// DOM Elements - Sentiment Tab
const textInput = document.getElementById('text');
const charCount = document.getElementById('char-count');
const analyzeBtn = document.getElementById('analyze-btn');
const resultContainer = document.getElementById('result-container');
const resultIcon = document.getElementById('result-icon');
const resultLabel = document.getElementById('result-label');
const scoreValue = document.getElementById('score-value');
const confidenceFill = document.getElementById('confidence-fill');

// DOM Elements - Screenshot Tab
const captureBtn = document.getElementById('capture-btn');
const screenshotPreview = document.getElementById('screenshot-preview');
const screenshotImg = document.getElementById('screenshot-img');
const screenshotResult = document.getElementById('screenshot-result');
const analysisText = document.getElementById('analysis-text');

// DOM Elements - Shared
const statusBadge = document.getElementById('status-badge');
const statusText = document.getElementById('status-text');
const progressContainer = document.getElementById('progress-container');
const progressFill = document.getElementById('progress-fill');
const progressText = document.getElementById('progress-text');
const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

// State
let modelReady = false;
let isAnalyzing = false;
let isCapturing = false;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Start loading the model
    loadModel();

    // Set up event listeners
    textInput.addEventListener('input', handleTextInput);
    analyzeBtn.addEventListener('click', handleAnalyze);
    captureBtn.addEventListener('click', handleCapture);

    textInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleAnalyze();
        }
    });

    // Tab switching
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabName = btn.dataset.tab;
            switchTab(tabName);
        });
    });
});

// Switch tabs
function switchTab(tabName) {
    // Update tab buttons
    tabBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    // Update tab contents
    tabContents.forEach(content => {
        content.classList.toggle('active', content.id === `${tabName}-tab`);
    });
}

// Load the model
async function loadModel() {
    updateStatus('loading', 'Loading model...');
    progressFill.classList.add('indeterminate');

    try {
        // Send a test message to trigger model loading
        const response = await chrome.runtime.sendMessage({
            action: 'classify',
            text: 'test'
        });

        // Model loaded successfully
        modelReady = true;
        updateStatus('ready', 'Ready');
        progressContainer.classList.add('hidden');
        analyzeBtn.disabled = !textInput.value.trim();

    } catch (error) {
        console.error('Model load error:', error);
        updateStatus('error', 'Failed to load');
    }
}

// Update status badge
function updateStatus(status, text) {
    statusBadge.className = 'status-badge ' + status;
    statusText.textContent = text;

    if (status === 'ready') {
        progressContainer.classList.add('hidden');
    }
}

// Handle text input
function handleTextInput(e) {
    const text = e.target.value;

    // Update character count
    if (text.length > 0) {
        charCount.textContent = text.length + ' chars';
    } else {
        charCount.textContent = '';
    }

    // Enable/disable button
    analyzeBtn.disabled = !modelReady || !text.trim() || isAnalyzing;
}

// Handle analyze button click
async function handleAnalyze() {
    const text = textInput.value.trim();
    if (!text || !modelReady || isAnalyzing) return;

    isAnalyzing = true;
    analyzeBtn.disabled = true;
    analyzeBtn.classList.add('loading');
    analyzeBtn.querySelector('span').textContent = 'Analyzing...';

    // Hide previous result
    resultContainer.classList.add('hidden');

    try {
        const response = await chrome.runtime.sendMessage({
            action: 'classify',
            text: text
        });

        if (response && response.length > 0) {
            displayResult(response[0]);
        }
    } catch (error) {
        console.error('Classification error:', error);
    } finally {
        isAnalyzing = false;
        analyzeBtn.classList.remove('loading');
        analyzeBtn.querySelector('span').textContent = 'Analyze Sentiment';
        analyzeBtn.disabled = !textInput.value.trim();
    }
}

// Display the sentiment result
function displayResult(result) {
    const isPositive = result.label === 'POSITIVE';
    const score = Math.round(result.score * 100);

    // Update container class
    resultContainer.className = 'result-container ' + (isPositive ? 'positive' : 'negative');

    // Update icon
    resultIcon.innerHTML = isPositive
        ? '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>'
        : '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M16 16s-1.5-2-4-2-4 2-4 2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>';

    // Update label
    resultLabel.textContent = isPositive ? 'Positive' : 'Negative';

    // Update score
    scoreValue.textContent = score + '%';

    // Update confidence bar
    confidenceFill.style.width = score + '%';

    // Show result
    resultContainer.classList.remove('hidden');
}

// Handle capture button click
async function handleCapture() {
    if (isCapturing) return;

    isCapturing = true;
    captureBtn.disabled = true;
    captureBtn.classList.add('loading');
    captureBtn.querySelector('span').textContent = 'Capturing...';

    // Hide previous result
    screenshotResult.classList.add('hidden');

    try {
        // Capture and analyze screenshot
        const response = await chrome.runtime.sendMessage({
            action: 'analyze-screenshot'
        });

        if (response.success) {
            // Display screenshot
            screenshotImg.src = response.dataUrl;
            screenshotImg.classList.remove('hidden');
            screenshotPreview.querySelector('.screenshot-placeholder').style.display = 'none';

            // Display analysis
            if (response.analysis && response.analysis.length > 0) {
                const caption = response.analysis[0].generated_text;
                analysisText.textContent = caption;
                screenshotResult.classList.remove('hidden');
            }
        } else {
            console.error('Screenshot error:', response.error);
            analysisText.textContent = 'Error: ' + response.error;
            screenshotResult.classList.remove('hidden');
        }
    } catch (error) {
        console.error('Capture error:', error);
        analysisText.textContent = 'Error capturing screenshot. Make sure you have an active tab.';
        screenshotResult.classList.remove('hidden');
    } finally {
        isCapturing = false;
        captureBtn.classList.remove('loading');
        captureBtn.querySelector('span').textContent = 'Capture & Analyze';
        captureBtn.disabled = false;
    }
}
