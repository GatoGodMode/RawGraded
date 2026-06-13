import React, { useState, useEffect, useRef, useCallback } from 'react';
import { UserProfile } from '../types';
import { storeService, TOTP_TOKEN_KEY, TOTP_REMEMBER_KEY } from '../services/storeService';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
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

interface InvoiceRow {
    id: number;
    amount_paid: number;
    created_at: string;
    receipt_url: string | null;
    pack_name: string;
    credits: number;
    price: number;
}

interface UserProfileProps {
    user: UserProfile;
    onClose: () => void;
    onUpdate: (user: UserProfile) => void;
    onOpenShop?: () => void;
}

const UserProfileSettings: React.FC<UserProfileProps> = ({ user, onClose, onUpdate, onOpenShop }) => {
    const [email, setEmail] = useState(user.email);
    const [xUsername, setXUsername] = useState(user.x_username || '');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [msg, setMsg] = useState({ type: '', text: '' });

    // Invite Redemption State
    const [redeemCode, setRedeemCode] = useState('');
    const [redeeming, setRedeeming] = useState(false);
    const [redeemMsg, setRedeemMsg] = useState({ type: '', text: '' });

    // Invoices (purchase history)
    const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
    const [invoicesLoading, setInvoicesLoading] = useState(false);
    const [invoicesError, setInvoicesError] = useState('');

    // 2FA TOTP
    const [totpSetup, setTotpSetup] = useState<{ secret: string; qr_uri: string } | null>(null);
    const [totpCode, setTotpCode] = useState('');
    const [totpMsg, setTotpMsg] = useState({ type: '', text: '' });
    const [totpLoading, setTotpLoading] = useState(false);
    const [totpDisableCode, setTotpDisableCode] = useState('');
    const [totpDisableLoading, setTotpDisableLoading] = useState(false);

    const [googleLinkError, setGoogleLinkError] = useState('');
    const [googleLinkLoading, setGoogleLinkLoading] = useState(false);
    const googleBtnRef = useRef<HTMLDivElement>(null);

    const handleGoogleLink = useCallback(async (response: any) => {
        setGoogleLinkLoading(true); setGoogleLinkError('');
        try {
            const res = await fetch('api/auth.php?action=google_link', {
                method: 'POST', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ credential: response.credential }),
            });
            const data = await res.json();
            if (!res.ok || data.error) throw new Error(data.error || 'Link failed');
            onUpdate(data.data);
        } catch (e: any) {
            setGoogleLinkError(e.message || 'Could not link account');
        } finally {
            setGoogleLinkLoading(false);
        }
    }, [onUpdate]);

    useEffect(() => {
        if (user.google_id || !googleBtnRef.current) return;
        let cancelled = false;
        loadGSI().then(() => {
            if (cancelled || !googleBtnRef.current) return;
            (window as any).google.accounts.id.initialize({
                client_id: GOOGLE_CLIENT_ID,
                callback: handleGoogleLink,
                ux_mode: 'popup',
            });
            (window as any).google.accounts.id.renderButton(googleBtnRef.current, {
                type: 'standard', theme: 'outline', size: 'large',
                text: 'signin_with',
                width: googleBtnRef.current.offsetWidth || 320,
                logo_alignment: 'left',
            });
        });
        return () => { cancelled = true; };
    }, [user.google_id, handleGoogleLink]);

    const handleSave = async () => {
        setLoading(true);
        setMsg({ type: '', text: '' });
        try {
            const updatedUser = await storeService.updateProfile(email, xUsername, password || undefined);

            // Update local object immediately as well to reflect changes in UI
            const newUser = { ...user, ...updatedUser };
            localStorage.setItem('rawGraded_activeUser', JSON.stringify(newUser));

            onUpdate(newUser);
            setMsg({ type: 'success', text: 'Profile updated successfully!' });
            setPassword(''); // Clear password field
        } catch (error: any) {
            setMsg({ type: 'error', text: error.message || 'Failed to update profile' });
        } finally {
            setLoading(false);
        }
    };

    const handleRedeemCode = async () => {
        if (!redeemCode) return;
        setRedeeming(true);
        setRedeemMsg({ type: '', text: '' });
        try {
            const res = await fetch('api/auth.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'redeem_invite',
                    code: redeemCode
                })
            });
            const data = await res.json();

            if (data.success) {
                // Update local user object with new bonus_scans
                const newUser = { ...user, bonus_scans: data.bonus_scans };
                localStorage.setItem('rawGraded_activeUser', JSON.stringify(newUser));
                onUpdate(newUser);
                setRedeemMsg({ type: 'success', text: `Success! ${data.message} Total bonus: ${data.bonus_scans}` });
                setRedeemCode('');
            } else {
                setRedeemMsg({ type: 'error', text: data.error || 'Failed to redeem code' });
            }
        } catch (e) {
            setRedeemMsg({ type: 'error', text: 'Network error' });
        } finally {
            setRedeeming(false);
        }
    };

    // System Status State
    const [showStatus, setShowStatus] = useState(false);
    const [sysStatus, setSysStatus] = useState<any>(null);
    const [showLogs, setShowLogs] = useState(false);

    const checkSystemStatus = async () => {
        try {
            const res = await fetch('api/sys_status.php');
            const data = await res.json();
            setSysStatus(data);
        } catch (e) {
            console.error(e);
        }
    };

    useEffect(() => {
        if (showStatus) checkSystemStatus();
    }, [showStatus]);

    useEffect(() => {
        let cancelled = false;
        setInvoicesLoading(true);
        setInvoicesError('');
        fetch('api/invoices.php?action=list', { credentials: 'include' })
            .then(async res => {
                if (res.ok) return res.json();
                const body = await res.json().catch(() => ({}));
                const msg = body?.error ?? 'Failed to load invoices';
                console.error('Invoices list failed', res.status, msg);
                return Promise.reject(new Error(msg));
            })
            .then(data => { if (!cancelled) setInvoices(Array.isArray(data?.data) ? data.data : []); })
            .catch(e => { if (!cancelled) setInvoicesError(e.message || 'Could not load purchases'); })
            .finally(() => { if (!cancelled) setInvoicesLoading(false); });
        return () => { cancelled = true; };
    }, []);


    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-2 sm:p-4">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />

            {/* Status Modal Overlay - white theme */}
            {showStatus && (
                <div className="absolute inset-0 z-[110] flex items-center justify-center p-4 bg-black/50 backdrop-blur-md">
                    <div className="bg-white w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-2xl border border-gray-200 shadow-2xl flex flex-col">
                        <div className="p-4 sm:p-6 border-b border-gray-200 flex-shrink-0 flex justify-between items-center">
                            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                                <i className="fas fa-server text-poke-accent" /> System Status
                            </h2>
                            <button type="button" onClick={() => setShowStatus(false)} className="p-2 text-gray-500 hover:text-gray-900 rounded-lg min-w-[44px] min-h-[44px]">
                                <i className="fas fa-times" />
                            </button>
                        </div>
                        <div className="p-4 sm:p-6 overflow-y-auto flex-1">
                            {sysStatus ? (
                                <div className="space-y-6">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 flex items-center justify-between">
                                            <span className="text-gray-700 font-bold text-sm">Local DB (Grader)</span>
                                            <div className="flex items-center gap-2">
                                                <div className={`w-3 h-3 rounded-full ${sysStatus.checks.local_db ? 'bg-green-500' : 'bg-red-500'}`} />
                                                <span className={`text-xs font-bold ${sysStatus.checks.local_db ? 'text-green-600' : 'text-red-600'}`}>{sysStatus.checks.local_db ? 'ONLINE' : 'OFFLINE'}</span>
                                            </div>
                                        </div>
                                        <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 flex items-center justify-between">
                                            <span className="text-gray-700 font-bold text-sm">Remote DB (Market)</span>
                                            <div className="flex items-center gap-2">
                                                <div className={`w-3 h-3 rounded-full ${sysStatus.checks.remote_db ? 'bg-green-500' : 'bg-red-500'}`} />
                                                <span className={`text-xs font-bold ${sysStatus.checks.remote_db ? 'text-green-600' : 'text-red-600'}`}>{sysStatus.checks.remote_db ? 'ONLINE' : 'OFFLINE'}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div>
                                        <button type="button" onClick={() => setShowLogs(!showLogs)} className="text-xs font-bold text-gray-500 hover:text-gray-900 uppercase tracking-wider flex items-center gap-2">
                                            <i className={`fas fa-chevron-${showLogs ? 'down' : 'right'}`} /> View Sync Logs (Hidden)
                                        </button>
                                        {showLogs && (
                                            <div className="mt-2 bg-gray-100 rounded-lg p-3 h-48 overflow-y-auto font-mono text-[10px] text-gray-600 border border-gray-200">
                                                {sysStatus.logs?.length > 0 ? sysStatus.logs.map((log: string, i: number) => (
                                                    <div key={i} className="border-b border-gray-200 pb-1 mb-1 last:border-0">{log}</div>
                                                )) : <div className="text-center py-10 text-gray-400">No recent errors logged.</div>}
                                            </div>
                                        )}
                                        {user.role === 'admin' && (
                                            <div className="mt-6 pt-6 border-t border-gray-200">
                                                <h3 className="text-sm font-bold text-red-600 mb-3 flex items-center gap-2"><i className="fas fa-shield-alt" /> Admin Actions</h3>
                                                <button type="button" onClick={async () => {
                                                    if (!confirm("Are you sure you want to run the weekly refresh for ALL users?")) return;
                                                    setSysStatus(null);
                                                    try {
                                                        const res = await fetch('cron_weekly_refresh.php?secret=admin_refresh_now');
                                                        const text = await res.text();
                                                        alert(text);
                                                        checkSystemStatus();
                                                    } catch (e) {
                                                        alert("Failed to trigger refresh.");
                                                        checkSystemStatus();
                                                    }
                                                }} className="w-full bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 px-4 py-3 rounded-xl text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2">
                                                    <i className="fas fa-sync-alt" /> Force Global Scan Refresh
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ) : (
                                <div className="text-center py-20">
                                    <i className="fas fa-circle-notch fa-spin text-4xl text-poke-accent mb-4" />
                                    <p className="text-gray-600 text-sm">Pinging servers...</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Main Profile modal - white theme, scrollable on mobile */}
            <div className="relative bg-white w-full max-w-md max-h-[90vh] rounded-2xl shadow-2xl border border-gray-200 animate-fade-in flex flex-col overflow-hidden">
                <div className="flex-shrink-0 flex justify-between items-start p-4 sm:p-6 border-b border-gray-200">
                    <div>
                        <h2 className="text-xl sm:text-2xl font-bold text-gray-900">User Settings</h2>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <p className="text-gray-600 text-sm">Manage your account</p>
                            <button type="button" onClick={() => setShowStatus(true)} className="text-[10px] bg-gray-100 hover:bg-gray-200 text-gray-700 px-2 py-1 rounded border border-gray-200">
                                <i className="fas fa-network-wired mr-1" /> Status
                            </button>
                        </div>
                    </div>
                    <button type="button" onClick={onClose} className="p-2 text-gray-500 hover:text-gray-900 rounded-lg min-w-[44px] min-h-[44px] flex items-center justify-center">
                        <i className="fas fa-times text-xl" />
                    </button>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-6">
                {msg.text && (
                    <div className={`text-sm p-3 rounded-lg mb-4 text-center ${msg.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'}`}>
                        {msg.text}
                    </div>
                )}

                {/* Sign in with Google - link in profile (first so users see it) */}
                <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 mb-4 sm:mb-6">
                    <h3 className="text-sm font-bold text-gray-700 uppercase flex items-center gap-2 mb-3">
                        <i className="fas fa-google text-poke-accent" /> Sign in with Google
                    </h3>
                    {user.google_id ? (
                        <div className="flex items-center gap-3">
                            {user.google_picture && (
                                <img src={user.google_picture} alt="" className="w-10 h-10 rounded-full border-2 border-gray-200" referrerPolicy="no-referrer" />
                            )}
                            <div>
                                <p className="text-sm text-gray-700">Linked. You can sign in with Google and skip 2FA when enabled.</p>
                                <p className="text-xs text-gray-500 mt-1">When you sign in with Google, we don&apos;t ask for a 2FA code.</p>
                            </div>
                        </div>
                    ) : (
                        <div>
                            <p className="text-xs text-gray-600 mb-3">Link a Google account to sign in with Google and skip 2FA when enabled. Once linked, signing in with Google will skip 2FA when it&apos;s enabled.</p>
                            <div ref={googleBtnRef} className="inline-block min-w-[200px] min-h-[44px]" />
                            {googleLinkLoading && <span className="ml-2 text-sm text-gray-500">Linking…</span>}
                            {googleLinkError && <p className="text-sm text-red-600 mt-2">{googleLinkError}</p>}
                        </div>
                    )}
                </div>

                {/* Credit balances */}
                <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 mb-4 sm:mb-6">
                    <h3 className="text-sm font-bold text-gray-700 uppercase flex items-center gap-2 mb-3">
                        <i className="fas fa-coins text-poke-accent" /> Credit balances
                    </h3>
                    <div className="grid grid-cols-3 gap-2 sm:gap-3">
                        <div className="bg-white rounded-lg p-3 border border-gray-200">
                            <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider mb-0.5">Free</p>
                            <p className="text-lg sm:text-xl font-black text-gray-900 tabular-nums">{user.role === 'admin' ? '—' : Math.max(0, user.scan_limit - (user.scans_this_week ?? 0))}</p>
                            <p className="text-[9px] text-gray-500">Resets weekly</p>
                        </div>
                        <div className="bg-white rounded-lg p-3 border border-gray-200">
                            <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider mb-0.5">Bonus</p>
                            <p className="text-lg sm:text-xl font-black text-gray-900 tabular-nums">{user.bonus_scans ?? 0}</p>
                            <p className="text-[9px] text-gray-500">Invites</p>
                        </div>
                        <div className="bg-white rounded-lg p-3 border border-gray-200">
                            <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider mb-0.5">Pro</p>
                            <p className="text-lg sm:text-xl font-black text-poke-accent tabular-nums">{user.role === 'admin' ? '—' : (user.paid_credits ?? 0)}</p>
                            <p className="text-[9px] text-gray-500">Shop</p>
                        </div>
                    </div>
                    {onOpenShop && (
                        <button type="button" onClick={onOpenShop} className="mt-3 w-full text-center text-xs font-bold text-poke-accent hover:text-white bg-poke-accent/10 hover:bg-poke-accent/20 border border-poke-accent/30 rounded-lg py-2.5 transition-colors min-h-[44px]">
                            <i className="fas fa-shopping-cart mr-2" />Buy Pro credits
                        </button>
                    )}
                </div>

                {/* Two-factor authentication - prominent, mobile-friendly */}
                <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 mb-4 sm:mb-6">
                    <h3 className="text-sm font-bold text-gray-700 uppercase flex items-center gap-2 mb-3">
                        <i className="fas fa-shield-alt text-poke-accent" /> Two-factor authentication
                    </h3>
                    {user.totp_enabled ? (
                        <div>
                            <p className="text-xs text-gray-600 mb-3">When you sign in with <strong>email or username and password</strong>, we ask for your 2FA code every time (each session). When you sign in with <strong>Google</strong> (with a linked account above), 2FA is not required.</p>
                            <div className="mb-3">
                                <p className="text-[10px] text-gray-500 uppercase font-bold mb-1.5">Ask for 2FA code</p>
                                <div className="flex flex-col sm:flex-row gap-2">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="radio"
                                            name="totp_remember"
                                            checked={(user.totp_remember_days ?? 0) === 0}
                                            onChange={async () => {
                                                try {
                                                    const res = await fetch('api/auth.php?action=totp_set_remember', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ remember_days: 0 }) });
                                                    const data = await res.json();
                                                    if (data.error) throw new Error(data.error);
                                                    onUpdate({ ...user, totp_remember_days: 0 });
                                                } catch (e: any) {
                                                    setTotpMsg({ type: 'error', text: e.message || 'Failed to update' });
                                                }
                                                }}
                                            className="rounded-full border-gray-300 text-poke-accent focus:ring-poke-accent"
                                        />
                                        <span className="text-sm text-gray-700">Once per login (remember until logout)</span>
                                    </label>
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="radio"
                                            name="totp_remember"
                                            checked={(user.totp_remember_days ?? 0) === 30}
                                            onChange={async () => {
                                                try {
                                                    const res = await fetch('api/auth.php?action=totp_set_remember', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ remember_days: 30 }) });
                                                    const data = await res.json();
                                                    if (data.error) throw new Error(data.error);
                                                    onUpdate({ ...user, totp_remember_days: 30 });
                                                } catch (e: any) {
                                                    setTotpMsg({ type: 'error', text: e.message || 'Failed to update' });
                                                }
                                                }}
                                            className="rounded-full border-gray-300 text-poke-accent focus:ring-poke-accent"
                                        />
                                        <span className="text-sm text-gray-700">Every 30 days</span>
                                    </label>
                                </div>
                            </div>
                            <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    maxLength={6}
                                    placeholder="Code to disable"
                                    value={totpDisableCode}
                                    onChange={e => setTotpDisableCode(e.target.value.replace(/\D/g, ''))}
                                    className="flex-1 min-h-[44px] bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 font-mono w-full sm:w-28"
                                />
                                <button
                                    type="button"
                                    onClick={async () => {
                                        const code = totpDisableCode.replace(/\D/g, '').slice(0, 6);
                                        if (code.length !== 6) { setTotpMsg({ type: 'error', text: 'Enter 6 digits' }); return; }
                                        setTotpDisableLoading(true); setTotpMsg({ type: '', text: '' });
                                        try {
                                            const res = await fetch('api/auth.php?action=totp_disable', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
                                            const data = await res.json();
                                            if (data.error) throw new Error(data.error);
                                            setTotpDisableCode('');
                                            localStorage.removeItem(TOTP_TOKEN_KEY);
                                            localStorage.removeItem(TOTP_REMEMBER_KEY);
                                            const sess = await fetch('api/auth.php?action=check_session', { credentials: 'include' }).then(r => r.json());
                                            if (sess.data) onUpdate(sess.data);
                                            setTotpMsg({ type: 'success', text: '2FA disabled.' });
                                        } catch (e: any) {
                                            setTotpMsg({ type: 'error', text: e.message || 'Failed' });
                                        } finally {
                                            setTotpDisableLoading(false);
                                        }
                                    }}
                                    disabled={totpDisableLoading || totpDisableCode.replace(/\D/g, '').length !== 6}
                                    className="min-h-[44px] bg-gray-600 hover:bg-gray-700 text-white text-sm font-bold px-4 py-2.5 rounded-lg disabled:opacity-50"
                                >
                                    {totpDisableLoading ? '...' : 'Disable 2FA'}
                                </button>
                            </div>
                        </div>
                    ) : totpSetup ? (
                        <div>
                            <p className="text-xs text-gray-600 mb-3">Scan with Google Authenticator (or any TOTP app), then enter the 6-digit code.</p>
                            <div className="flex flex-col sm:flex-row gap-4 mb-4">
                                <div className="flex justify-center sm:justify-start">
                                    <img src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(totpSetup.qr_uri)}`} alt="QR code for authenticator" className="w-44 h-44 sm:w-40 sm:h-40 rounded-lg border-2 border-gray-200 bg-white shrink-0" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-[10px] text-gray-500 uppercase font-bold mb-1">Can’t scan? Enter manually</p>
                                    <p className="text-xs font-mono text-gray-700 break-all bg-white p-2 rounded border border-gray-200">{totpSetup.secret}</p>
                                </div>
                            </div>
                            <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    maxLength={6}
                                    placeholder="000000"
                                    value={totpCode}
                                    onChange={e => { setTotpCode(e.target.value.replace(/\D/g, '')); setTotpMsg({ type: '', text: '' }); }}
                                    className="min-h-[48px] w-full sm:w-32 bg-white border border-gray-300 rounded-lg px-3 py-2.5 text-lg text-gray-900 font-mono text-center tracking-[0.3em]"
                                />
                                <div className="flex gap-2 flex-shrink-0">
                                    <button
                                        type="button"
                                        onClick={async () => {
                                            const code = totpCode.replace(/\D/g, '').slice(0, 6);
                                            if (code.length !== 6) { setTotpMsg({ type: 'error', text: 'Enter 6 digits' }); return; }
                                            setTotpLoading(true); setTotpMsg({ type: '', text: '' });
                                            try {
                                                const res = await fetch('api/auth.php?action=totp_verify_setup', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
                                            const data = await res.json();
                                            if (data.error) throw new Error(data.error);
                                            setTotpSetup(null); setTotpCode('');
                                            if (data.data?.totp_token) localStorage.setItem(TOTP_TOKEN_KEY, data.data.totp_token);
                                            if (data.data?.remember_token) localStorage.setItem(TOTP_REMEMBER_KEY, data.data.remember_token);
                                            if (data.data?.user) onUpdate(data.data.user);
                                            else {
                                                const sess = await fetch('api/auth.php?action=check_session', { credentials: 'include' }).then(r => r.json());
                                                if (sess.data) onUpdate(sess.data);
                                            }
                                            setTotpMsg({ type: 'success', text: '2FA is now enabled.' });
                                            } catch (e: any) {
                                                setTotpMsg({ type: 'error', text: e.message || 'Invalid code' });
                                            } finally {
                                                setTotpLoading(false);
                                            }
                                        }}
                                        disabled={totpLoading || totpCode.replace(/\D/g, '').length !== 6}
                                        className="min-h-[44px] flex-1 sm:flex-none bg-poke-accent hover:bg-red-600 text-white text-sm font-bold px-4 py-2.5 rounded-lg disabled:opacity-50"
                                    >
                                        {totpLoading ? '...' : 'Verify & enable'}
                                    </button>
                                    <button type="button" onClick={() => { setTotpSetup(null); setTotpCode(''); setTotpMsg({ type: '', text: '' }); }} className="min-h-[44px] px-3 text-gray-600 hover:text-gray-900 text-sm font-medium">Cancel</button>
                                </div>
                            </div>
                            {totpMsg.text && <p className={`text-sm mt-2 ${totpMsg.type === 'error' ? 'text-red-600' : 'text-green-600'}`}>{totpMsg.text}</p>}
                        </div>
                    ) : (
                        <div>
                            <p className="text-xs text-gray-600 mb-3">Use an authenticator app (e.g. Google Authenticator) for an extra layer of security. Works on your phone. If you have a linked Google account above, signing in with Google counts as a secure sign-in and does not require 2FA.</p>
                            <button
                                type="button"
                                onClick={async () => {
                                    setTotpLoading(true); setTotpMsg({ type: '', text: '' });
                                    try {
                                        const res = await fetch('api/auth.php?action=totp_setup', { method: 'POST', credentials: 'include' });
                                        const data = await res.json();
                                        if (data.error) throw new Error(data.error);
                                        setTotpSetup(data.data);
                                    } catch (e: any) {
                                        setTotpMsg({ type: 'error', text: e.message || 'Setup failed' });
                                    } finally {
                                        setTotpLoading(false);
                                    }
                                }}
                                disabled={totpLoading}
                                className="w-full min-h-[48px] bg-poke-accent/15 hover:bg-poke-accent/25 text-poke-accent border-2 border-poke-accent/40 text-sm font-bold px-4 py-3 rounded-lg disabled:opacity-50"
                            >
                                {totpLoading ? 'Preparing…' : 'Enable 2FA'}
                            </button>
                            {totpMsg.text && totpMsg.type === 'error' && <p className="text-sm text-red-600 mt-2">{totpMsg.text}</p>}
                        </div>
                    )}
                    {totpMsg.text && totpMsg.type === 'success' && !totpSetup && <p className="text-sm text-green-600 mt-2">{totpMsg.text}</p>}
                </div>

                {/* Invite Redemption */}
                <div className={`rounded-xl border p-4 mb-4 sm:mb-6 ${redeemMsg.type === 'success' ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
                    <h3 className="text-sm font-bold text-gray-700 uppercase flex items-center gap-2 mb-2">
                        <i className="fas fa-gift text-poke-accent" /> Redeem Gift Code
                    </h3>
                    {redeemMsg.text && (
                        <p className={`text-[10px] mb-2 font-bold ${redeemMsg.type === 'error' ? 'text-red-600' : 'text-green-600'}`}>
                            {redeemMsg.text}
                        </p>
                    )}
                    <div className="flex flex-col sm:flex-row gap-2">
                        <input
                            type="text"
                            placeholder="RARE-XXXXXXXX"
                            value={redeemCode}
                            onChange={e => setRedeemCode(e.target.value.toUpperCase())}
                            className="flex-1 min-h-[44px] bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 font-mono uppercase"
                        />
                        <button
                            type="button"
                            onClick={handleRedeemCode}
                            disabled={redeeming || !redeemCode}
                            className="min-h-[44px] bg-poke-accent hover:bg-red-600 text-white text-sm font-bold px-4 py-2.5 rounded-lg disabled:opacity-50"
                        >
                            {redeeming ? '...' : 'REDEEM'}
                        </button>
                    </div>
                </div>

                {/* Purchase history & invoices */}
                <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 mb-4 sm:mb-6">
                    <h3 className="text-sm font-bold text-gray-700 uppercase flex items-center gap-2 mb-3">
                        <i className="fas fa-file-invoice text-poke-accent" /> Purchase history &amp; invoices
                    </h3>
                    {invoicesLoading && <p className="text-xs text-gray-500">Loading…</p>}
                    {invoicesError && <p className="text-xs text-red-600">{invoicesError}</p>}
                    {!invoicesLoading && !invoicesError && invoices.length === 0 && (
                        <p className="text-[10px] text-gray-500">No purchases yet. {onOpenShop ? (
                            <button type="button" onClick={onOpenShop} className="text-poke-accent hover:underline font-bold">Go to Shop</button>
                        ) : (
                            'Use the Shop link in the menu to buy credits.'
                        )}</p>
                    )}
                    {!invoicesLoading && invoices.length > 0 && (
                        <ul className="space-y-2 max-h-48 overflow-y-auto">
                            {invoices.map((row) => (
                                <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2 border-b border-gray-200 last:border-0 text-xs">
                                    <span className="text-gray-700">{row.pack_name} — ${Number(row.amount_paid).toFixed(2)} ({row.credits} credits)</span>
                                    <span className="text-gray-500">{row.created_at ? new Date(row.created_at).toLocaleDateString() : ''}</span>
                                    <a href={`api/invoices.php?action=download&id=${row.id}`} target="_blank" rel="noopener noreferrer" className="text-poke-accent hover:underline font-bold">
                                        Download invoice
                                    </a>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                <div className="space-y-4">
                    <div>
                        <label className="block text-gray-600 text-xs uppercase font-bold mb-1">Username</label>
                        <input disabled value={user.username} className="w-full min-h-[44px] bg-gray-100 border border-gray-200 rounded-lg px-4 py-3 text-gray-500 cursor-not-allowed" />
                        <p className="text-[10px] text-gray-500 mt-1">Username cannot be changed.</p>
                    </div>
                    <div>
                        <label className="block text-gray-600 text-xs uppercase font-bold mb-1">Email Address</label>
                        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full min-h-[44px] bg-white border border-gray-300 rounded-lg px-4 py-3 text-gray-900 focus:border-poke-accent outline-none" />
                    </div>
                    <div>
                        <label className="block text-gray-600 text-xs uppercase font-bold mb-1">X (Twitter) Username</label>
                        <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">@</span>
                            <input type="text" value={xUsername} onChange={(e) => setXUsername(e.target.value)} className="w-full min-h-[44px] bg-white border border-gray-300 rounded-lg pl-8 pr-4 py-3 text-gray-900 focus:border-poke-accent outline-none" placeholder="username" />
                        </div>
                    </div>
                    <div>
                        <label className="block text-gray-600 text-xs uppercase font-bold mb-1">New Password <span className="font-normal lowercase text-gray-500">(leave blank to keep current)</span></label>
                        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full min-h-[44px] bg-white border border-gray-300 rounded-lg px-4 py-3 text-gray-900 focus:border-poke-accent outline-none" placeholder="••••••••" />
                    </div>
                    <button type="button" onClick={handleSave} disabled={loading} className="w-full min-h-[48px] bg-poke-accent text-white font-bold py-3 rounded-lg shadow-lg hover:bg-red-600 transition-colors disabled:opacity-50 mt-4">
                        {loading ? <i className="fa-solid fa-circle-notch fa-spin" /> : 'Save Changes'}
                    </button>
                </div>
                </div>
            </div>
        </div>
    );
};

export default UserProfileSettings;
