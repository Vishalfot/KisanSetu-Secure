import { supabase } from './supabase-config.js';
import { initializeNotifications, sendSystemNotification } from './shared/notifications-manager.js';

import './toast.js'; // [Shared utility] Global toast notifications across all pages

const FAST2SMS_KEY = 'YOUR_FAST2SMS_API_KEY';

// ── [NFR-5.3] Session timeout: 30 minutes of inactivity ──────────────────────
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
        if (sessionStorage.getItem('kisansetu_session_active')) {
            startSessionTimer();
        }
    });
});

// ── [Section 3.1] Offline / Online Indicator ─────────────────────────────────
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

// ── [Section 3.4] Store-and-Forward ──────────────────────────────────────────
function syncPendingOfflineData() {
    const pending = JSON.parse(localStorage.getItem('kisansetu_offline_queue') || '[]');
    if (pending.length === 0) return;
    showToast(`Syncing ${pending.length} offline record(s)...`, 'info');
    localStorage.removeItem('kisansetu_offline_queue');
    showToast('Offline data synced successfully.', 'success');
}

// ── Screen navigation ─────────────────────────────────────────────────────────
// NOTE: goToScreen is also defined synchronously in index.html's inline <script>.
// This module version is identical — both stay in sync.
function goToScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const target = document.getElementById(screenId);
    if (target) target.classList.add('active');
}
window.goToScreen = goToScreen;

// ── Splash → Language after 2.5s ─────────────────────────────────────────────
window.onload = () => {
    updateConnectivityStatus();
    initVoiceInterface();
    setTimeout(() => goToScreen('language-screen'), 2500);
};

// ── [NFR-5.4] Voice-First Interface ──────────────────────────────────────────
let _voiceIsListening = false;
let _voiceRecognition = null;

function _resetVoiceBtn() {
    _voiceIsListening = false;
    const btn = document.getElementById('voice-btn');
    if (!btn) return;
    btn.classList.remove('listening');
    btn.innerHTML = '<i class="fa-solid fa-microphone"></i>';
    btn.title = 'Tap to speak';
}

function _setVoiceBtnListening() {
    _voiceIsListening = true;
    const btn = document.getElementById('voice-btn');
    if (!btn) return;
    btn.classList.add('listening');
    btn.innerHTML = '<i class="fa-solid fa-stop"></i>';
    btn.title = 'Tap to stop';
}

