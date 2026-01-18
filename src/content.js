// content.js - Gmail DOM extraction and automation
// Runs in the context of Gmail pages

// Gmail DOM Selectors
const SELECTORS = {
    // Email list
    emailRows: 'tr.zA',
    emailRowUnread: 'tr.zA.zE',
    sender: '.yW span[email], .yW span[name]',
    senderName: '.zF, .yP',
    subject: '.y6 span:first-child, .bog',
    snippet: '.y2',
    date: '.xW span[title], .xW span',
    starred: '.T-KT.T-KT-Jp',
    checkbox: '.oZ-jc',

    // Open email
    emailBody: '.a3s.aiL, .ii.gt',
    emailSubject: 'h2.hP',
    emailFrom: '.gD[email]',
    emailTo: '.g2',
    emailDate: '.g3',

    // Compose
    composeButton: '.T-I.T-I-KE.L3',
    composeBody: '.Am.Al.editable',
    composeTo: '.vO',
    composeSubject: '.aoT',

    // Navigation
    inboxLink: 'a[href*="#inbox"]',
    searchBox: 'input[name="q"]',
    moreButton: '.T-I.J-J5-Ji.T-I-KE.mA',
};

// Extract email list from inbox view
function getEmailList() {
    const rows = document.querySelectorAll(SELECTORS.emailRows);
    const emails = [];

    rows.forEach((row, index) => {
        try {
            const senderEl = row.querySelector(SELECTORS.sender) || row.querySelector(SELECTORS.senderName);
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
                isUnread,
                isStarred,
            });
        } catch (e) {
            console.error('[BroTrans] Error extracting email row:', e);
        }
    });

    return emails;
}

// Extract open email content
function getOpenEmail() {
    const bodyEl = document.querySelector(SELECTORS.emailBody);
    if (!bodyEl) {
        return null;
    }

    const subjectEl = document.querySelector(SELECTORS.emailSubject);
    const fromEl = document.querySelector(SELECTORS.emailFrom);
    const dateEl = document.querySelector(SELECTORS.emailDate);

    return {
        subject: subjectEl?.textContent?.trim() || 'No subject',
        from: fromEl?.getAttribute('email') || fromEl?.textContent?.trim() || 'Unknown',
        date: dateEl?.textContent?.trim() || '',
        body: bodyEl?.textContent?.trim() || '',
        bodyHtml: bodyEl?.innerHTML || '',
    };
}

// Get email context for LLM
function getEmailContext() {
    const openEmail = getOpenEmail();
    if (openEmail) {
        return {
            type: 'open_email',
            emailContext: `Open email:\nFrom: ${openEmail.from}\nSubject: ${openEmail.subject}\nDate: ${openEmail.date}\n\nContent:\n${openEmail.body.substring(0, 2000)}`,
        };
    }

    const emails = getEmailList();
    if (emails.length > 0) {
        const emailSummary = emails.slice(0, 10).map((e, i) =>
            `${i + 1}. ${e.isUnread ? '[UNREAD] ' : ''}${e.sender}: "${e.subject}" - ${e.snippet.substring(0, 50)}...`
        ).join('\n');

        return {
            type: 'inbox',
            emailContext: `Inbox (${emails.length} visible emails, ${emails.filter(e => e.isUnread).length} unread):\n${emailSummary}`,
            totalEmails: emails.length,
            unreadCount: emails.filter(e => e.isUnread).length,
        };
    }

    return { type: 'none', emailContext: null };
}

// Open email by index
function openEmail(index) {
    const rows = document.querySelectorAll(SELECTORS.emailRows);
    if (index >= 0 && index < rows.length) {
        rows[index].click();
        return { success: true, message: `Opened email ${index + 1}` };
    }
    return { success: false, error: `Email index ${index} not found` };
}

// Search emails
function searchEmails(query) {
    const searchBox = document.querySelector(SELECTORS.searchBox);
    if (searchBox) {
        searchBox.value = query;
        searchBox.dispatchEvent(new Event('input', { bubbles: true }));

        // Submit search
        const form = searchBox.closest('form');
        if (form) {
            form.dispatchEvent(new Event('submit', { bubbles: true }));
        } else {
            // Fallback: press Enter
            searchBox.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Enter',
                code: 'Enter',
                keyCode: 13,
                bubbles: true,
            }));
        }

        return { success: true, message: `Searching for: ${query}` };
    }
    return { success: false, error: 'Search box not found' };
}

// Filter unread emails
function filterUnread() {
    return searchEmails('is:unread');
}

// Scroll inbox
function scrollInbox(direction = 'down') {
    const scrollContainer = document.querySelector('.AO, .nH.bkK');
    if (scrollContainer) {
        const scrollAmount = direction === 'down' ? 500 : -500;
        scrollContainer.scrollBy({ top: scrollAmount, behavior: 'smooth' });
        return { success: true, message: `Scrolled ${direction}` };
    }
    return { success: false, error: 'Scroll container not found' };
}

