import { supabase } from './supabase-config.js';
import { initializeNotifications, sendSystemNotification } from './shared/notifications-manager.js';
import './toast.js';

const FAST2SMS_KEY = 'YOUR_FAST2SMS_API_KEY';

const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
let sessionTimer = null;

function startSessionTimer() {
    clearTimeout(sessionTimer);
    sessionTimer = setTimeout(() => {
        supabase.auth.signOut();
        sessionStorage.clear();
        showToast('Session expired due to inactivity. Please log in again.', 'warning');
        setTimeout(() => goToScreen('login-screen'), 1500);
    }, SESSION_TIMEOUT_MS);
}

['click', 'keydown', 'touchstart', 'mousemove'].forEach(event => {
    document.addEventListener(event, () => {
        if (sessionStorage.getItem('kisansetu_session_active')) startSessionTimer();
    });
});

function updateConnectivityStatus() {
    const indicator = document.getElementById('connectivity-indicator');
    if (!indicator) return;
    if (navigator.onLine) {
        indicator.textContent = '🟢 Online';
        indicator.style.color = '#2e7d32';
        syncPendingOfflineData();
    } else {
        indicator.textContent = '🔴 Offline';
        indicator.style.color = '#d32f2f';
        showToast('You are offline. Data will sync when connected.', 'warning');
    }
}
window.addEventListener('online', updateConnectivityStatus);
window.addEventListener('offline', updateConnectivityStatus);

function syncPendingOfflineData() {
    const pending = JSON.parse(localStorage.getItem('kisansetu_offline_queue') || '[]');
    if (pending.length === 0) return;
    showToast(`Syncing ${pending.length} offline record(s)...`, 'info');
    localStorage.removeItem('kisansetu_offline_queue');
    showToast('Offline data synced successfully.', 'success');
}

function goToScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const target = document.getElementById(screenId);
    if (target) target.classList.add('active');
}
window.goToScreen = goToScreen;

window.onload = () => {
    updateConnectivityStatus();
    initVoiceInterface();
    setTimeout(() => goToScreen('language-screen'), 2500);
};

// ── Voice Interface ───────────────────────────────────────────────────────────
let _voiceIsListening = false;

function _resetVoiceBtn() {
    _voiceIsListening = false;
    const btn = document.getElementById('voice-btn');
    if (!btn) return;
    btn.classList.remove('listening');
    btn.innerHTML = '<i class="fa-solid fa-microphone"></i>';
}

function _setVoiceBtnListening() {
    _voiceIsListening = true;
    const btn = document.getElementById('voice-btn');
    if (!btn) return;
    btn.classList.add('listening');
    btn.innerHTML = '<i class="fa-solid fa-stop"></i>';
}

function initVoiceInterface() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        const vs = document.querySelector('.voice-section');
        if (vs) vs.style.display = 'none';
        return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-IN';
    recognition.interimResults = false;
    recognition.maxAlternatives = 3;
    recognition.continuous = false;

    window.startVoiceLogin = function () {
        if (_voiceIsListening) {
            try { recognition.stop(); } catch (e) { }
            _resetVoiceBtn();
            return;
        }
        try {
            recognition.start();
            _setVoiceBtnListening();
            const activeScreen = document.querySelector('.screen.active');
            const screenId = activeScreen ? activeScreen.id : '';
            if (screenId === 'otp-screen') {
                showToast('🎙️ Say your 4-digit OTP or say "verify"', 'info');
            } else if (screenId === 'login-screen') {
                showToast('🎙️ Say "email", "password", or "login"', 'info');
            } else {
                showToast('🎙️ Say "Login", "Register", "Farmer", or "Buyer"', 'info');
            }
        } catch (err) {
            _resetVoiceBtn();
            showToast('Microphone busy. Please try again.', 'warning');
        }
    };

    recognition.onresult = function (event) {
        let command = '';
        for (let i = 0; i < event.results[0].length; i++) {
            command += ' ' + event.results[0][i].transcript;
        }
        command = command.toLowerCase().trim();

        const activeScreen = document.querySelector('.screen.active');
        const screenId = activeScreen ? activeScreen.id : '';

        if (screenId === 'login-screen') {
            if (command.includes('email')) {
                const val = command.split('email').pop().trim().replace(/\s+at\s+/gi, '@').replace(/\s+dot\s+/gi, '.').replace(/\s+/g, '');
                if (val) { document.getElementById('email-input').value = val; showToast(`✅ Email: ${val}`, 'success'); }
                return;
            }
            if (command.includes('password')) {
                const val = command.split('password').pop().trim();
                if (val) { document.getElementById('password-input').value = val; showToast('✅ Password set', 'success'); }
                return;
            }
            if (command.includes('login') || command.includes('submit')) {
                handleLogin(); return;
            }
        }

        if (command.includes('login')) { goToScreen('login-screen'); }
        else if (command.includes('register')) { window.location.href = 'registration.html'; }
        else if (command.includes('farmer')) { window.location.href = 'farmer/farmer_dashboard.html'; }
        else if (command.includes('buyer')) { window.location.href = 'buyer/buyer_dashboard.html'; }
    };

    recognition.onerror = function (event) {
        _resetVoiceBtn();
        const msgs = { 'no-speech': '🔇 No speech detected.', 'not-allowed': '🚫 Mic permission denied.', 'network': '📡 Network error.' };
        if (msgs[event.error]) showToast(msgs[event.error], 'error');
    };
    recognition.onend = function () { _resetVoiceBtn(); };
}