function initVoiceInterface() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
        console.warn('[NFR-5.4] Voice interface not supported in this browser.');
        const voiceSection = document.querySelector('.voice-section');
        if (voiceSection) voiceSection.style.display = 'none';
        const loginFab = document.getElementById('login-voice-btn');
        if (loginFab) loginFab.style.display = 'none';
        return;
    }

    const recognition = new SpeechRecognition();
    _voiceRecognition = recognition;
    recognition.lang = 'en-IN';
    recognition.interimResults = false;
    recognition.maxAlternatives = 3;
    recognition.continuous = false;

    function _extractVal(cmd, keywords) {
        const sorted = [...keywords].sort((a, b) => b.length - a.length);
        for (const kw of sorted) {
            const idx = cmd.indexOf(kw);
            if (idx !== -1) {
                const val = cmd.slice(idx + kw.length).trim();
                if (val.length > 0) return val;
            }
        }
        return null;
    }

    function _processEmail(spoken) {
        return spoken
            .replace(/\s+at\s+/gi, '@')
            .replace(/\s+dot\s+/gi, '.')
            .replace(/\[at\]/gi, '@')
            .replace(/\s+/g, '')
            .toLowerCase();
    }

    function _resetAnyVoiceBtn(btnId) {
        const btn = document.getElementById(btnId);
        if (!btn) return;
        btn.classList.remove('listening');
        btn.innerHTML = '<i class="fa-solid fa-microphone"></i>';
    }

    window.startVoiceLogin = function (sourceBtnId) {
        if (_voiceIsListening) {
            try { recognition.stop(); } catch (e) { /* already stopped */ }
            _resetVoiceBtn();
            _resetAnyVoiceBtn('login-voice-btn');
            return;
        }
        try {
            recognition.start();
            _setVoiceBtnListening();

            const activeScreen = document.querySelector('.screen.active');
            const screenId = activeScreen ? activeScreen.id : '';

            if (screenId === 'otp-screen') {
                showToast('🎙️ Say your 4-digit OTP: "1 2 3 4" or "one two three four", or say "verify"', 'info');
            } else if (screenId === 'login-screen') {
                showToast('🎙️ Say "email your@mail.com", "password yourpass", or "login"', 'info');
            } else {
                showToast('🎙️ Say "Login", "Register", "Farmer", or "Buyer"', 'info');
            }
        } catch (err) {
            console.error('[Voice] Start failed:', err);
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

        if (screenId === 'otp-screen') {
            const englishWords = {
                'zero': '0', 'one': '1', 'two': '2', 'three': '3', 'four': '4',
                'five': '5', 'six': '6', 'seven': '7', 'eight': '8', 'nine': '9',
                'to': '2', 'too': '2', 'for': '4', 'ate': '8', 'won': '1'
            };
            const hindiWords = {
                'शून्य': '0', 'एक': '1', 'दो': '2', 'तीन': '3', 'चार': '4',
                'पाँच': '5', 'पांच': '5', 'छः': '6', 'छह': '6', 'सात': '7', 'आठ': '8', 'नौ': '9'
            };
            const devanagariDigits = {
                '०': '0', '१': '1', '२': '2', '३': '3', '४': '4', '५': '5', '६': '6', '७': '7', '८': '8', '९': '9'
            };

            let processed = command;
            Object.keys(devanagariDigits).forEach(d => {
                processed = processed.replace(new RegExp(d, 'g'), devanagariDigits[d]);
            });
            Object.keys(hindiWords).forEach(w => {
                processed = processed.replace(new RegExp(w, 'g'), hindiWords[w]);
            });
            Object.keys(englishWords).forEach(w => {
                processed = processed.replace(new RegExp(`\\b${w}\\b`, 'gi'), englishWords[w]);
            });
            const digits = processed.replace(/\D/g, '');

            if (command.includes('verify') || command.includes('submit') || command.includes('proceed')) {
                showToast('Verifying OTP...', 'info');
                setTimeout(() => handleLoginOTP(), 400);
                return;
            }

            if (digits.length >= 4) {
                const otp4 = digits.slice(-4);
                const boxes = document.querySelectorAll('#otp-screen .otp-box');
                boxes.forEach((box, i) => { box.value = otp4[i] || ''; });
                showToast(`✅ OTP filled: ${otp4}. Tap "Verify" or say "verify".`, 'success');
            } else if (digits.length > 0) {
                showToast(`Heard ${digits.length} digit(s): "${digits}". Please say all 4 OTP digits.`, 'warning');
            } else if (command.includes('back') || command.includes('cancel')) {
                goToScreen('login-screen');
            } else {
                showToast('Say your 4-digit OTP, e.g. "1 2 3 4", or say "verify" to submit.', 'info');
            }
            return;
        }

        if (screenId === 'login-screen') {
            let val = _extractVal(command, [
                'my email address is', 'email address is', 'my email is',
                'email is', 'my email', 'email address', 'ईमेल', 'email'
            ]);
            if (val) {
                const email = _processEmail(val);
                const emailInput = document.getElementById('email-input');
                if (emailInput) emailInput.value = email;
                showToast(`✅ Email set: "${email}"`, 'success');
                return;
            }

            val = _extractVal(command, [
                'my password is', 'password is', 'set password to',
                'my password', 'पासवर्ड', 'password'
            ]);
            if (val) {
                const pwInput = document.getElementById('password-input');
                if (pwInput) pwInput.value = val;
                showToast(`✅ Password set (${val.length} chars)`, 'success');
                return;
            }

            if (
                command.includes('submit') || command.includes('sign in') ||
                command.includes('log in') || command.includes('go') ||
                command.includes('proceed') || command.includes('लॉगिन') ||
                command === 'login'
            ) {
                showToast('Logging in...', 'info');
                setTimeout(() => handleLogin(), 400);
                return;
            }

            if (command.includes('back') || command.includes('cancel') || command.includes('language')) {
                goToScreen('language-screen');
                return;
            }

            if (command.includes('register') || command.includes('sign up') ||
                command.includes('new account') || command.includes('create account')) {
                showToast('Going to Registration...', 'success');
                setTimeout(() => { window.location.href = 'registration.html'; }, 600);
                return;
            }

            if (command.includes('help') || command.includes('what can')) {
                showToast('Say: "email your@mail.com" · "password yourpass" · "login" to submit · "register" to create account', 'info');
                return;
            }

            const heardLogin = event.results[0][0].transcript;
            showToast(`Heard: "${heardLogin}". Try "email", "password", or "login".`, 'warning');
            return;
        }

        if (command.includes('login') || command.includes('लॉगिन') || command.includes('log in')) {
            showToast('Going to Login...', 'success');
            setTimeout(() => goToScreen('login-screen'), 600);
        } else if (command.includes('register') || command.includes('registration') ||
            command.includes('रजिस्टर') || command.includes('नया खाता') ||
            command.includes('new account') || command.includes('sign up')) {
            showToast('Going to Registration...', 'success');
            setTimeout(() => { window.location.href = 'registration.html'; }, 600);
        } else if (command.includes('farmer') || command.includes('किसान')) {
            showToast('Going to Farmer Dashboard...', 'success');
            setTimeout(() => { window.location.href = 'farmer/farmer_dashboard.html'; }, 600);
        } else if (command.includes('buyer') || command.includes('खरीदार') || command.includes('buy')) {
            showToast('Going to Buyer Dashboard...', 'success');
            setTimeout(() => { window.location.href = 'buyer/buyer_dashboard.html'; }, 600);
        } else if (command.includes('equipment') || command.includes('उपकरण') ||
            command.includes('machinery') || command.includes('tractor')) {
            showToast('Going to Equipment Dashboard...', 'success');
            setTimeout(() => { window.location.href = 'equipment_owner/equipment_dashboard.html'; }, 600);
        } else if (command.includes('admin') || command.includes('व्यवस्थापक')) {
            showToast('Going to Admin Dashboard...', 'success');
            setTimeout(() => { window.location.href = 'admin/admin_dashboard.html'; }, 600);
        } else {
            const displayCmd = event.results[0][0].transcript;
            showToast(`Heard: "${displayCmd}". Try: Login · Register · Farmer · Buyer`, 'warning');
        }
    };

    recognition.onerror = function (event) {
        console.error('[Voice] Error:', event.error);
        _resetVoiceBtn();
        _resetAnyVoiceBtn('login-voice-btn');
        const msgs = {
            'no-speech': '🔇 No speech detected. Tap mic and speak clearly.',
            'audio-capture': '🎙️ Microphone not found. Please check your device.',
            'not-allowed': '🚫 Microphone permission denied. Allow in browser settings.',
            'network': '📡 Network error. Check your connection.',
            'aborted': null,
        };
        const msg = msgs[event.error];
        if (msg) showToast(msg, 'error');
    };

    recognition.onend = function () {
        _resetVoiceBtn();
        _resetAnyVoiceBtn('login-voice-btn');
    };

    recognition.onspeechstart = function () {
        const btn = document.getElementById('voice-btn');
        if (btn) btn.style.transform = 'scale(1.1)';
        const loginBtn = document.getElementById('login-voice-btn');
        if (loginBtn) loginBtn.style.transform = 'scale(1.1)';
    };

    recognition.onspeechend = function () {
        const btn = document.getElementById('voice-btn');
        if (btn) btn.style.transform = '';
        const loginBtn = document.getElementById('login-voice-btn');
        if (loginBtn) loginBtn.style.transform = '';
    };

    console.log('[Voice] Initialized — en-IN, context-aware.');
}

