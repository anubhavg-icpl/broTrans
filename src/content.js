// content.js - Gmail DOM extraction and automation for BroTrans

console.log('[BroTrans] Content script loaded on Gmail');

// Gmail DOM selectors
const SELECTORS = {
    emailRows: 'tr.zA',
    emailRowUnread: 'tr.zA.zE',
    sender: '.yW span[email], .yW span[name], .yP',
    subject: '.y6 span:first-child, .bog',
    snippet: '.y2',
    date: '.xW span[title], .xW span',
    starred: '.T-KT.T-KT-Jp',
    emailBody: '.a3s.aiL, .ii.gt',
    emailHeader: '.ha h2, .hP',
    searchBox: 'input[name="q"]',
    composeBody: '.Am.Al.editable, .Ar.Au div[contenteditable="true"]',
};

// Get email list from inbox
function getEmailList() {
    const rows = document.querySelectorAll(SELECTORS.emailRows);
    const emails = [];

    rows.forEach((row, index) => {
        if (index >= 50) return; // Limit to 50 visible emails

        const senderEl = row.querySelector(SELECTORS.sender);
        const subjectEl = row.querySelector(SELECTORS.subject);
        const snippetEl = row.querySelector(SELECTORS.snippet);
        const dateEl = row.querySelector(SELECTORS.date);
        const isUnread = row.classList.contains('zE');
        const isStarred = row.querySelector(SELECTORS.starred) !== null;

        emails.push({
            index,
            sender: senderEl?.getAttribute('email') || senderEl?.getAttribute('name') || senderEl?.textContent?.trim() || 'Unknown',
            subject: subjectEl?.textContent?.trim() || 'No subject',
            snippet: snippetEl?.textContent?.trim() || '',
            date: dateEl?.getAttribute('title') || dateEl?.textContent?.trim() || '',
            unread: isUnread,
            starred: isStarred,
        });
    });

    return emails;
}

// Get currently open email
function getOpenEmail() {
    const bodyEl = document.querySelector(SELECTORS.emailBody);
    if (!bodyEl) return null;

    const headerEl = document.querySelector(SELECTORS.emailHeader);
    const senderEl = document.querySelector('.gD');

    return {
        sender: senderEl?.getAttribute('email') || senderEl?.textContent?.trim() || 'Unknown',
        subject: headerEl?.textContent?.trim() || 'No subject',
        body: bodyEl?.textContent?.trim()?.slice(0, 2000) || '',
        wordCount: bodyEl?.textContent?.trim()?.split(/\s+/)?.length || 0,
    };
}

// Get email context
function getEmailContext() {
    return {
        emails: getEmailList(),
        openEmail: getOpenEmail(),
        url: window.location.href,
    };
}

// Search emails
function searchEmails(query) {
    const searchBox = document.querySelector(SELECTORS.searchBox);
    if (searchBox) {
        searchBox.value = query;
        searchBox.dispatchEvent(new Event('input', { bubbles: true }));
        const form = searchBox.closest('form');
        if (form) form.submit();
        return { success: true, message: `Searching: ${query}` };
    }
    return { error: 'Search box not found' };
}

// Filter unread
function filterUnread() {
    return searchEmails('is:unread');
}

// Summarize inbox
function summarizeInbox() {
    const emails = getEmailList();
    const unread = emails.filter(e => e.unread).length;
    const starred = emails.filter(e => e.starred).length;

    const senderCount = {};
    emails.forEach(e => {
        senderCount[e.sender] = (senderCount[e.sender] || 0) + 1;
    });
    const topSenders = Object.entries(senderCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name]) => name);

    return {
        summary: {
            total: emails.length,
            unread,
            starred,
            topSenders,
        }
    };
}

// Summarize current email
function summarizeEmail() {
    const email = getOpenEmail();
    if (!email) return { error: 'No email open' };

    return {
        email: {
            from: email.sender,
            subject: email.subject,
            wordCount: email.wordCount,
            preview: email.body.slice(0, 300) + '...',
        }
    };
}

// Open email by index
function openEmail(index) {
    const rows = document.querySelectorAll(SELECTORS.emailRows);
    if (rows[index]) {
        rows[index].click();
        return { success: true, message: `Opened email ${index + 1}` };
    }
    return { error: `Email ${index + 1} not found` };
}

// Scroll inbox
function scrollInbox(direction) {
    const container = document.querySelector('.AO');
    if (container) {
        const amount = direction === 'up' ? -300 : 300;
        container.scrollBy({ top: amount, behavior: 'smooth' });
        return { success: true, message: `Scrolled ${direction}` };
    }
    return { error: 'Could not scroll' };
}

// Draft reply
function draftReply(text) {
    const replyBtn = document.querySelector('[data-tooltip="Reply"]');
    if (replyBtn) {
        replyBtn.click();
        setTimeout(() => {
            const composeBody = document.querySelector(SELECTORS.composeBody);
            if (composeBody) {
                composeBody.innerHTML = text;
            }
        }, 500);
        return { success: true, message: 'Reply drafted' };
    }
    return { error: 'Reply button not found' };
}

// Analyze sentiment (placeholder - AI does this)
function analyzeSentiment() {
    const email = getOpenEmail();
    if (!email) return { error: 'No email open' };
    return { email, message: 'AI will analyze sentiment' };
}

// Message handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const { action, params } = message;

    try {
        switch (action) {
            case 'get_email_context':
                sendResponse({ emailContext: getEmailContext() });
                break;

            case 'get_emails':
                sendResponse({ emails: getEmailList() });
                break;

            case 'summarize_inbox':
                sendResponse(summarizeInbox());
                break;

            case 'summarize_email':
                sendResponse(summarizeEmail());
                break;

            case 'filter_unread':
                sendResponse(filterUnread());
                break;

            case 'search':
                sendResponse(searchEmails(params?.query || ''));
                break;

            case 'open_email':
                sendResponse(openEmail(params?.index || 0));
                break;

            case 'scroll':
                sendResponse(scrollInbox(params?.direction || 'down'));
                break;

            case 'draft_reply':
                sendResponse(draftReply(params?.text || ''));
                break;

            case 'analyze_sentiment':
                sendResponse(analyzeSentiment());
                break;

            default:
                sendResponse({ error: `Unknown action: ${action}` });
        }
    } catch (error) {
        console.error('[BroTrans] Content script error:', error);
        sendResponse({ error: error.message });
    }

    return true;
});

console.log('[BroTrans] Gmail content script ready');