// ── OTP helpers ───────────────────────────────────────────────────────────────
function generateOTP() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

async function sendOTPviaSMS(mobile, otp) {
    if (!navigator.onLine) {
        showToast(`[Offline] Your OTP is: ${otp}`, 'warning');
        return { success: false };
    }
    try {
        const response = await fetch('https://www.fast2sms.com/dev/bulkV2', {
            method: 'POST',
            headers: { 'authorization': FAST2SMS_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ route: 'otp', variables_values: otp, numbers: mobile, flash: '0' })
        });
        const result = await response.json();
        return result.return === true ? { success: true } : { success: false };
    } catch (err) {
        return { success: false };
    }
}

function storeOTP(mobile, otp) {
    sessionStorage.setItem('kisansetu_pending_otp', JSON.stringify({
        otp, mobile, expiresAt: Date.now() + 5 * 60 * 1000
    }));
}

function verifyStoredOTP(enteredOTP) {
    const raw = sessionStorage.getItem('kisansetu_pending_otp');
    if (!raw) return { valid: false, reason: 'No OTP found. Please request again.' };
    const payload = JSON.parse(raw);
    if (Date.now() > payload.expiresAt) {
        sessionStorage.removeItem('kisansetu_pending_otp');
        return { valid: false, reason: 'OTP expired. Please log in again.' };
    }
    if (enteredOTP.trim() !== payload.otp) return { valid: false, reason: 'Incorrect OTP.' };
    sessionStorage.removeItem('kisansetu_pending_otp');
    return { valid: true, mobile: payload.mobile };
}

function getEnteredOTP() {
    return Array.from(document.querySelectorAll('#otp-screen .otp-box')).map(b => b.value).join('');
}

function routeByRole(role, name) {
    showToast(`Welcome back, ${name}!`, 'success');
    setTimeout(() => {
        const routes = {
            'Farmer': 'farmer/farmer_dashboard.html',
            'Buyer': 'buyer/buyer_dashboard.html',
            'Equipment Owner': 'equipmentOwner/manage_fleet.html',
            'Administrator': 'admin/admin_dashboard.html'
        };
        if (routes[role]) window.location.href = routes[role];
        else showToast('Unknown role. Contact administrator.', 'error');
    }, 1200);
}

let pendingLoginUser = null;

