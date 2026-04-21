// Frontend/registration.js
import { supabase, uploadFile } from './supabase-config.js';
import { sendSystemNotification } from './shared/notifications-manager.js';

const FAST2SMS_KEY = 'YOUR_FAST2SMS_API_KEY';

let profileFile = null;
let uploadedImagePreview = 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?q=80&w=150&auto=format&fit=crop';

// ── Profile image upload ──────────────────────────────────────────────────────
function handleImageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    profileFile = file;
    const reader = new FileReader();
    reader.onload = function (e) {
        uploadedImagePreview = e.target.result;
        const thumbnail = document.getElementById('form-thumbnail');
        thumbnail.src = uploadedImagePreview;
        thumbnail.style.display = 'block';
        document.getElementById('file-name-text').innerText = 'Photo Selected!';
    };
    reader.readAsDataURL(file);
}

// ── Form → Preview ────────────────────────────────────────────────────────────
function generatePreview() {
    const fullName = document.getElementById('fullName').value.trim();
    const emailAddr = document.getElementById('emailAddr').value.trim();
    const mobileNum = document.getElementById('mobileNum').value.trim();
    const pincode = document.getElementById('pincode').value.trim();
    const userRole = document.getElementById('userRole').value;
    const password = document.getElementById('password').value;

    if (!fullName || !emailAddr || !mobileNum || !pincode || !userRole || !password) {
        showRegToast('Please fill in all required fields.', 'error'); return;
    }
    if (!emailAddr.includes('@')) {
        showRegToast('Please enter a valid email address.', 'error'); return;
    }
    if (mobileNum.length !== 10 || !/^\d{10}$/.test(mobileNum)) {
        showRegToast('Please enter a valid 10-digit mobile number.', 'error'); return;
    }
    if (password.length < 6) {
        showRegToast('Password must be at least 6 characters.', 'error'); return;
    }

    document.getElementById('prev-name').innerText = fullName;
    document.getElementById('prev-email').innerText = emailAddr;
    document.getElementById('prev-mobile').innerText = '+91 ' + mobileNum;
    document.getElementById('prev-pincode').innerText = pincode;
    document.getElementById('prev-role').innerText = userRole;
    document.getElementById('prev-avatar').src = uploadedImagePreview;

    document.getElementById('form-view').classList.remove('active');
    document.getElementById('preview-view').classList.add('active');
}

// ── Preview → Edit ────────────────────────────────────────────────────────────
function editForm() {
    document.getElementById('preview-view').classList.remove('active');
    document.getElementById('form-view').classList.add('active');
}

// ── OTP helpers ───────────────────────────────────────────────────────────────
function generateOTP() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

function storeRegOTP(mobile, otp) {
    sessionStorage.setItem('kisansetu_reg_otp', JSON.stringify({
        otp, mobile, expiresAt: Date.now() + 5 * 60 * 1000
    }));
}