// Summarize inbox
function summarizeInbox() {
    const emails = getEmailList();
    if (emails.length === 0) {
        return { success: false, error: 'No emails found in inbox' };
    }

    const unreadCount = emails.filter(e => e.isUnread).length;
    const starredCount = emails.filter(e => e.isStarred).length;

    // Group by sender
    const senderCounts = {};
    emails.forEach(e => {
        senderCounts[e.sender] = (senderCounts[e.sender] || 0) + 1;
    });

    const topSenders = Object.entries(senderCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([sender, count]) => `${sender} (${count})`);

    return {
        success: true,
        summary: {
            total: emails.length,
            unread: unreadCount,
            starred: starredCount,
            topSenders,
            emails: emails.slice(0, 10),
        },
    };
}

// Summarize open email
function summarizeEmail() {
    const email = getOpenEmail();
    if (!email) {
        return { success: false, error: 'No email is currently open' };
    }

    return {
        success: true,
        email: {
            from: email.from,
            subject: email.subject,
            date: email.date,
            bodyPreview: email.body.substring(0, 500) + (email.body.length > 500 ? '...' : ''),
            wordCount: email.body.split(/\s+/).length,
        },
    };
}

// Analyze sentiment of current email
function analyzeSentiment() {
    const email = getOpenEmail();
    if (!email) {
        const emails = getEmailList();
        if (emails.length === 0) {
            return { success: false, error: 'No email content to analyze' };
        }
        return {
            success: true,
            type: 'inbox',
            content: emails.slice(0, 5).map(e => `${e.subject}: ${e.snippet}`).join('\n'),
        };
    }

    return {
        success: true,
        type: 'email',
        content: `${email.subject}\n\n${email.body.substring(0, 1000)}`,
    };
}

// Draft reply (opens compose and inserts text)
function draftReply(text) {
    // Try to find reply button
    const replyButton = document.querySelector('.ams.bkH, [data-tooltip="Reply"]');
    if (replyButton) {
        replyButton.click();

        // Wait for compose to open and insert text
        setTimeout(() => {
            const composeBody = document.querySelector(SELECTORS.composeBody);
            if (composeBody) {
                composeBody.innerHTML = text;
                composeBody.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }, 500);

        return { success: true, message: 'Opening reply with draft text' };
    }

    // Fallback: open compose
    const composeButton = document.querySelector(SELECTORS.composeButton);
    if (composeButton) {
        composeButton.click();

        setTimeout(() => {
            const composeBody = document.querySelector(SELECTORS.composeBody);
            if (composeBody) {
                composeBody.innerHTML = text;
                composeBody.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }, 500);

        return { success: true, message: 'Opening compose with draft text' };
    }

    return { success: false, error: 'Could not open reply/compose' };
}

// Message handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const { action, params = {} } = message;

    console.log('[BroTrans Content] Received action:', action, params);

    try {
        switch (action) {
            case 'get_emails':
                sendResponse({ success: true, emails: getEmailList() });
                break;

            case 'get_open_email':
                const openEmail = getOpenEmail();
                sendResponse(openEmail ? { success: true, email: openEmail } : { success: false, error: 'No email open' });
                break;

            case 'get_email_context':
                sendResponse(getEmailContext());
                break;

            case 'open_email':
                sendResponse(openEmail(params.index || 0));
                break;

            case 'search':
                sendResponse(searchEmails(params.query || ''));
                break;

            case 'filter_unread':
                sendResponse(filterUnread());
                break;

            case 'scroll':
                sendResponse(scrollInbox(params.direction || 'down'));
                break;

            case 'summarize_inbox':
                sendResponse(summarizeInbox());
                break;

            case 'summarize_email':
                sendResponse(summarizeEmail());
                break;

            case 'analyze_sentiment':
                sendResponse(analyzeSentiment());
                break;

            case 'draft_reply':
                sendResponse(draftReply(params.text || ''));
                break;

            default:
                sendResponse({ success: false, error: `Unknown action: ${action}` });
        }
    } catch (error) {
        console.error('[BroTrans Content] Error:', error);
        sendResponse({ success: false, error: error.message });
    }

    return true; // Async response
});

// Inject indicator that extension is active
function injectIndicator() {
    if (document.getElementById('brotrans-indicator')) {
        return;
    }

    const indicator = document.createElement('div');
    indicator.id = 'brotrans-indicator';
    indicator.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 12px;
        height: 12px;
        background: linear-gradient(135deg, #8b5cf6, #d946ef);
        border-radius: 50%;
        box-shadow: 0 2px 8px rgba(139, 92, 246, 0.4);
        z-index: 10000;
        opacity: 0.7;
        transition: opacity 0.3s;
    `;
    indicator.title = 'BroTrans is active';

    indicator.addEventListener('mouseenter', () => indicator.style.opacity = '1');
    indicator.addEventListener('mouseleave', () => indicator.style.opacity = '0.7');

    document.body.appendChild(indicator);
}

// Initialize
if (window.location.hostname === 'mail.google.com') {
    console.log('[BroTrans] Content script loaded on Gmail');

    // Wait for Gmail to fully load
    const observer = new MutationObserver((mutations, obs) => {
        if (document.querySelector(SELECTORS.emailRows) || document.querySelector(SELECTORS.emailBody)) {
            injectIndicator();
            obs.disconnect();
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Fallback timeout
    setTimeout(() => {
        injectIndicator();
        observer.disconnect();
    }, 5000);
}