// ── handleLogin ───────────────────────────────────────────────────────────────
async function handleLogin() {
    const email = document.getElementById('email-input').value.trim();
    const password = document.getElementById('password-input').value;

    if (!email || !password) {
        showToast('Please enter both email and password.', 'error');
        return;
    }

    const btn = document.querySelector('#login-screen .accent-btn');
    const originalText = btn ? btn.innerHTML : '';
    if (btn) { btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Authenticating...'; btn.disabled = true; }

    try {
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password });
        if (authError) throw authError;

        const { data: userData, error: dbError } = await supabase
            .from('users').select('*').eq('id', authData.user.id).single();
        if (dbError) throw dbError;
        if (!userData) { showToast('Profile not found. Please register first.', 'error'); return; }

        pendingLoginUser = userData;

        const otp = generateOTP();
        const mobile = userData.mobile_num || userData.phone || '';
        storeOTP(mobile, otp);

        const smsResult = await sendOTPviaSMS(mobile, otp);
        if (smsResult.success) {
            showToast(`OTP sent to +91 ${mobile}`, 'success');
        } else {
            showToast(`SMS unavailable. Demo OTP: ${otp}`, 'warning');
        }

        const maskedMobile = mobile ? `+91 XXXXXX${mobile.slice(-4)}` : 'your registered number';
        const otpSubtitle = document.querySelector('#otp-screen .screen-subtitle');
        if (otpSubtitle) otpSubtitle.textContent = `OTP sent to ${maskedMobile}. Valid for 5 minutes.`;

        document.querySelectorAll('#otp-screen .otp-box').forEach(box => box.value = '');
        goToScreen('otp-screen');
        const firstBox = document.querySelector('#otp-screen .otp-box');
        if (firstBox) firstBox.focus();

    } catch (error) {
        showToast(error.message || 'Invalid email or password.', 'error');
    } finally {
        if (btn) { btn.innerHTML = originalText; btn.disabled = false; }
    }
}

// ── handleLoginOTP ────────────────────────────────────────────────────────────
async function handleLoginOTP() {
    const enteredOTP = getEnteredOTP();
    if (enteredOTP.length < 4) { showToast('Please enter the complete 4-digit OTP.', 'error'); return; }

    const result = verifyStoredOTP(enteredOTP);
    if (!result.valid) {
        showToast(result.reason, 'error');
        return;
    }

    if (!pendingLoginUser) { showToast('Session lost. Please log in again.', 'error'); goToScreen('login-screen'); return; }

    const userData = pendingLoginUser;
    pendingLoginUser = null;

    sessionStorage.setItem('kisansetu_session_active', 'true');
    sessionStorage.setItem('kisansetu_user_role', userData.role);
    sessionStorage.setItem('kisansetu_user_name', userData.full_name);
    startSessionTimer();
    routeByRole(userData.role, userData.full_name);
}

// ── selectRole ────────────────────────────────────────────────────────────────
function selectRole(roleName) {
    const routes = {
        'Farmer': 'farmer/farmer_dashboard.html',
        'Buyer': 'buyer/buyer_dashboard.html',
        'Administrator': 'admin/admin_dashboard.html',
        'Equipment Owner': 'equipmentOwner/manage_fleet.html'
    };
    if (routes[roleName]) window.location.href = routes[roleName];
}

function moveToNext(current) {
    if (current.value.length >= current.maxLength) {
        const next = current.nextElementSibling;
        if (next && next.tagName === 'INPUT') next.focus();
    }
    if (current.value.length === 0) {
        const prev = current.previousElementSibling;
        if (prev && prev.tagName === 'INPUT') prev.focus();
    }
}

async function handleLogout() {
    clearTimeout(sessionTimer);
    sessionStorage.clear();
    try { await supabase.auth.signOut(); } catch (e) { }
    showToast('Logged out successfully.', 'success');
    setTimeout(() => goToScreen('login-screen'), 1000);
}

// ── CRITICAL: Register real functions on window + signal ready ────────────────
// These overwrite the stubs defined in index.html's inline <script>
window.handleLogin = handleLogin;
window.handleLoginOTP = handleLoginOTP;
window.selectRole = selectRole;
window.moveToNext = moveToNext;
window.handleLogout = handleLogout;
window.goToScreen = goToScreen;

// Register under _app_ aliases for the queue-based stub system
window._app_handleLogin = handleLogin;
window._app_handleLoginOTP = handleLoginOTP;
window._app_selectRole = selectRole;

// Signal to index.html's stub system that the module is ready
// and flush any queued calls that fired before we loaded
if (typeof window._markAppReady === 'function') {
    window._markAppReady();
}

console.log('[KisanSetu] app.js loaded ✓ — all functions registered on window.');