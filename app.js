/**
 * Codeforces Problem Generator
 * Fetches and displays problems from Codeforces API based on user preferences
 */

// ============================================
// Constants & Configuration
// ============================================
const API_URL = 'https://codeforces.com/api/problemset.problems';
const PROBLEM_URL_BASE = 'https://codeforces.com/problemset/problem';

// ============================================
// DOM Elements
// ============================================
const elements = {
    ratingInput: document.getElementById('rating'),
    quantityInput: document.getElementById('quantity'),
    tagsInput: document.getElementById('tags'),
    excludeTagsInput: document.getElementById('excludeTags'),
    fetchBtn: document.getElementById('fetchBtn'),
    loading: document.getElementById('loading'),
    loadingText: document.getElementById('loadingText'),
    error: document.getElementById('error'),
    problemsContainer: document.getElementById('problemsContainer'),
    resultsCount: document.getElementById('resultsCount'),
    tagChips: document.querySelectorAll('.tag-chip'),
    problemIdsSidebar: document.getElementById('problemIdsSidebar'),
    problemIdsList: document.getElementById('problemIdsList'),
    copyIdsBtn: document.getElementById('copyIdsBtn'),
    fetchStatementsToggle: document.getElementById('fetchStatementsToggle'),
    statementsSection: document.getElementById('statementsSection'),
    problemStatementsList: document.getElementById('problemStatementsList'),
    copyStatementsBtn: document.getElementById('copyStatementsBtn')
};

// ============================================
// State
// ============================================
let problemsCache = null;
let selectedTags = new Set();
let currentProblems = [];

// ============================================
// Event Listeners
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    elements.fetchBtn.addEventListener('click', handleFetch);

    // Tag chip click handlers
    elements.tagChips.forEach(chip => {
        chip.addEventListener('click', () => handleTagChipClick(chip));
    });

    // Enter key support
    [elements.ratingInput, elements.quantityInput, elements.tagsInput].forEach(input => {
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleFetch();
        });
    });

    // Copy button handlers
    elements.copyIdsBtn.addEventListener('click', handleCopyIds);
    elements.copyStatementsBtn.addEventListener('click', handleCopyStatements);
});

// ============================================
// Tag Chip Handler
// ============================================
function handleTagChipClick(chip) {
    const tag = chip.dataset.tag;

    if (selectedTags.has(tag)) {
        selectedTags.delete(tag);
        chip.classList.remove('active');
    } else {
        selectedTags.add(tag);
        chip.classList.add('active');
    }

    updateTagsInput();
}

function updateTagsInput() {
    elements.tagsInput.value = Array.from(selectedTags).join(', ');
}

// ============================================
// Main Fetch Handler
// ============================================
async function handleFetch() {
    const rating = parseInt(elements.ratingInput.value) || 1200;
    const quantity = Math.min(Math.max(parseInt(elements.quantityInput.value) || 10, 1), 50);
    const tagsString = elements.tagsInput.value.trim();
    const tags = tagsString ? tagsString.split(',').map(t => t.trim().toLowerCase()).filter(t => t) : [];
    const fetchStatements = elements.fetchStatementsToggle.checked;

    // Validate rating
    if (rating < 800 || rating > 3500) {
        showError('Rating must be between 800 and 3500');
        return;
    }

    showLoading(true, 'Fetching problems from Codeforces...');
    hideError();
    clearProblems();

    try {
        const problems = await fetchProblems(tags);
        const excludeTagsString = elements.excludeTagsInput.value.trim();
        const excludeTags = excludeTagsString ? excludeTagsString.split(',').map(t => t.trim().toLowerCase()).filter(t => t) : [];
        const filteredProblems = filterProblems(problems, rating, tags, excludeTags, quantity);
        currentProblems = filteredProblems;
        displayProblems(filteredProblems);

        // Fetch statements if toggle is on
        if (fetchStatements && filteredProblems.length > 0) {
            await fetchAndDisplayStatements(filteredProblems);
        }
    } catch (err) {
        showError(err.message);
    } finally {
        showLoading(false);
    }
}

// ============================================
// API Functions
// ============================================
async function fetchProblems(tags) {
    // Build URL with optional tags parameter
    let url = API_URL;
    if (tags.length > 0) {
        // Codeforces uses semicolon-separated tags
        url += `?tags=${encodeURIComponent(tags.join(';'))}`;
    }

    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
    }

    const data = await response.json();

    if (data.status !== 'OK') {
        throw new Error(data.comment || 'Failed to fetch problems');
    }

    // Cache the results with statistics
    return {
        problems: data.result.problems,
        statistics: data.result.problemStatistics
    };
}

