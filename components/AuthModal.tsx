import React, { useState, useEffect, useRef, useCallback } from 'react';
import { storeService } from '../services/storeService';
import { UserProfile } from '../types';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

// Load Google GSI SDK once
let gsiLoaded = false;
function loadGSI(): Promise<void> {
    return new Promise((resolve) => {
        if (gsiLoaded || (window as any).google?.accounts) { gsiLoaded = true; resolve(); return; }
        const s = document.createElement('script');
        s.src = 'https://accounts.google.com/gsi/client';
        s.async = true; s.defer = true;
        s.onload = () => { gsiLoaded = true; resolve(); };
        document.head.appendChild(s);
    });
}

interface AuthModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: (user: UserProfile) => void;
    onNavigate: (step: any) => void;
    initialMode?: 'login' | 'signup';
    resetToken?: string | null; // Set when landing on /reset-password?token=...
}

const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, onSuccess, onNavigate, initialMode, resetToken }) => {
    const [mode, setMode] = useState<'login' | 'signup' | 'forgot' | 'reset'>(resetToken ? 'reset' : initialMode ?? 'login');
    useEffect(() => {
        if (isOpen && initialMode && !resetToken) setMode(initialMode);
    }, [isOpen, initialMode]);
    const [identifier, setIdentifier] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [email, setEmail] = useState('');
    const [username, setUsername] = useState('');
    const [inviteCode, setInviteCode] = useState('');
    const [xUsername, setXUsername] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const googleBtnRef = useRef<HTMLDivElement>(null);

    // Mount Google Sign-In button whenever modal is open on login or signup
    useEffect(() => {
        if (!isOpen || (mode !== 'login' && mode !== 'signup')) return;
        let cancelled = false;
        loadGSI().then(() => {
            if (cancelled || !googleBtnRef.current) return;
            (window as any).google.accounts.id.initialize({
                client_id: GOOGLE_CLIENT_ID,
                callback: handleGoogleCredential,
                ux_mode: 'popup',
            });
            (window as any).google.accounts.id.renderButton(googleBtnRef.current, {
                type: 'standard', theme: 'outline', size: 'large',
                text: mode === 'signup' ? 'signup_with' : 'signin_with',
                width: googleBtnRef.current.offsetWidth || 320,
                logo_alignment: 'left',
            });
        });
        return () => { cancelled = true; };
    }, [isOpen, mode]);

    const handleGoogleCredential = useCallback(async (response: any) => {
        setLoading(true); setError('');
        try {
            const appTok = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('rg_membership_application_token') || '' : '';
            const res = await fetch('/api/auth.php?action=google_auth', {
                method: 'POST', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ credential: response.credential, application_token: appTok }),
            });
            const data = await res.json();
            if (!res.ok || data.error) throw new Error(data.error || 'Google sign-in failed');
            onSuccess(data.data); onClose();
        } catch (e: any) {
            setError(e.message);
        } finally { setLoading(false); }
    }, [onSuccess, onClose]);

    const switchMode = (m: typeof mode) => {
        setMode(m); setError(''); setSuccess('');
        setPassword(''); setConfirmPassword('');
    };

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true); setError('');
        try {
            let user;
            if (mode === 'signup') {
                const appTok = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('rg_membership_application_token') || '' : '';
                user = await storeService.signUp(username, email, password, inviteCode, xUsername, appTok);
            } else {
                user = await storeService.login(identifier, password);
            }
            onSuccess(user); onClose();
        } catch (err: any) {
            setError(err.message || 'Authentication failed');
        } finally { setLoading(false); }
    };

    const handleForgotPassword = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!email) { setError('Please enter your email'); return; }
        setLoading(true); setError(''); setSuccess('');
        try {
            const res = await fetch('/api/auth.php?action=request_password_reset', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email }),
            });
            const data = await res.json();
            if (!res.ok || data.error) throw new Error(data.error || 'Request failed');
            setSuccess(data.message || 'Reset link sent! Check your email.');
        } catch (e: any) { setError(e.message); }
        finally { setLoading(false); }
    };

    const handleResetConfirm = async (e: React.FormEvent) => {
        e.preventDefault();
        if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
        if (password !== confirmPassword) { setError('Passwords do not match'); return; }
        if (!resetToken) { setError('Invalid reset link'); return; }
        setLoading(true); setError(''); setSuccess('');
        try {
            const res = await fetch('/api/auth.php?action=confirm_password_reset', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: resetToken, password }),
            });
            const data = await res.json();
            if (!res.ok || data.error) throw new Error(data.error || 'Reset failed');
            setSuccess('Password updated! Redirecting to login…');
            setTimeout(() => switchMode('login'), 2000);
        } catch (e: any) { setError(e.message); }
        finally { setLoading(false); }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}></div>

            <div className="relative bg-[#050505] w-full max-w-md rounded-2xl shadow-[0_0_30px_rgba(212,175,55,0.15)] p-8 border border-[#D4AF37]/30 animate-fade-in overflow-y-auto max-h-[95vh]">
                <div className="text-center mb-8">
                    <div className="w-20 h-20 mx-auto mb-4 relative group">
                        <img
                            src="/assets/logo/RawGraded Square.svg"
                            alt="RawGraded Logo"
                            className="w-full h-full object-contain drop-shadow-[0_0_15px_rgba(212,175,55,0.3)] group-hover:scale-110 transition-transform duration-300"
                        />
                        <div className="absolute -inset-2 bg-[#D4AF37]/10 blur-xl rounded-full opacity-40"></div>
                    </div>
                    <h2 className="text-2xl font-serif font-bold text-white mb-2 tracking-wide">
                        {mode === 'login' && 'Welcome Back'}
                        {mode === 'signup' && 'Join RawGraded'}
                        {mode === 'forgot' && 'Reset Password'}
                        {mode === 'reset' && 'Set New Password'}
                    </h2>
                    <p className="text-white/50 text-sm font-light">
                        {mode === 'login' && 'Sign in to access your portfolio'}
                        {mode === 'signup' && 'Create your account and start grading cards'}
                        {mode === 'forgot' && 'Enter your email to receive a reset link'}
                        {mode === 'reset' && 'Enter and confirm your new password'}
                    </p>
                </div>

                {error && (
                    <div className="bg-red-900/20 text-red-400 border border-red-500/30 text-[11px] uppercase font-bold tracking-widest p-3 rounded-lg mb-4 text-center">
                        {error}
                    </div>
                )}
                {success && (
                    <div className="bg-green-900/20 text-green-400 border border-green-500/30 text-[11px] uppercase font-bold tracking-widest p-3 rounded-lg mb-4 text-center">
                        {success}
                    </div>
                )}

                {/* ── LOGIN / SIGNUP FORM ── */}
                {(mode === 'login' || mode === 'signup') && (
                    <form onSubmit={handleSubmit} className="space-y-4">
                        {mode === 'signup' && (
                            <div>
                                <label className="block text-[#D4AF37] text-[10px] uppercase font-black tracking-widest mb-1.5">Username</label>
                                <input required type="text" value={username} onChange={(e) => setUsername(e.target.value)}
                                    className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-4 py-3 text-white focus:border-[#D4AF37] focus:bg-white/5 outline-none transition-all placeholder-white/20"
                                    placeholder="Your Name" />
                            </div>
                        )}

                        <div>
                            <label className="block text-[#D4AF37] text-[10px] uppercase font-black tracking-widest mb-1.5">
                                {mode === 'login' ? 'Username / Email' : 'Email Address'}
                            </label>
                            <input required type={mode === 'login' ? 'text' : 'email'}
                                value={mode === 'login' ? identifier : email}
                                onChange={(e) => mode === 'login' ? setIdentifier(e.target.value) : setEmail(e.target.value)}
                                className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-4 py-3 text-white focus:border-[#D4AF37] focus:bg-white/5 outline-none transition-all placeholder-white/20"
                                placeholder={mode === 'login' ? 'Your Username or Email' : 'trainer@example.com'} />
                        </div>

                        <div>
                            <label className="block text-[#D4AF37] text-[10px] uppercase font-black tracking-widest mb-1.5">Password</label>
                            <input required type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                                className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-4 py-3 text-white focus:border-[#D4AF37] focus:bg-white/5 outline-none transition-all placeholder-white/20"
                                placeholder="••••••••" />
                        </div>

                        {mode === 'signup' && (
                            <>
                                <div>
                                    <label className="block text-[#D4AF37] text-[10px] uppercase font-black tracking-widest mb-1.5">X (Twitter) Username <span className="text-gray-500 font-normal lowercase">(optional)</span></label>
                                    <div className="relative">
                                        <span className="absolute left-3 top-3.5 text-white/30 text-sm">@</span>
                                        <input type="text" value={xUsername} onChange={(e) => setXUsername(e.target.value)}
                                            className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg pl-8 pr-4 py-3 text-white focus:border-[#D4AF37] focus:bg-white/5 outline-none transition-all placeholder-white/20"
                                            placeholder="username" />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-[#D4AF37] text-[10px] uppercase font-black tracking-widest mb-1.5">
                                        Invite Code <span className="text-gray-500 font-normal lowercase">(optional)</span>
                                    </label>
                                    <input type="text" value={inviteCode} onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                                        className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-4 py-3 text-[#D4AF37] placeholder-white/20 focus:border-[#D4AF37] focus:bg-white/5 outline-none transition-all font-mono tracking-widest"
                                        placeholder="RAW-XXXXXXXX (optional)" />
                                    <p className="text-[10px] text-gray-500 mt-1">You can also redeem a code later in Settings</p>
                                </div>
                            </>
                        )}

                        {mode === 'login' && (
                            <div className="text-right">
                                <button type="button" onClick={() => switchMode('forgot')}
                                    className="text-[10px] font-bold uppercase tracking-widest text-white/40 hover:text-[#D4AF37] transition-colors">
                                    Forgot password?
                                </button>
                            </div>
                        )}

                        <button type="submit" disabled={loading}
                            className="w-full bg-[#D4AF37] text-black font-black uppercase tracking-widest py-3 rounded-lg shadow-[0_0_15px_rgba(212,175,55,0.2)] hover:bg-[#E5C158] transition-all disabled:opacity-50 mt-2">
                            {loading ? <i className="fa-solid fa-circle-notch fa-spin"></i> : (mode === 'login' ? 'Sign In' : 'Join Beta')}
                        </button>

                        {/* Google Sign-In divider + button */}
                        <div className="flex items-center gap-3 my-1">
                            <div className="flex-1 h-px bg-white/10" />
                            <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">or</span>
                            <div className="flex-1 h-px bg-white/10" />
                        </div>
                        <div ref={googleBtnRef} className="flex justify-center" style={{ minHeight: '44px' }} />
                    </form>
                )}

                {/* ── FORGOT PASSWORD FORM ── */}
                {mode === 'forgot' && (
                    <form onSubmit={handleForgotPassword} className="space-y-4">
                        <div>
                            <label className="block text-[#D4AF37] text-[10px] uppercase font-black tracking-widest mb-1.5">Email Address</label>
                            <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                                className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-4 py-3 text-white focus:border-[#D4AF37] focus:bg-white/5 outline-none transition-all placeholder-white/20"
                                placeholder="trainer@example.com" />
                        </div>
                        <button type="submit" disabled={loading || !!success}
                            className="w-full bg-[#D4AF37] text-black font-black uppercase tracking-widest py-3 rounded-lg shadow-[0_0_15px_rgba(212,175,55,0.2)] hover:bg-[#E5C158] transition-all disabled:opacity-50">
                            {loading ? <i className="fa-solid fa-circle-notch fa-spin"></i> : 'Send Reset Link'}
                        </button>
                        <div className="text-center">
                            <button type="button" onClick={() => switchMode('login')}
                                className="text-xs text-poke-accent hover:underline">Back to sign in</button>
                        </div>
                    </form>
                )}

                {/* ── RESET PASSWORD FORM ── */}
                {mode === 'reset' && (
                    <form onSubmit={handleResetConfirm} className="space-y-4">
                        <div>
                            <label className="block text-[#D4AF37] text-[10px] uppercase font-black tracking-widest mb-1.5">New Password</label>
                            <input required type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                                className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-4 py-3 text-white focus:border-[#D4AF37] focus:bg-white/5 outline-none transition-all placeholder-white/20"
                                placeholder="Min. 8 characters" />
                        </div>
                        <div>
                            <label className="block text-[#D4AF37] text-[10px] uppercase font-black tracking-widest mb-1.5">Confirm Password</label>
                            <input required type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                                className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-4 py-3 text-white focus:border-[#D4AF37] focus:bg-white/5 outline-none transition-all placeholder-white/20"
                                placeholder="••••••••" />
                        </div>
                        <button type="submit" disabled={loading || !!success}
                            className="w-full bg-[#D4AF37] text-black font-black uppercase tracking-widest py-3 rounded-lg shadow-[0_0_15px_rgba(212,175,55,0.2)] hover:bg-[#E5C158] transition-all disabled:opacity-50">
                            {loading ? <i className="fa-solid fa-circle-notch fa-spin"></i> : 'Set New Password'}
                        </button>
                    </form>
                )}

                <div className="mt-6 text-center pt-6 border-t border-white/10">
                    {(mode === 'login' || mode === 'signup') && (
                        <button
                            onClick={() => switchMode(mode === 'login' ? 'signup' : 'login')}
                            className="text-[#D4AF37] hover:text-[#E5C158] hover:underline text-[10px] font-black uppercase tracking-widest transition-colors">
                            {mode === 'login' ? "Have an invite? Register now" : "Already have an account? Sign in"}
                        </button>
                    )}
                    {mode === 'signup' && (
                        <p className="text-[10px] text-white/40 mt-4 px-4 leading-relaxed font-bold tracking-wide">
                            By joining, you agree to our{' '}
                            <button onClick={() => onNavigate('TERMS_USE')} className="text-[#D4AF37] hover:text-[#E5C158] underline">Terms of Use</button>
                            {' '}and{' '}
                            <a href="/privacy-policy.html" target="_blank" rel="noopener noreferrer" className="text-[#D4AF37] hover:text-[#E5C158] underline">Privacy Policy</a>.
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
};

export default AuthModal;