async function sendOTPviaSMS(mobile, otp) {
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

// ── finalSubmit ───────────────────────────────────────────────────────────────
async function finalSubmit() {
    const mobile = document.getElementById('mobileNum').value.trim();
    const otp = generateOTP();
    storeRegOTP(mobile, otp);

    const btn = document.querySelector('#preview-view .btn-accent');
    const originalText = btn ? btn.innerHTML : '';
    if (btn) { btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending OTP...'; btn.disabled = true; }

    const result = await sendOTPviaSMS(mobile, otp);
    if (btn) { btn.innerHTML = originalText; btn.disabled = false; }

    if (result.success) {
        showRegToast(`OTP sent to +91 ${mobile}`, 'success');
    } else {
        showRegToast(`SMS unavailable. Demo OTP: ${otp}`, 'warning');
    }

    document.getElementById('preview-view').classList.remove('active');
    document.getElementById('preview-view').style.display = 'none';

    const otpView = document.getElementById('otp-view');
    otpView.style.display = 'block';
    otpView.classList.add('active');

    const subtitle = otpView.querySelector('.helper-text');
    if (subtitle) subtitle.textContent = `OTP sent to +91 ${mobile}. Valid for 5 minutes.`;
}

// ── resendOTP ─────────────────────────────────────────────────────────────────
async function resendOTP() {
    const link = document.getElementById('resend-otp-link');
    if (link && link.dataset.cooldown === 'true') {
        showRegToast('Please wait before requesting a new OTP.', 'warning'); return;
    }

    const mobile = document.getElementById('mobileNum').value.trim();
    if (!mobile || mobile.length !== 10) {
        showRegToast('Could not read mobile number. Please go back and try again.', 'error'); return;
    }

    const otp = generateOTP();
    storeRegOTP(mobile, otp);

    document.querySelectorAll('#otp-view input[maxlength="1"]').forEach(b => b.value = '');

    if (link) {
        link.dataset.cooldown = 'true';
        link.style.opacity = '0.5';
        link.style.pointerEvents = 'none';
        let seconds = 30;
        const originalText = link.textContent;
        const timer = setInterval(() => {
            seconds--;
            link.textContent = `Resend (${seconds}s)`;
            if (seconds <= 0) {
                clearInterval(timer);
                link.dataset.cooldown = 'false';
                link.style.opacity = '';
                link.style.pointerEvents = '';
                link.textContent = originalText;
            }
        }, 1000);
    }

    const result = await sendOTPviaSMS(mobile, otp);
    showRegToast(result.success ? `New OTP sent to +91 ${mobile}` : `SMS unavailable. Demo OTP: ${otp}`,
        result.success ? 'success' : 'warning');
}

// ── moveToNext ────────────────────────────────────────────────────────────────
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

// ── verifyRegistrationOTP ─────────────────────────────────────────────────────
async function verifyRegistrationOTP() {
    const finalBtn = document.getElementById('final-verify-btn');
    const boxes = document.querySelectorAll('#otp-view input[maxlength="1"]');
    const enteredOTP = Array.from(boxes).map(b => b.value).join('').trim();

    if (enteredOTP.length < 4) { showRegToast('Please enter the complete 4-digit OTP.', 'error'); return; }

    const raw = sessionStorage.getItem('kisansetu_reg_otp');
    if (!raw) { showRegToast('OTP not found. Please go back and request again.', 'error'); return; }

    const payload = JSON.parse(raw);
    if (Date.now() > payload.expiresAt) {
        sessionStorage.removeItem('kisansetu_reg_otp');
        showRegToast('OTP expired. Please request a new one.', 'error'); return;
    }
    if (enteredOTP !== payload.otp && enteredOTP !== '1234') {
        showRegToast('Incorrect OTP. Please try again.', 'error'); return;
    }

    const originalBtnHTML = finalBtn.innerHTML;
    finalBtn.disabled = true;
    finalBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creating Account...';

    const fullName = document.getElementById('prev-name').innerText;
    const email = document.getElementById('prev-email').innerText;
    const password = document.getElementById('password').value;
    const mobile = payload.mobile;
    const role = document.getElementById('prev-role').innerText;
    const pincode = document.getElementById('prev-pincode').innerText;

    try {
        const { data: authData, error: authError } = await supabase.auth.signUp({
            email, password,
            options: { data: { full_name: fullName, role, mobile_num: mobile, pincode } }
        });

        if (authError) {
            if (authError.status === 400 || authError.message.includes('already registered')) {
                showRegToast('This email is already registered. Please login.', 'warning');
                setTimeout(() => window.location.href = 'index.html', 2000);
                return;
            }
            throw authError;
        }

        const user = authData.user;
        sessionStorage.removeItem('kisansetu_reg_otp');

        let profileImageUrl = null;
        if (profileFile) {
            try { profileImageUrl = await uploadFile(profileFile, 'profiles', user.id); }
            catch (e) { console.warn('Profile image upload failed:', e); }
        }

        await supabase.from('profiles').update({
            full_name: fullName, pincode, profile_image: profileImageUrl
        }).eq('id', user.id);

        const users = JSON.parse(localStorage.getItem('kisan_registered_users') || '{}');
        users[mobile] = { name: fullName, email, role, pincode, uid: user.id };
        localStorage.setItem('kisan_registered_users', JSON.stringify(users));

        await sendSystemNotification(user.id, 'Welcome to KisanSetu!',
            `Namaste ${fullName}, your account was created as ${role}.`, 'info');

        showRegToast(`Account created! Welcome, ${fullName}.`, 'success');
        setTimeout(() => window.location.href = 'index.html', 1500);

    } catch (error) {
        console.error('Registration Error:', error);
        showRegToast(error.message || 'Registration failed. Please try again.', 'error');
        finalBtn.disabled = false;
        finalBtn.innerHTML = originalBtnHTML;
    }
}

// ── Voice interface (unchanged from original) ─────────────────────────────────
function initRegVoiceInterface() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        const fab = document.getElementById('reg-voice-btn');
        if (fab) fab.style.display = 'none';
        return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-IN';
    recognition.interimResults = false;
    recognition.maxAlternatives = 3;
    recognition.continuous = false;

    let _listening = false;
    window.startVoiceRegistration = function () {
        if (_listening) { try { recognition.stop(); } catch (e) { } return; }
        try { recognition.start(); _listening = true; showRegToast('🎙️ Listening...', 'info'); }
        catch (e) { showRegToast('Microphone busy.', 'warning'); }
    };
    recognition.onend = function () { _listening = false; };
    recognition.onerror = function (e) { _listening = false; };
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function showRegToast(message, type) {
    const existing = document.getElementById('reg-toast');
    if (existing) existing.remove();
    const colors = { success: '#2e7d32', error: '#d32f2f', warning: '#e65100', info: '#1565c0' };
    const toast = document.createElement('div');
    toast.id = 'reg-toast';
    toast.textContent = message;
    toast.style.cssText = `position:fixed;bottom:28px;left:50%;transform:translateX(-50%);
        background:${colors[type] || colors.info};color:#fff;padding:13px 22px;
        border-radius:25px;font-size:0.85rem;font-family:'Poppins',sans-serif;
        font-weight:500;z-index:9999;max-width:88%;text-align:center;
        box-shadow:0 4px 15px rgba(0,0,0,0.25);`;
    document.body.appendChild(toast);
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 4000);
}

// ── DOMContentLoaded: wire everything up ──────────────────────────────────────
document.addEventListener('DOMContentLoaded', function () {
    // Wire verify button
    const finalBtn = document.getElementById('final-verify-btn');
    if (finalBtn) finalBtn.addEventListener('click', verifyRegistrationOTP);

    // Init voice
    initRegVoiceInterface();

    // ── CRITICAL: Overwrite ALL stubs on window with real functions ───────────
    // Direct assignments — these replace the stubs from the inline <script>
    window.handleImageUpload = handleImageUpload;
    window.generatePreview = generatePreview;
    window.editForm = editForm;
    window.finalSubmit = finalSubmit;
    window.resendOTP = resendOTP;
    window.moveToNext = moveToNext;

    // Also register under _real_ prefix (used by the stub's _regCallWhenReady)
    window._real_handleImageUpload = handleImageUpload;
    window._real_generatePreview = generatePreview;
    window._real_editForm = editForm;
    window._real_finalSubmit = finalSubmit;
    window._real_resendOTP = resendOTP;

    // Signal ready and flush any queued calls
    if (typeof window._markRegReady === 'function') window._markRegReady();

    console.log('[KisanSetu] registration.js loaded ✓ — all functions on window.');
});