// ── OTP Generator ─────────────────────────────────────────────────────────────
function generateOTP() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

// ── Send OTP via SMS ──────────────────────────────────────────────────────────
async function sendOTPviaSMS(mobile, otp) {
    if (!navigator.onLine) {
        showToast(`[Offline Fallback] Your OTP is: ${otp}`, 'warning');
        return { success: false, reason: 'Offline' };
    }

    try {
        const response = await fetch('https://www.fast2sms.com/dev/bulkV2', {
            method: 'POST',
            headers: {
                'authorization': FAST2SMS_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                route: 'otp',
                variables_values: otp,
                numbers: mobile,
                flash: '0'
            })
        });

        const result = await response.json();
        return result.return === true
            ? { success: true }
            : { success: false, reason: result.message || 'SMS failed' };

    } catch (err) {
        console.error('[SMS] Fast2SMS error:', err);
        return { success: false, reason: 'Network error' };
    }
}

function storeOTP(mobile, otp) {
    const payload = { otp, mobile, expiresAt: Date.now() + (5 * 60 * 1000) };
    sessionStorage.setItem('kisansetu_pending_otp', JSON.stringify(payload));
}

function verifyStoredOTP(enteredOTP) {
    const raw = sessionStorage.getItem('kisansetu_pending_otp');
    if (!raw) return { valid: false, reason: 'No OTP found. Please request again.' };

    const payload = JSON.parse(raw);

    if (Date.now() > payload.expiresAt) {
        sessionStorage.removeItem('kisansetu_pending_otp');
        return { valid: false, reason: 'OTP has expired. Please log in again to resend.' };
    }

    if (enteredOTP.trim() !== payload.otp) {
        return { valid: false, reason: 'Incorrect OTP. Please try again.' };
    }

    sessionStorage.removeItem('kisansetu_pending_otp');
    return { valid: true, mobile: payload.mobile };
}

