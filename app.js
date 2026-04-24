const BASE_URL = 'https://devapigw.vidalhealthtpa.com/srm-quiz-task';

// State management
let state = {
    regNo: '',
    processedEvents: new Set(),
    participants: {}, 
    totalIncomingEvents: 0,
    isPolling: false,
    pollResults: []
};

// UI Elements
const terminal = document.getElementById('terminal-out');
const leaderboardBody = document.getElementById('leaderboard-body');
const grandTotalEl = document.getElementById('grand-total');
const eventCountEl = document.getElementById('event-count');
const sysStatusEl = document.getElementById('sys-status');
const startBtn = document.getElementById('start-btn');
const submitBtn = document.getElementById('submit-btn');
const exportBtn = document.getElementById('export-btn');
const efficiencyEl = document.getElementById('efficiency-val');
const densityEl = document.getElementById('density-val');
const healthText = document.getElementById('health-text');

function log(message, type = 'info') {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    const timestamp = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    entry.textContent = `[${timestamp}] ${message}`;
    terminal.appendChild(entry);
    terminal.scrollTop = terminal.scrollHeight;
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * ELITE FEATURE: Exponential Backoff Retry Engine
 * Ensures the system recovers from transient network failures.
 */
async function fetchWithRetry(url, retries = 3, backoff = 1000) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
        } catch (err) {
            if (i === retries - 1) throw err;
            const waitTime = backoff * Math.pow(2, i);
            log(`Network glitch. Retrying in ${waitTime}ms... (Attempt ${i + 1}/${retries})`, 'warn');
            await sleep(waitTime);
        }
    }
}

async function fetchPoll(index) {
    const url = `${BASE_URL}/quiz/messages?regNo=${state.regNo}&poll=${index}`;
    try {
        log(`Polling index ${index}...`, 'info');
        healthText.textContent = "Processing Stream...";
        
        const data = await fetchWithRetry(url);
        processEvents(data.events || []);
        updateUI();
        
        healthText.textContent = "System Normal";
        return data;
    } catch (error) {
        log(`Critical failure on poll ${index}: ${error.message}`, 'warn');
        healthText.textContent = "Recovery Mode";
        return null;
    }
}

function processEvents(events) {
    state.totalIncomingEvents += events.length;
    events.forEach(event => {
        const key = `${event.roundId}_${event.participant}`;
        if (!state.processedEvents.has(key)) {
            state.processedEvents.add(key);
            if (!state.participants[event.participant]) {
                state.participants[event.participant] = 0;
            }
            state.participants[event.participant] += event.score;
            log(`Verified: ${event.participant} +${event.score}`, 'success');
        } else {
            log(`Duplicate skipped: ${event.participant} in ${event.roundId}`, 'warn');
        }
    });
}

function updateUI() {
    eventCountEl.textContent = state.processedEvents.size;
    
    // Calculate Analytics
    const efficiency = state.totalIncomingEvents > 0 
        ? Math.round((state.processedEvents.size / state.totalIncomingEvents) * 100) 
        : 0;
    
    efficiencyEl.textContent = `${efficiency}%`;
    densityEl.textContent = `${state.processedEvents.size}/${state.totalIncomingEvents}`;

    let total = 0;
    const sortedLeaderboard = Object.entries(state.participants)
        .map(([name, score]) => {
            total += score;
            return { participant: name, totalScore: score };
        })
        .sort((a, b) => b.totalScore - a.totalScore);
    
    grandTotalEl.textContent = total;
    const maxScore = sortedLeaderboard.length > 0 ? sortedLeaderboard[0].totalScore : 1;

    leaderboardBody.innerHTML = '';
    sortedLeaderboard.forEach(item => {
        const percentage = (item.totalScore / maxScore) * 100;
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>
                <div class="row-participant">
                    <div class="avatar">${item.participant.charAt(0)}</div>
                    <span>${item.participant}</span>
                </div>
            </td>
            <td><span class="total-score-badge">${item.totalScore}</span></td>
            <td>
                <div style="font-size: 10px; color: var(--success); margin-bottom: 4px;">SYNCED</div>
                <div class="dist-bar-container"><div class="dist-bar" style="width: ${percentage}%"></div></div>
            </td>
        `;
        leaderboardBody.appendChild(row);
    });
}

async function startEngine() {
    state.regNo = document.getElementById('regNo').value.trim();
    if (!state.regNo) { alert("Registration ID Required"); return; }

    state.isPolling = true;
    startBtn.disabled = true;
    sysStatusEl.textContent = 'POLLING';
    
    for (let i = 0; i < 10; i++) {
        const step = document.querySelector(`.step[data-index="${i}"]`);
        step.classList.add('active');
        await fetchPoll(i);
        if (i < 9) {
            log('Wait 5s (Mandatory Interval)...', 'info');
            await sleep(5000);
            step.classList.remove('active');
            step.classList.add('completed');
        } else {
            step.classList.remove('active');
            step.classList.add('completed');
        }
    }
    log('System synchronized. Ready for submission.', 'success');
    sysStatusEl.textContent = 'SYNCED';
    submitBtn.disabled = false;
}

/**
 * ELITE FEATURE: JSON Artifact Export
 * Allows users to download the state for external verification.
 */
function exportData() {
    const data = {
        regNo: state.regNo,
        timestamp: new Date().toISOString(),
        efficiency: efficiencyEl.textContent,
        leaderboard: Object.entries(state.participants).map(([p, s]) => ({ participant: p, score: s }))
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `quiz_leaderboard_${state.regNo}.json`;
    a.click();
    log('State exported as JSON artifact.', 'info');
}

async function submitResults() {
    const leaderboard = Object.entries(state.participants).map(([name, score]) => ({
        participant: name,
        totalScore: score
    }));

    try {
        const response = await fetch(`${BASE_URL}/quiz/submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ regNo: state.regNo, leaderboard })
        });
        const result = await response.json();
        if (result.isCorrect) showModal(result);
        else log(`API Error: ${result.message}`, 'warn');
    } catch (error) {
        log(`Submission Error: ${error.message}`, 'warn');
    }
}

function showModal(result) {
    document.getElementById('final-modal').style.display = 'flex';
    document.getElementById('modal-expected').textContent = result.expectedTotal;
    document.getElementById('modal-submitted').textContent = result.submittedTotal;
    document.getElementById('final-msg').textContent = "Validator Verified: Correct!";
}

startBtn.addEventListener('click', startEngine);
submitBtn.addEventListener('click', submitResults);
exportBtn.addEventListener('click', exportData);