// ============================================
// Fetch Problem Statements
// ============================================
async function fetchAndDisplayStatements(problems) {
    const statements = [];

    for (let i = 0; i < problems.length; i++) {
        const problem = problems[i];
        const problemId = `${problem.contestId}${problem.index}`;
        showLoading(true, `Fetching statement ${i + 1}/${problems.length}: ${problemId}...`);

        try {
            const statement = await fetchProblemStatement(problem.contestId, problem.index, problem.name);
            statements.push(statement);
        } catch (err) {
            statements.push(`=== ${problemId}: ${problem.name} ===\n[Failed to fetch statement]\n`);
        }

        // Small delay to avoid rate limiting
        if (i < problems.length - 1) {
            await delay(300);
        }
    }

    // Display statements
    const allStatements = statements.join('\n\n' + '='.repeat(60) + '\n\n');
    elements.problemStatementsList.value = allStatements;
    elements.statementsSection.classList.remove('hidden');
}

async function fetchProblemStatement(contestId, index, name) {
    const url = `https://codeforces.com/problemset/problem/${contestId}/${index}`;

    // Use a CORS proxy for fetching the problem page
    // Note: In the Electron app, we can fetch directly
    try {
        const response = await fetch(url);
        const html = await response.text();

        // Parse the HTML to extract the problem statement
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        const problemId = `${contestId}${index}`;
        let statement = `=== ${problemId}: ${name} ===\n`;
        statement += `URL: ${url}\n\n`;

        // Get the problem statement div
        const statementDiv = doc.querySelector('.problem-statement');
        if (statementDiv) {
            // Get title
            const title = statementDiv.querySelector('.title');
            if (title) {
                statement += title.textContent.trim() + '\n\n';
            }

            // Get the main problem text (div without class after header)
            const problemBody = statementDiv.querySelector('div:not(.header):not(.title):not(.time-limit):not(.memory-limit):not(.input-specification):not(.output-specification):not(.sample-tests):not(.note)');

            // Get all text content sections
            const sections = statementDiv.querySelectorAll('.header, .time-limit, .memory-limit, .input-specification, .output-specification');
            sections.forEach(section => {
                statement += section.textContent.trim().replace(/\s+/g, ' ') + '\n';
            });

            // Get main problem description - all direct text in paragraph form
            const paragraphs = statementDiv.querySelectorAll('p');
            paragraphs.forEach(p => {
                const text = p.textContent.trim();
                if (text) {
                    statement += '\n' + text;
                }
            });

            // Get sample tests
            const sampleTests = statementDiv.querySelector('.sample-tests');
            if (sampleTests) {
                statement += '\n\n--- Sample Tests ---\n';
                const inputs = sampleTests.querySelectorAll('.input pre');
                const outputs = sampleTests.querySelectorAll('.output pre');

                for (let i = 0; i < inputs.length; i++) {
                    statement += `\nInput ${i + 1}:\n${inputs[i].textContent.trim()}\n`;
                    if (outputs[i]) {
                        statement += `\nOutput ${i + 1}:\n${outputs[i].textContent.trim()}\n`;
                    }
                }
            }

            // Get note if exists
            const note = statementDiv.querySelector('.note');
            if (note) {
                statement += '\n\n--- Note ---\n' + note.textContent.trim();
            }
        } else {
            statement += '[Could not parse problem statement]';
        }

        return statement;
    } catch (err) {
        return `=== ${contestId}${index}: ${name} ===\n[Error fetching: ${err.message}]\n`;
    }
}

// ============================================
// Filter & Process Problems
// ============================================
function filterProblems(data, targetRating, tags, excludeTags, quantity) {
    const { problems, statistics } = data;

    // Create a map for quick statistics lookup
    const statsMap = new Map();
    statistics.forEach(stat => {
        const key = `${stat.contestId}-${stat.index}`;
        statsMap.set(key, stat);
    });

    // Filter problems by rating and exclude tags
    let filtered = problems.filter(problem => {
        // Must have a rating
        if (!problem.rating) return false;

        // Must match the target rating
        if (problem.rating !== targetRating) return false;

        // Exclude problems with any of the excluded tags
        if (excludeTags.length > 0) {
            const problemTags = problem.tags.map(t => t.toLowerCase());
            for (const excludeTag of excludeTags) {
                if (problemTags.includes(excludeTag)) {
                    return false;
                }
            }
        }

        return true;
    });

    // Shuffle for variety
    filtered = shuffleArray(filtered);

    // Take requested quantity
    filtered = filtered.slice(0, quantity);

    // Attach statistics to each problem
    return filtered.map(problem => {
        const key = `${problem.contestId}-${problem.index}`;
        const stats = statsMap.get(key);
        return {
            ...problem,
            solvedCount: stats ? stats.solvedCount : 0
        };
    });
}