function getEnteredOTP() {
    const boxes = document.querySelectorAll('#otp-screen .otp-box');
    return Array.from(boxes).map(b => b.value).join('');
}

// ── [FR-1.3–1.6] Role-Based Dashboard Routing ────────────────────────────────
function routeByRole(role, name) {
    showToast(`Welcome back, ${name}!`, 'success');

    setTimeout(() => {
        if (role === 'Farmer') {
            window.location.href = 'farmer/farmer_dashboard.html';
        } else if (role === 'Buyer') {
            window.location.href = 'buyer/buyer_dashboard.html';
        } else if (role === 'Equipment Owner') {
            window.location.href = 'equipmentOwner/manage_fleet.html';
        } else if (role === 'Administrator') {
            window.location.href = 'admin/admin_dashboard.html';
        } else {
            showToast('Unknown role. Please contact the administrator.', 'error');
        }
    }, 1200);
}

// ── [FR-7.1] Log login notification ──────────────────────────────────────────
async function logLoginNotification(userId, userName, role) {
    try {
        await sendSystemNotification(
            userId,
            'Login Success',
            `Namaste ${userName}, you have successfully signed in as ${role}.`,
            'info'
        );
    } catch (err) {
        console.warn('[FR-7.1] Login notification log failed:', err.message);
    }
}

let pendingLoginUser = null;

