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

// DOM Elements - Summary Tab
const summarizeBtn = document.getElementById('summarize-btn');
const pageTitle = document.getElementById('page-title');
const pageUrl = document.getElementById('page-url');
const summaryResult = document.getElementById('summary-result');
const summaryText = document.getElementById('summary-text');

// DOM Elements - Shared
const statusBadge = document.getElementById('status-badge');
const statusText = document.getElementById('status-text');
const progressContainer = document.getElementById('progress-container');
const progressFill = document.getElementById('progress-fill');
const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

// State
let modelReady = false;
let isAnalyzing = false;
let isSummarizing = false;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadModel();
    setupEventListeners();
});

function setupEventListeners() {
    // Text input
    textInput.addEventListener('input', handleTextInput);
    textInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleAnalyze();
        }
    });

    // Buttons
    analyzeBtn.addEventListener('click', handleAnalyze);
    summarizeBtn.addEventListener('click', handleSummarize);

    // Tab switching
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabName = btn.dataset.tab;
            switchTab(tabName);
        });
    });
}

function switchTab(tabName) {
    tabBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    tabContents.forEach(content => {
        content.classList.toggle('active', content.id === `${tabName}-tab`);
    });
}

// Load the model
async function loadModel() {
    updateStatus('loading', 'Loading model...');
    progressFill.classList.add('indeterminate');

    try {
        await chrome.runtime.sendMessage({
            action: 'classify',
            text: 'test'
        });

        modelReady = true;
        updateStatus('ready', 'Ready');
        progressContainer.classList.add('hidden');
        analyzeBtn.disabled = !textInput.value.trim();
    } catch (error) {
        console.error('Model load error:', error);
        updateStatus('error', 'Failed to load');
    }
}

function updateStatus(status, text) {
    statusBadge.className = 'status-badge ' + status;
    statusText.textContent = text;

    if (status === 'ready') {
        progressContainer.classList.add('hidden');
    }
}

function handleTextInput() {
    const text = textInput.value;
    charCount.textContent = text.length > 0 ? text.length + ' chars' : '';
    analyzeBtn.disabled = !modelReady || !text.trim() || isAnalyzing;
}

// Sentiment Analysis
async function handleAnalyze() {
    const text = textInput.value.trim();
    if (!text || !modelReady || isAnalyzing) return;

    isAnalyzing = true;
    analyzeBtn.disabled = true;
    analyzeBtn.classList.add('loading');
    analyzeBtn.querySelector('span').textContent = 'Analyzing...';
    resultContainer.classList.add('hidden');

    try {
        const response = await chrome.runtime.sendMessage({
            action: 'classify',
            text: text
        });

        if (response && response.length > 0) {
            displaySentimentResult(response[0]);
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

function displaySentimentResult(result) {
    const isPositive = result.label === 'POSITIVE';
    const score = Math.round(result.score * 100);

    resultContainer.className = 'result-container ' + (isPositive ? 'positive' : 'negative');

    resultIcon.innerHTML = isPositive
        ? '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>'
        : '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M16 16s-1.5-2-4-2-4 2-4 2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>';

    resultLabel.textContent = isPositive ? 'Positive' : 'Negative';
    scoreValue.textContent = score + '%';
    confidenceFill.style.width = score + '%';
    resultContainer.classList.remove('hidden');
}

// Page Summarization
async function handleSummarize() {
    if (isSummarizing) return;

    isSummarizing = true;
    summarizeBtn.disabled = true;
    summarizeBtn.classList.add('loading');
    summarizeBtn.querySelector('span').textContent = 'Getting page...';
    summaryResult.classList.add('hidden');

    try {
        // Step 1: Get page content
        const pageResponse = await chrome.runtime.sendMessage({
            action: 'getPageContent'
        });

        if (!pageResponse.success) {
            throw new Error(pageResponse.error || 'Failed to get page content');
        }

        const { title, url, content, description } = pageResponse.data;

        // Update page info
        pageTitle.textContent = title || 'Untitled Page';
        pageUrl.textContent = url || '';

        // Use content or fallback to description
        let textToSummarize = content;
        if (!content || content.length < 100) {
            if (description && description.length > 20) {
                textToSummarize = `Page: ${title}. ${description}`;
            } else {
                throw new Error('Page has insufficient content to summarize');
            }
        }

        summarizeBtn.querySelector('span').textContent = 'Summarizing...';

        // Step 2: Summarize the content
        const summaryResponse = await chrome.runtime.sendMessage({
            action: 'summarize',
            text: textToSummarize
        });

        if (!summaryResponse.success) {
            throw new Error(summaryResponse.error || 'Failed to summarize');
        }

        // Display summary
        summaryText.textContent = summaryResponse.summary;
        summaryResult.classList.remove('hidden');

    } catch (error) {
        console.error('Summarization error:', error);
        summaryText.textContent = 'Error: ' + error.message;
        summaryResult.classList.remove('hidden');
    } finally {
        isSummarizing = false;
        summarizeBtn.classList.remove('loading');
        summarizeBtn.querySelector('span').textContent = 'Summarize This Page';
        summarizeBtn.disabled = false;
    }
}
