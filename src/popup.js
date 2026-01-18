// popup.js - handles interaction with the extension's popup

// DOM Elements
const textInput = document.getElementById('text');
const charCount = document.getElementById('char-count');
const analyzeBtn = document.getElementById('analyze-btn');
const statusBadge = document.getElementById('status-badge');
const statusText = document.getElementById('status-text');
const progressContainer = document.getElementById('progress-container');
const progressFill = document.getElementById('progress-fill');
const progressText = document.getElementById('progress-text');
const resultContainer = document.getElementById('result-container');
const resultIcon = document.getElementById('result-icon');
const resultLabel = document.getElementById('result-label');
const scoreValue = document.getElementById('score-value');
const confidenceFill = document.getElementById('confidence-fill');

// State
let modelReady = false;
let isAnalyzing = false;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Start loading the model
    loadModel();

    // Set up event listeners
    textInput.addEventListener('input', handleTextInput);
    analyzeBtn.addEventListener('click', handleAnalyze);
    textInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleAnalyze();
        }
    });
});

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

// Display the result
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