// ============================================
// Display Functions
// ============================================
function displayProblems(problems) {
    if (problems.length === 0) {
        showError('No problems found matching your criteria. Try adjusting the rating or tags.');
        return;
    }

    elements.resultsCount.textContent = `${problems.length} problem${problems.length > 1 ? 's' : ''} found`;

    // Generate problem IDs list for sidebar
    const problemIds = problems.map(p => `${p.contestId}${p.index}`).join('\n');
    elements.problemIdsList.value = problemIds;
    elements.problemIdsSidebar.classList.remove('hidden');

    problems.forEach((problem, index) => {
        const card = createProblemCard(problem, index);
        elements.problemsContainer.appendChild(card);
    });
}

function createProblemCard(problem, index) {
    const card = document.createElement('div');
    card.className = 'problem-card';
    card.style.animationDelay = `${index * 0.05}s`;

    const problemUrl = `${PROBLEM_URL_BASE}/${problem.contestId}/${problem.index}`;
    const ratingClass = getRatingClass(problem.rating);

    card.innerHTML = `
        <div class="problem-header">
            <span class="problem-id">${problem.contestId}${problem.index}</span>
            <span class="problem-rating ${ratingClass}">${problem.rating}</span>
        </div>
        <h3 class="problem-title">
            <a href="${problemUrl}" target="_blank" rel="noopener">${escapeHtml(problem.name)}</a>
        </h3>
        <div class="problem-tags">
            ${problem.tags.map(tag => `<span class="problem-tag">${escapeHtml(tag)}</span>`).join('')}
        </div>
        <div class="problem-stats">
            <div class="stat">
                <span>👥</span>
                <span>${formatNumber(problem.solvedCount)} solved</span>
            </div>
            <div class="stat">
                <span>📊</span>
                <span>Contest ${problem.contestId}</span>
            </div>
        </div>
    `;

    return card;
}

function getRatingClass(rating) {
    // Round down to nearest 100 for class matching
    const ratingLevel = Math.floor(rating / 100) * 100;
    return `rating-${ratingLevel}`;
}

// ============================================
// UI Helper Functions
// ============================================
function showLoading(show, message = 'Fetching problems from Codeforces...') {
    elements.loading.classList.toggle('hidden', !show);
    elements.fetchBtn.disabled = show;
    if (elements.loadingText) {
        elements.loadingText.textContent = message;
    }
}

function showError(message) {
    elements.error.textContent = message;
    elements.error.classList.remove('hidden');
}

function hideError() {
    elements.error.classList.add('hidden');
}

function clearProblems() {
    elements.problemsContainer.innerHTML = '';
    elements.resultsCount.textContent = '';
    elements.problemIdsList.value = '';
    elements.problemIdsSidebar.classList.add('hidden');
    elements.problemStatementsList.value = '';
    elements.statementsSection.classList.add('hidden');
    currentProblems = [];
}

// ============================================
// Copy Handlers
// ============================================
async function handleCopyIds() {
    await copyToClipboard(elements.problemIdsList.value, elements.copyIdsBtn);
}

async function handleCopyStatements() {
    await copyToClipboard(elements.problemStatementsList.value, elements.copyStatementsBtn);
}

async function copyToClipboard(text, btn) {
    try {
        await navigator.clipboard.writeText(text);

        // Visual feedback
        const originalText = btn.querySelector('span').textContent;
        btn.classList.add('copied');
        btn.querySelector('span').textContent = 'Copied!';

        setTimeout(() => {
            btn.classList.remove('copied');
            btn.querySelector('span').textContent = originalText;
        }, 2000);
    } catch (err) {
        // Fallback for older browsers
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
    }
}

// ============================================
// Utility Functions
// ============================================
function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatNumber(num) {
    if (num >= 1000000) {
        return (num / 1000000).toFixed(1) + 'M';
    }
    if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
