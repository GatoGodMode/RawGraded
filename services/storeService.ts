import { UserProfile, StoreSettings, PremiumSettings } from '../types';

const API_URL = 'api/auth.php'; // Updated to local API to resolve CORS

export const TOTP_TOKEN_KEY = 'rawGraded_totp_token';
export const TOTP_REMEMBER_KEY = 'rawGraded_2fa_remember';

const apiRequest = async (action: string, method: 'GET' | 'POST', body: any = null) => {
    const options: RequestInit = { method, credentials: 'include' };
    const url = new URL(API_URL, window.location.href);
    url.searchParams.set('action', action);

    const headers: Record<string, string> = {};
    const totpToken = typeof localStorage !== 'undefined' ? localStorage.getItem(TOTP_TOKEN_KEY) : null;
    if (totpToken) headers['X-2FA-Token'] = totpToken;
    const rememberToken = typeof localStorage !== 'undefined' ? localStorage.getItem(TOTP_REMEMBER_KEY) : null;
    if (rememberToken) headers['X-2FA-Remember'] = rememberToken;

    if (method === 'GET' && body) {
        Object.keys(body).forEach(key => url.searchParams.set(key, body[key]));
    } else if (body) {
        options.body = JSON.stringify(body);
        headers['Content-Type'] = 'application/json';
    }
    if (Object.keys(headers).length) options.headers = headers;

    const res = await fetch(url.toString(), options);
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    return json.data;
};

export const storeService = {
    async login(identifier: string, password: string): Promise<UserProfile> {
        const user = await apiRequest('login', 'POST', { identifier, password });
        if (user) localStorage.setItem('rawGraded_activeUser', JSON.stringify(user));
        return user;
    },
    async signUp(username: string, email: string, pass: string, inviteCode: string, xUsername?: string, applicationToken?: string): Promise<UserProfile> {
        return apiRequest('signup', 'POST', {
            username,
            email,
            password: pass,
            invite_code: inviteCode,
            x_username: xUsername,
            application_token: applicationToken || '',
        });
    },
    async updateProfile(email: string, xUsername: string, password?: string): Promise<UserProfile> {
        const res = await apiRequest('update_profile', 'POST', { email, x_username: xUsername, password });
        return (res?.user ?? res) as UserProfile;
    },
    getCurrentUser(): UserProfile | null {
        try {
            const data = localStorage.getItem('rawGraded_activeUser');
            return data ? JSON.parse(data) : null;
        } catch {
            return null;
        }
    },
    async logout() {
        await apiRequest('logout', 'POST'); // Ensure server clears session
        localStorage.removeItem('rawGraded_activeUser');
        localStorage.removeItem(TOTP_TOKEN_KEY);
        localStorage.removeItem(TOTP_REMEMBER_KEY);
    },
    async checkSession(): Promise<UserProfile | null> {
        try {
            const user = await apiRequest('check_session', 'GET');
            if (user) {
                localStorage.setItem('rawGraded_activeUser', JSON.stringify(user));
                return user;
            }
        } catch (e) {
            localStorage.removeItem('rawGraded_activeUser');
        }
        return null;
    },
    apiRequest // Expose for AdminDashboard
};