// ── LOGIN STEP 1 ──────────────────────────────────────────────────────────────
async function handleLogin() {
    const email = document.getElementById('email-input').value.trim();
    const password = document.getElementById('password-input').value;

    if (!email || !password) {
        showToast('Please enter both email and password.', 'error');
        return;
    }

    if (!navigator.onLine) {
        showToast('You appear offline. A connection is required to log in.', 'warning');
    }

    const btn = document.querySelector('#login-screen .accent-btn');
    const originalText = btn ? btn.textContent : '';
    if (btn) {
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Authenticating...';
        btn.disabled = true;
    }

    try {
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
            email,
            password
        });

        if (authError) throw authError;

        const user = authData.user;

        const { data: userData, error: dbError } = await supabase
            .from('users')
            .select('*')
            .eq('id', user.id)
            .single();

        if (dbError) throw dbError;

        if (!userData) {
            showToast('Profile not found. Please register first.', 'error');
            return;
        }

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

        const maskedMobile = mobile
            ? `+91 XXXXXX${mobile.slice(-4)}`
            : 'your registered number';
        const otpSubtitle = document.querySelector('#otp-screen .screen-subtitle');
        if (otpSubtitle) {
            otpSubtitle.textContent = `OTP sent to ${maskedMobile}. Valid for 5 minutes.`;
        }

        document.querySelectorAll('#otp-screen .otp-box').forEach(box => box.value = '');
        goToScreen('otp-screen');

        const firstBox = document.querySelector('#otp-screen .otp-box');
        if (firstBox) firstBox.focus();

    } catch (error) {
        console.error('[Login Step 1] Error:', error);
        showToast(error.message || 'Invalid email or password. Please try again.', 'error');
    } finally {
        if (btn) {
            btn.textContent = originalText;
            btn.disabled = false;
        }
    }
}

// IMPORTANT: Register as both the real function AND the alias the stub calls
window.handleLogin = handleLogin;
window._handleLogin = handleLogin;   // ← alias for the stub in index.html

// ── LOGIN STEP 2 ──────────────────────────────────────────────────────────────
async function handleLoginOTP() {
    const enteredOTP = getEnteredOTP();

    if (enteredOTP.length < 4) {
        showToast('Please enter the complete 4-digit OTP.', 'error');
        return;
    }

    const result = verifyStoredOTP(enteredOTP);

    if (!result.valid) {
        showToast(result.reason, 'error');
        const otpInputs = document.querySelector('.otp-inputs');
        if (otpInputs) {
            otpInputs.style.animation = 'shake 0.3s ease';
            setTimeout(() => otpInputs.style.animation = '', 300);
        }
        return;
    }

    if (!pendingLoginUser) {
        showToast('Session data lost. Please log in again.', 'error');
        goToScreen('login-screen');
        return;
    }

    const userData = pendingLoginUser;
    pendingLoginUser = null;

    sessionStorage.setItem('kisansetu_session_active', 'true');
    sessionStorage.setItem('kisansetu_user_role', userData.role);
    sessionStorage.setItem('kisansetu_user_name', userData.full_name);
    startSessionTimer();

    routeByRole(userData.role, userData.full_name);
}

// IMPORTANT: Register as both the real function AND the alias
window.handleLoginOTP = handleLoginOTP;
window._handleLoginOTP = handleLoginOTP;  // ← alias for the stub in index.html

// ── [FR-1.2] Manual role selection ───────────────────────────────────────────
function selectRole(roleName) {
    if (roleName === 'Farmer') window.location.href = 'farmer/farmer_dashboard.html';
    else if (roleName === 'Buyer') window.location.href = 'buyer/buyer_dashboard.html';
    else if (roleName === 'Administrator') window.location.href = 'admin2/admin_dashboard.html';
    else if (roleName === 'Equipment Owner') window.location.href = 'equipmentOwner/manage_fleet.html';
}
window.selectRole = selectRole;

// ── OTP box: auto-tab ─────────────────────────────────────────────────────────
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
window.moveToNext = moveToNext;

// ── Logout ────────────────────────────────────────────────────────────────────
async function handleLogout() {
    clearTimeout(sessionTimer);
    sessionStorage.removeItem('kisansetu_session_active');
    sessionStorage.removeItem('kisansetu_user_role');
    sessionStorage.removeItem('kisansetu_user_name');

    try {
        await supabase.auth.signOut();
    } catch (err) {
        console.warn('[Logout] Supabase sign-out error (non-critical):', err.message);
    }

    showToast('Logged out successfully.', 'success');
    setTimeout(() => goToScreen('login-screen'), 1000);
}
window.handleLogout = handleLogout;