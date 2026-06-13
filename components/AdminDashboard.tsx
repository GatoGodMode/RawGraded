import React, { useState, useEffect } from 'react';
import { storeService } from '../services/storeService';
import { UserProfile } from '../types';
import { GoogleGenAI } from "@google/genai";

interface AdminDashboardProps {
    user: UserProfile;
    isOpen: boolean;
    onClose: () => void;
}

/** Matches common Stripe `recurring.interval=day` + `interval_count` values */
const SUBSCRIPTION_INTERVAL_PRESETS = [7, 14, 30, 60, 90, 180, 365] as const;

const AdminDashboard: React.FC<AdminDashboardProps> = ({ user, isOpen, onClose }) => {
    const [stats, setStats] = useState<any>(null);
    const [users, setUsers] = useState<any[]>([]);
    const [newCode, setNewCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [activeTab, setActiveTab] = useState<'invites' | 'applications' | 'users' | 'certs' | 'settings' | 'integrity' | 'ownership' | 'badges' | 'shop' | 'disputes'>('invites');
    const [pendingApplications, setPendingApplications] = useState<any[]>([]);
    const [ownershipFrom, setOwnershipFrom] = useState<number | null>(null);
    const [ownershipTo, setOwnershipTo] = useState<number | null>(null);
    const [apiKey, setApiKey] = useState('');
    const [stripePubKey, setStripePubKey] = useState('');
    const [stripePrivKey, setStripePrivKey] = useState('');
    const [stripeWebhookSecret, setStripeWebhookSecret] = useState('');
    const [removeBgApiKey, setRemoveBgApiKey] = useState('');
    const [showApiKey, setShowApiKey] = useState(false);
    const [apiKeyStatus, setApiKeyStatus] = useState<'idle' | 'saving' | 'testing'>('idle');

    const [editingUser, setEditingUser] = useState<any>(null);
    const [reassigningCert, setReassigningCert] = useState<any>(null);
    const [showUserModal, setShowUserModal] = useState(false);
    const [userFormData, setUserFormData] = useState({
        username: '',
        email: '',
        password: '',
        scan_limit: 5,
        bonus_scans: 0,
        paid_credits: 0,
        x_username: '',
        vip_lifetime: 0 as 0 | 1,
    });

    // Badge Management State
    const [badges, setBadges] = useState<any[]>([]);
    const [syncing, setSyncing] = useState(false);
    const [showBadgeModal, setShowBadgeModal] = useState(false);
    const [editingBadge, setEditingBadge] = useState<any>(null);
    const [badgeFormData, setBadgeFormData] = useState({
        name: '',
        description: '',
        icon_url: '',
        rank_level: 'Trainer',
        bonus_scans: 0,
        requirements: [{ requirement_type: 'total_scans', operator: '>=', required_value: 1 as string | number }]
    });

    // Shop/Pack Management State
    const [scanPacks, setScanPacks] = useState<any[]>([]);
    const [subscriptionPlans, setSubscriptionPlans] = useState<any[]>([]);
    const [showPackModal, setShowPackModal] = useState(false);
    const [editingPack, setEditingPack] = useState<any>(null);
    const [packFormData, setPackFormData] = useState({
        name: '',
        credits: 10,
        price: 9.99,
        currency: 'USD',
        description: '',
        active: 1
    });

    const [disputes, setDisputes] = useState<any[]>([]);

    if (!isOpen) return null;

    useEffect(() => {
        fetchStats();
        if (activeTab === 'users' || activeTab === 'certs') fetchUsers();
        if (activeTab === 'settings') {
            fetchSettings();
        }
        if (activeTab === 'badges') {
            fetchBadges();
        }
        if (activeTab === 'shop') {
            fetchScanPacks();
            fetchSubscriptionPlans();
        }
        if (activeTab === 'disputes') {
            fetchDisputes();
        }
        if (activeTab === 'applications') {
            fetchPendingApplications();
        }
    }, [activeTab]);

    const fetchStats = async () => {
        try {
            const data = await storeService.apiRequest('admin_stats', 'GET');
            setStats(data);
        } catch (e) {
            console.error(e);
        }
    };

    const generateInvite = async () => {
        setLoading(true);
        try {
            const res = await storeService.apiRequest('generate_invite', 'POST');
            setNewCode(res.code);
            fetchStats();
        } catch (e) {
            alert('Failed to generate code');
        } finally {
            setLoading(false);
        }
    };

    const deleteCert = async (id: string) => {
        if (!confirm('Are you sure you want to delete this certificate? This cannot be undone.')) return;
        setLoading(true);
        try {
            const res = await storeService.apiRequest('admin_delete_cert', 'POST', { id });
            if (res.success) {
                fetchStats();
            } else {
                alert('Failed: ' + res.error);
            }
        } catch (e) {
            alert('Failed to delete certificate');
        } finally {
            setLoading(false);
        }
    }

    const reassignCert = async (certId: string, newUserId: number) => {
        if (!newUserId) return;
        setLoading(true);
        try {
            const res = await storeService.apiRequest('admin_reassign_cert', 'POST', { cert_id: certId, new_user_id: newUserId });
            if (res.success) {
                alert('Certificate re-assigned successfully!');
                setReassigningCert(null);
                fetchStats();
            } else {
                alert('Failed: ' + res.error);
            }
        } catch (e) {
            alert('Failed to re-assign certificate');
        } finally {
            setLoading(false);
        }
    }

    const fetchDisputes = async () => {
        setLoading(true);
        try {
            const data = await storeService.apiRequest('admin_list_disputes', 'GET');
            setDisputes(data || []);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const resolveDispute = async (slabId: number, resolution: 'award_requester' | 'keep_owner') => {
        const actionStr = resolution === 'award_requester' ? 'AWARD SLAB TO REQUESTER' : 'KEEP SLAB WITH CURRENT OWNER';
        if (!confirm(`Are you sure you want to resolve this dispute by: ${actionStr}?`)) return;
        setLoading(true);
        try {
            const res = await storeService.apiRequest('admin_resolve_dispute', 'POST', { slab_id: slabId, resolution });
            if (res.success || res.data?.success) {
                alert('Dispute resolved successfully.');
                fetchDisputes();
                fetchStats();
            } else {
                alert('Error: ' + res.error);
            }
        } catch (e: any) {
            alert('Failed: ' + e.message);
        } finally {
            setLoading(false);
        }
    };

    const fetchUsers = async () => {
        setLoading(true);
        try {
            const data = await storeService.apiRequest('admin_list_users', 'GET');
            setUsers(data || []);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleSaveUser = async () => {
        setLoading(true);
        try {
            const action = editingUser ? 'admin_update_user' : 'admin_create_user';
            const payload = editingUser ? { ...userFormData, id: editingUser.id } : userFormData;

            await storeService.apiRequest(action, 'POST', payload);
            alert(`User ${editingUser ? 'updated' : 'created'} successfully!`);
            setShowUserModal(false);
            fetchUsers();
            fetchStats();
        } catch (e: any) {
            alert('Error: ' + e.message);
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteUser = async (id: number) => {
        if (!confirm('Are you sure? This user and all their data will be removed.')) return;
        setLoading(true);
        try {
            await storeService.apiRequest('admin_delete_user', 'POST', { id });
            fetchUsers();
            fetchStats();
        } catch (e: any) {
            alert('Error: ' + e.message);
        } finally {
            setLoading(false);
        }
    };

    const handleResetPassword = async (userId: number, username: string) => {
        const newPassword = prompt(`Enter new password for ${username}:`);
        if (!newPassword) return;

        if (newPassword.length < 6) {
            alert('Password must be at least 6 characters');
            return;
        }

        setLoading(true);
        try {
            await storeService.apiRequest('admin_reset_password', 'POST', {
                user_id: userId,
                new_password: newPassword
            });
            alert(`Password reset successfully for ${username}!\nNew password: ${newPassword}`);
        } catch (e: any) {
            alert('Error: ' + e.message);
        } finally {
            setLoading(false);
        }
    };

    const handleToggleAlliance = async (userId: number, currentStatus: number) => {
        const newStatus = currentStatus === 1 ? 0 : 1;
        setLoading(true);
        try {
            await storeService.apiRequest('admin_toggle_alliance', 'POST', {
                user_id: userId,
                is_alliance: newStatus
            });
            fetchUsers();
        } catch (e: any) {
            alert('Error: ' + e.message);
        } finally {
            setLoading(false);
        }
    };

    const handleTogglePck = async (userId: number, currentStatus: number) => {
        const newStatus = currentStatus === 1 ? 0 : 1;
        setLoading(true);
        try {
            await storeService.apiRequest('admin_toggle_pck', 'POST', {
                user_id: userId,
                is_pck: newStatus
            });
            fetchUsers();
        } catch (e: any) {
            alert('Error: ' + e.message);
        } finally {
            setLoading(false);
        }
    };

    const handleToggleVipLifetime = async (userId: number, currentStatus: number) => {
        const newStatus = currentStatus === 1 ? 0 : 1;
        setLoading(true);
        try {
            await storeService.apiRequest('admin_toggle_vip_lifetime', 'POST', {
                user_id: userId,
                vip_lifetime: newStatus
            });
            fetchUsers();
        } catch (e: any) {
            alert('Error: ' + e.message);
        } finally {
            setLoading(false);
        }
    };

    const runIntegrityFix = async () => {
        if (!confirm("This will forcibly remove any self-links or broken parent references database-wide. Proceed?")) return;
        setLoading(true);
        try {
            const res = await storeService.apiRequest('admin_integrity_fix', 'POST');
            alert(`Repair complete! Fixed ${res.total_fixed} broken links.`);
            // fetchIntegrity(); // Assuming fetchIntegrity is defined elsewhere or not needed for this diff
            fetchStats();
        } catch (e: any) {
            alert('Fix failed: ' + e.message);
        } finally {
            setLoading(false);
        }
    };

    const handleBulkTransfer = async () => {
        if (!ownershipFrom || !ownershipTo) {
            alert("Please select both source and destination users.");
            return;
        }
        if (ownershipFrom === ownershipTo) {
            alert("Source and destination users must be different.");
            return;
        }
        if (!confirm(`Are you sure you want to transfer ALL certificates from User ID ${ownershipFrom} to User ID ${ownershipTo}?`)) return;

        setLoading(true);
        try {
            const res = await storeService.apiRequest('admin_bulk_transfer', 'POST', {
                from_user_id: ownershipFrom,
                to_user_id: ownershipTo
            });
            if (res.success) {
                alert(`Success! ${res.affected_count} certificates transferred.`);
                fetchStats();
            } else {
                alert("Transfer failed: " + res.error);
            }
        } catch (e: any) {
            alert("Error: " + e.message);
        } finally {
            setLoading(false);
        }
    };

    const handleClaimCerts = async (fromId: number) => {
        if (!fromId) return;
        if (!confirm(`Are you sure you want to CLAIM all certificates from User ID ${fromId}? (They will be moved to your vault)`)) return;

        setLoading(true);
        try {
            const res = await storeService.apiRequest('admin_claim_certs', 'POST', {
                from_user_id: fromId
            });
            if (res.success) {
                alert(`Success! ${res.affected_count} certificates added to your vault.`);
                fetchStats();
            } else {
                alert("Claim failed: " + res.error);
            }
        } catch (e: any) {
            alert("Error: " + e.message);
        } finally {
            setLoading(false);
        }
    };

    const openEditModal = (u: any) => {
        setEditingUser(u);
        setUserFormData({
            username: u.username,
            email: u.email,
            password: '',
            scan_limit: u.scan_limit,
            bonus_scans: u.bonus_scans,
            paid_credits: u.paid_credits ?? 0,
            x_username: u.x_username || '',
            vip_lifetime: u.vip_lifetime === 1 ? 1 : 0,
        });
        setShowUserModal(true);
    };

    const openCreateModal = () => {
        setEditingUser(null);
        setUserFormData({
            username: '',
            email: '',
            password: '',
            scan_limit: 5,
            bonus_scans: 0,
            paid_credits: 0,
            x_username: '',
            vip_lifetime: 0,
        });
        setShowUserModal(true);
    };

    const syncDb = async (opts?: { setRemoveBgOnly?: boolean }) => {
        const setRemoveBgOnly = !!opts?.setRemoveBgOnly;
        const msg = setRemoveBgOnly
            ? 'Update REMOVEBG_API_KEY in the settings table? (Uses SQL Sync runner.)'
            : 'This will attempt to fix/create missing database tables. Continue?';
        if (!confirm(msg)) return;
        setLoading(true);
        try {
            const res = await fetch('api/sync_db.php', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    removeBgApiKey: removeBgApiKey || '',
                })
            });
            const json = await res.json();
            if (json.status === 'success') {
                alert('Success: ' + json.message);
                fetchStats();
            } else {
                alert('Error: ' + json.error);
            }
        } catch (e) {
            alert('Failed to sync database');
        } finally {
            setLoading(false);
        }
    };

    const flushCache = async () => {
        if (!confirm('Bump site cache version? All users will get a fresh load on their next visit or page check.')) return;
        setLoading(true);
        try {
            const data = await storeService.apiRequest('admin_bump_cache_version', 'POST');
            alert(`Cache version bumped to ${data?.version ?? '?'}. Users will reload to the latest build on next check.`);
        } catch (e: any) {
            alert('Failed: ' + (e?.message ?? 'Unknown error'));
        } finally {
            setLoading(false);
        }
    };

    const fetchSettings = async () => {
        try {
            const res = await fetch('api/settings.php?action=get_settings', { credentials: 'include' });
            const json = await res.json();
            if (json.data) {
                setApiKey(json.data.gemini_api_key || '');
                setStripePubKey(json.data.stripe_publishable_key || '');
                setStripePrivKey(json.data.stripe_secret_key || '');
                setStripeWebhookSecret(json.data.stripe_webhook_secret || '');
            }

            // remove.bg key is read-only exposed via a dedicated action
            const r2 = await fetch('api/settings.php?action=get_remove_bg_key', { credentials: 'include' });
            const j2 = await r2.json().catch(() => ({}));
            if (j2?.data) setRemoveBgApiKey(j2.data.removeBgApiKey || '');
        } catch (e) {
            console.error('Failed to fetch settings', e);
        }
    };

    const saveSettings = async (settings: Record<string, string>) => {
        setApiKeyStatus('saving');
        try {
            const res = await fetch('api/settings.php?action=update_settings', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings)
            });
            const json = await res.json();
            if (json.success) {
                alert('Settings updated successfully!');
            } else {
                alert('Error: ' + (json.error || 'Unknown error'));
            }
        } catch (e) {
            alert('Failed to save settings');
        } finally {
            setApiKeyStatus('idle');
        }
    };

    const fetchScanPacks = async () => {
        setLoading(true);
        try {
            const res = await fetch('api/stripe.php?action=admin_get_packs', { credentials: 'include' });
            const json = await res.json();
            if (json.data) {
                setScanPacks(json.data);
            }
        } catch (e) {
            console.error('Failed to fetch scan packs', e);
        } finally {
            setLoading(false);
        }
    };

    const fetchSubscriptionPlans = async () => {
        try {
            const res = await fetch('api/stripe.php?action=admin_get_subscription_plans', { credentials: 'include' });
            const json = await res.json();
            if (json.data) setSubscriptionPlans(json.data);
        } catch (e) {
            console.error(e);
        }
    };

    const saveSubscriptionPlanRow = async (plan: any) => {
        setLoading(true);
        try {
            const res = await fetch('api/stripe.php?action=admin_save_subscription_plan', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: plan.id > 0 ? plan.id : 0,
                    label: plan.label,
                    interval_days: Math.min(365, Math.max(1, parseInt(String(plan.interval_days), 10) || 1)),
                    stripe_price_id: plan.stripe_price_id,
                    amount_cents: plan.amount_cents,
                    currency: (plan.currency || 'usd').toLowerCase().slice(0, 3),
                    active: plan.active ? 1 : 0,
                    sort_order: plan.sort_order ?? 0,
                }),
            });
            const json = await res.json();
            if (json.success) {
                await fetchSubscriptionPlans();
            } else {
                alert(json.error || 'Save failed');
            }
        } catch {
            alert('Save failed');
        } finally {
            setLoading(false);
        }
    };

    const addSubscriptionPlanDraft = () => {
        setSubscriptionPlans((prev) => [
            ...prev,
            {
                id: -Date.now(),
                label: 'New membership',
                interval_days: 30,
                stripe_price_id: '',
                amount_cents: 0,
                currency: 'usd',
                active: 0,
                sort_order: prev.length ? Math.max(...prev.map((p) => p.sort_order ?? 0)) + 10 : 0,
            },
        ]);
    };

    const deleteSubscriptionPlanRow = async (plan: any) => {
        if (!plan.id || plan.id <= 0) {
            setSubscriptionPlans((prev) => prev.filter((p) => p.id !== plan.id));
            return;
        }
        if (!confirm(`Delete subscription plan “${plan.label}”? This does not remove the Price object in Stripe.`)) return;
        setLoading(true);
        try {
            const res = await fetch('api/stripe.php?action=admin_delete_subscription_plan', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: plan.id }),
            });
            const json = await res.json();
            if (json.success) await fetchSubscriptionPlans();
            else alert(json.error || 'Delete failed');
        } catch {
            alert('Delete failed');
        } finally {
            setLoading(false);
        }
    };

    const fetchPendingApplications = async () => {
        setLoading(true);
        try {
            const res = await fetch('api/applications.php?action=admin_list_pending', { credentials: 'include' });
            const json = await res.json();
            setPendingApplications(json.data || []);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const resolveApplication = async (id: number, decision: 'approved' | 'rejected') => {
        setLoading(true);
        try {
            const res = await fetch('api/applications.php?action=admin_resolve', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, decision, review_notes: '' }),
            });
            const json = await res.json();
            if (json.success) fetchPendingApplications();
            else alert(json.error || 'Failed');
        } catch {
            alert('Failed');
        } finally {
            setLoading(false);
        }
    };

    const saveApiKey = async () => {
        if (!confirm('Update the Gemini API Key? This will affect all grading operations.')) return;
        saveSettings({ gemini_api_key: apiKey });
    };

    const testApiKey = async () => {
        if (!apiKey) {
            alert('Please enter an API key first');
            return;
        }

        setApiKeyStatus('testing');
        try {
            const ai = new GoogleGenAI({ apiKey });
            const response = await ai.models.generateContent({
                model: "gemini-3-flash-preview",
                contents: { parts: [{ text: "Hello! Are you online? Respond with 'Online' if you can hear me." }] }
            });

            const text = response.text;

            if (text) {
                alert('Success! API Key is valid.\n\nResponse: ' + text);
            } else {
                throw new Error('Empty response from AI');
            }
        } catch (error: any) {
            console.error('API Test Error:', error);
            alert('API Test Failed: ' + (error.message || 'Unknown error'));
        } finally {
            setApiKeyStatus('idle');
        }
    };

    const handleSavePack = async () => {
        if (!packFormData.name || !packFormData.credits || !packFormData.price) {
            alert('Name, credits, and price are required');
            return;
        }
        setLoading(true);
        try {
            const res = await fetch('api/stripe.php?action=admin_save_pack', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...packFormData, id: editingPack?.id })
            });
            const json = await res.json();
            if (json.success) {
                alert(`Pack ${editingPack ? 'updated' : 'created'} successfully!`);
                setShowPackModal(false);
                fetchScanPacks();
            } else {
                alert('Error: ' + json.error);
            }
        } catch (e) {
            alert('Failed to save pack');
        } finally {
            setLoading(false);
        }
    };

    const handleDeletePack = async (id: number) => {
        if (!confirm('Are you sure you want to delete this pack?')) return;
        setLoading(true);
        try {
            const res = await fetch('api/stripe.php?action=admin_delete_pack', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id })
            });
            const json = await res.json();
            if (json.success) {
                fetchScanPacks();
            } else {
                alert('Error: ' + json.error);
            }
        } catch (e) {
            alert('Failed to delete pack');
        } finally {
            setLoading(false);
        }
    };

    const openPackModal = (p?: any) => {
        if (p) {
            setEditingPack(p);
            setPackFormData({
                name: p.name,
                credits: p.credits,
                price: p.price,
                currency: p.currency,
                description: p.description || '',
                active: p.active
            });
        } else {
            setEditingPack(null);
            setPackFormData({
                name: '',
                credits: 10,
                price: 9.99,
                currency: 'USD',
                description: '',
                active: 1
            });
        }
        setShowPackModal(true);
    };

    // Badge Management Functions
    const fetchBadges = async () => {
        setLoading(true);
        try {
            const res = await fetch('api/badges.php?action=list', { credentials: 'include' });
            const json = await res.json();
            if (json.badges) {
                setBadges(json.badges);
            }
        } catch (e) {
            console.error('Failed to fetch badges', e);
        } finally {
            setLoading(false);
        }
    };

    const openBadgeModal = (badge?: any) => {
        if (badge) {
            setEditingBadge(badge);
            setBadgeFormData({
                name: badge.name || '',
                description: badge.description || '',
                icon_url: badge.icon_url || '',
                rank_level: badge.rank_level || 'Trainer',
                bonus_scans: badge.bonus_scans || 0,
                requirements: badge.requirements || [{ requirement_type: 'total_scans', operator: '>=', required_value: 1 }]
            });
        } else {
            setEditingBadge(null);
            setBadgeFormData({
                name: '',
                description: '',
                icon_url: '',
                rank_level: 'Trainer',
                bonus_scans: 0,
                requirements: [{ requirement_type: 'total_scans', operator: '>=', required_value: 1 as string | number }]
            });
        }
        setShowBadgeModal(true);
    };

    const saveBadge = async () => {
        if (!badgeFormData.name) {
            alert('Badge name is required!');
            return;
        }
        setLoading(true);
        try {
            const payload = {
                action: editingBadge ? 'update' : 'create',
                ...badgeFormData,
                requirements: badgeFormData.requirements.map(r => ({
                    ...r,
                    target_criteria: (r as any).target_criteria // Ensure this is passed
                })),
                ...(editingBadge ? { id: editingBadge.id } : {})
            };
            const res = await fetch('api/badges.php', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const json = await res.json();
            if (json.status === 'success') {
                alert(`Badge ${editingBadge ? 'updated' : 'created'} successfully!`);
                setShowBadgeModal(false);
                fetchBadges();
            } else {
                alert('Error: ' + (json.error || 'Unknown error'));
            }
        } catch (e) {
            alert('Failed to save badge');
        } finally {
            setLoading(false);
        }
    };

    const handleBadgeIconUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (file.size > 2 * 1024 * 1024) {
            alert("File size must be less than 2MB");
            return;
        }

        const formData = new FormData();
        formData.append('file', file);

        setLoading(true);
        try {
            const res = await fetch('api/upload_badge_icon.php', {
                method: 'POST',
                body: formData
            });
            const json = await res.json();
            if (json.success) {
                setBadgeFormData(prev => ({ ...prev, icon_url: json.url }));
            } else {
                alert('Upload failed: ' + (json.error || 'Unknown error'));
            }
        } catch (err) {
            alert('Upload failed');
        } finally {
            setLoading(false);
        }
    };

    const deleteBadge = async (id: number) => {
        if (!confirm('Delete this badge? Users who earned it will keep it, but it cannot be earned again.')) return;
        setLoading(true);
        try {
            const res = await fetch(`api/badges.php?id=${id}`, {
                method: 'DELETE',
                credentials: 'include'
            });
            const json = await res.json();
            if (json.status === 'success') {
                fetchBadges();
            } else {
                alert('Error: ' + (json.error || 'Unknown error'));
            }
        } catch (e) {
            alert('Failed to delete badge');
        } finally {
            setLoading(false);
        }
    };

    const syncAllBadges = async (revoke: boolean) => {
        const msg = revoke
            ? 'WARNING: This will check all users. Badges that are no longer earned will be REVOKED. Proceed?'
            : 'This will check all users and award new badges. Existing badges will be continually held. Proceed?';

        if (!confirm(msg)) return;

        setSyncing(true);
        try {
            const res = await fetch(`api/badges.php?action=sync_all&revoke=${revoke}`, { credentials: 'include' });
            const data = await res.json();
            if (data.error) {
                alert('Sync failed: ' + data.error);
            } else {
                alert(`✅ Sync Complete!\n${data.badges_awarded} badges awarded\n${data.bonus_scans_granted} bonus scans granted\n${data.users_processed} users processed`);
                fetchBadges();
                fetchStats();
            }
        } catch (err: any) {
            alert('Sync failed: ' + err.message);
        } finally {
            setSyncing(false);
        }
    };


    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-2 sm:p-4 bg-black/40 backdrop-blur-md animate-fade-in overflow-hidden">
            <div className="bg-[#050505] w-full max-w-5xl h-full max-h-[95vh] sm:max-h-[90vh] rounded-none sm:rounded-2xl border-0 sm:border-2 border-white/10 shadow-2xl overflow-hidden flex flex-col min-h-0">

                {/* Header — compact on mobile */}
                <div className="flex-shrink-0 px-3 py-3 sm:p-4 md:p-6 border-b border-white/10 flex justify-between items-center bg-[#080808] gap-2">
                    <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                        <div className="w-9 h-9 sm:w-10 sm:h-10 bg-poke-gold rounded-full flex items-center justify-center text-black font-bold flex-shrink-0">
                            <i className="fas fa-shield-alt text-sm sm:text-base"></i>
                        </div>
                        <div className="min-w-0">
                            <h2 className="text-base sm:text-xl font-bold text-white truncate">Admin Console</h2>
                            <p className="text-[10px] sm:text-xs text-white/50 hidden sm:block">System Management</p>
                        </div>
                    </div>
                    <div className="flex gap-1 sm:gap-2 flex-shrink-0">
                        <button
                            onClick={() => syncDb()}
                            disabled={loading}
                            className="bg-poke-blue hover:opacity-90 text-white px-2 py-1.5 sm:px-3 sm:py-2 rounded text-xs sm:text-sm font-bold flex items-center gap-1 sm:gap-2"
                            title="Repair Database Tables"
                        >
                            <i className="fas fa-database"></i>
                            <span className="hidden sm:inline">SQL Sync</span>
                        </button>
                        <button onClick={onClose} className="p-2 text-white/40 hover:text-white rounded-lg min-w-[44px] min-h-[44px] flex items-center justify-center">
                            <i className="fas fa-times text-lg sm:text-xl"></i>
                        </button>
                    </div>
                </div>

                {/* Tabs — horizontal scroll on small screens */}
                <div className="flex-shrink-0 border-b border-white/10 bg-[#0a0a0a] overflow-x-auto overflow-y-hidden scrollbar-thin">
                    <div className="flex min-w-max">
                        {[
                            { id: 'invites' as const, icon: 'fa-ticket-alt', label: 'Invites' },
                            { id: 'applications' as const, icon: 'fa-clipboard-check', label: 'Applications' },
                            { id: 'users' as const, icon: 'fa-users', label: 'Users' },
                            { id: 'certs' as const, icon: 'fa-certificate', label: 'Certs' },
                            { id: 'integrity' as const, icon: 'fa-heartbeat', label: 'Health' },
                            { id: 'ownership' as const, icon: 'fa-exchange-alt', label: 'Ownership' },
                            { id: 'badges' as const, icon: 'fa-medal', label: 'Badges' },
                            { id: 'settings' as const, icon: 'fa-cog', label: 'API' },
                            { id: 'shop' as const, icon: 'fa-shopping-cart', label: 'Shop' },
                            { id: 'disputes' as const, icon: 'fa-gavel', label: 'Disputes' },
                        ].map(({ id, icon, label }) => (
                            <button
                                key={id}
                                onClick={() => setActiveTab(id)}
                                className={`flex-shrink-0 py-3 px-3 sm:px-4 text-sm font-bold transition-all border-b-2 whitespace-nowrap ${activeTab === id ? 'border-[#D4AF37] text-[#D4AF37] bg-[#D4AF37]/10' : 'border-transparent text-white/50 hover:text-white'}`}
                            >
                                <i className={`fas ${icon} mr-1.5 sm:mr-2`}></i>{label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Content — scrollable, responsive padding */}
                <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-4 sm:p-6 lg:p-8 space-y-6 sm:space-y-8">
                    {activeTab === 'invites' ? (
                        <>
                            {/* Stats Row */}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                                <div className="bg-[#0a0a0a] p-4 sm:p-6 rounded-xl border border-white/10">
                                    <span className="text-xs font-bold text-white/50 uppercase">Total Users</span>
                                    <div className="text-2xl sm:text-4xl font-black text-white mt-2">{stats?.userCount || '-'}</div>
                                </div>
                                <div className="bg-[#0a0a0a] p-4 sm:p-6 rounded-xl border border-white/10">
                                    <span className="text-xs font-bold text-white/50 uppercase">Active Invites</span>
                                    <div className="text-2xl sm:text-4xl font-black text-[#D4AF37] mt-2">
                                        {stats?.invites?.filter((i: any) => !i.is_used).length || '-'}
                                    </div>
                                </div>
                                <div className="bg-[#0a0a0a] p-4 sm:p-6 rounded-xl border border-white/10">
                                    <span className="text-xs font-bold text-white/50 uppercase">System Status</span>
                                    <div className="text-base sm:text-lg font-bold text-green-600 mt-2 flex items-center gap-2">
                                        <i className="fas fa-circle text-[10px] text-green-500"></i> Operational
                                    </div>
                                </div>
                            </div>

                            {/* Invite Generator */}
                            <div className="bg-[#050505] rounded-xl p-4 sm:p-6 lg:p-8 border border-white/10 shadow-lg relative overflow-hidden">
                                <div className="absolute top-0 right-0 p-32 bg-[#D4AF37]/10 rounded-full blur-3xl pointer-events-none"></div>

                                <div className="relative z-10">
                                    <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                                        <i className="fas fa-ticket-alt text-[#D4AF37]"></i> Generate Invite Code
                                    </h3>
                                    <div className="flex flex-col md:flex-row gap-4 items-center">
                                        <button
                                            onClick={generateInvite}
                                            disabled={loading}
                                            className="bg-[#D4AF37] hover:bg-[#E5C158] text-black shadow-[0_0_15px_rgba(212,175,55,0.2)] px-6 py-3 rounded-lg font-bold transition-all shadow-lg flex items-center gap-2"
                                        >
                                            {loading ? <i className="fas fa-spin fa-spinner"></i> : <i className="fas fa-magic"></i>}
                                            Create New Code
                                        </button>

                                        {newCode && (
                                            <div className="flex-1 bg-black/30 border border-[#D4AF37]/50 rounded-lg p-3 flex justify-between items-center animate-pulse-slow">
                                                <span className="font-mono text-xl text-poke-gold tracking-widest font-bold">{newCode}</span>
                                                <button
                                                    onClick={() => navigator.clipboard.writeText(newCode)}
                                                    className="text-white/40 hover:text-white text-xs uppercase font-bold"
                                                >
                                                    Copy
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Invite Codes List */}
                            {stats?.invites && stats.invites.length > 0 && (
                                <div className="bg-[#050505] rounded-xl p-4 sm:p-6 lg:p-8 border border-white/10 shadow-lg">
                                    <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                                        <i className="fas fa-list text-poke-gold"></i> Generated Invite Codes
                                    </h3>
                                    <div className="bg-[#0a0a0a] rounded-xl border border-white/10 overflow-x-auto overflow-hidden">
                                        <table className="w-full text-left text-sm min-w-[520px]">
                                            <thead className="bg-gray-200 text-white/50 uppercase text-xs">
                                                <tr>
                                                    <th className="p-3 sm:p-4">Code</th>
                                                    <th className="p-3 sm:p-4">Status</th>
                                                    <th className="p-3 sm:p-4">Created</th>
                                                    <th className="p-3 sm:p-4">Used By</th>
                                                    <th className="p-3 sm:p-4 text-right">Action</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-white/10 text-white/80">
                                                {stats.invites.map((invite: any, i: number) => (
                                                    <tr key={i} className="hover:bg-[#0a0a0a]">
                                                        <td className="p-3 sm:p-4">
                                                            <span className="font-mono text-poke-gold font-bold tracking-wider">
                                                                {invite.code}
                                                            </span>
                                                        </td>
                                                        <td className="p-4">
                                                            {invite.is_used ? (
                                                                <span className="bg-gray-200 text-white/50 border border-white/20 px-2 py-0.5 rounded text-[10px] font-bold uppercase">
                                                                    Used
                                                                </span>
                                                            ) : (
                                                                <span className="bg-green-100 text-green-700 border border-green-300 px-2 py-0.5 rounded text-[10px] font-bold uppercase">
                                                                    Available
                                                                </span>
                                                            )}
                                                        </td>
                                                        <td className="p-3 sm:p-4 text-white/40 text-xs">
                                                            {new Date(invite.created_at).toLocaleDateString()}
                                                        </td>
                                                        <td className="p-3 sm:p-4 text-white/50 text-xs">
                                                            {invite.used_by_name || '-'}
                                                        </td>
                                                        <td className="p-3 sm:p-4 text-right">
                                                            <button
                                                                onClick={() => {
                                                                    navigator.clipboard.writeText(invite.code);
                                                                    alert('Code copied to clipboard!');
                                                                }}
                                                                className="text-white/40 hover:text-[#D4AF37] transition-colors text-xs font-bold uppercase"
                                                                title="Copy to clipboard"
                                                            >
                                                                <i className="fas fa-copy mr-1"></i> Copy
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </>
                    ) : activeTab === 'applications' ? (
                        <div className="space-y-4">
                            <h3 className="text-sm font-bold text-white/50 uppercase">Applications pending review ({pendingApplications.length})</h3>
                            {pendingApplications.length === 0 ? (
                                <p className="text-white/40 text-sm">No applications in manual review.</p>
                            ) : (
                                <div className="space-y-3">
                                    {pendingApplications.map((a: any) => (
                                        <div key={a.id} className="bg-[#0a0a0a] p-4 rounded border border-white/10 flex flex-wrap justify-between items-center gap-3">
                                            <div>
                                                <p className="text-white font-bold">{a.email}</p>
                                                <p className="text-[10px] text-white/40">{a.created_at ? new Date(a.created_at).toLocaleString() : ''}</p>
                                            </div>
                                            <div className="flex gap-2">
                                                <button type="button" onClick={() => void resolveApplication(a.id, 'approved')} className="px-3 py-1.5 bg-green-800 hover:bg-green-700 text-white text-xs font-bold rounded">Approve</button>
                                                <button type="button" onClick={() => void resolveApplication(a.id, 'rejected')} className="px-3 py-1.5 bg-red-900 hover:bg-red-800 text-white text-xs font-bold rounded">Reject</button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    ) : activeTab === 'users' ? (
                        <div className="space-y-6">
                            <div className="flex justify-between items-center">
                                <h3 className="text-sm font-bold text-white/50 uppercase">System Users ({users.length})</h3>
                                <div className="flex gap-2">
                                    <button
                                        onClick={async () => {
                                            if (!confirm('Reset everyone\'s weekly scan usage to 0 so they can scan again? (Use if weekly sync failed.)')) return;
                                            try {
                                                const data = await storeService.apiRequest('admin_refresh_credits', 'POST');
                                                alert(data?.affected_count != null ? `Reset credits for ${data.affected_count} users.` : 'Done.');
                                                fetchUsers();
                                            } catch (e) {
                                                alert('Failed: ' + (e instanceof Error ? e.message : 'Unknown error'));
                                            }
                                        }}
                                        className="bg-amber-600 text-white px-4 py-2 rounded text-xs font-bold hover:bg-amber-500 transition-all flex items-center gap-2"
                                    >
                                        <i className="fas fa-sync-alt"></i> Refresh Credits
                                    </button>
                                    <button
                                        onClick={async () => {
                                            if (!confirm('Set ALL users to Private Mode and hide all certificates from Public Archive?')) return;
                                            try {
                                                const resp = await fetch('api/privacy.php?action=admin_set_all_private', {
                                                    method: 'POST',
                                                    credentials: 'include',
                                                    headers: { 'Content-Type': 'application/json' }
                                                });
                                                const result = await resp.json();
                                                if (result.success) {
                                                    alert(result.message);
                                                    fetchUsers();
                                                } else {
                                                    alert('Failed: ' + result.error);
                                                }
                                            } catch (e) {
                                                console.error('Set all private failed', e);
                                                alert('Failed. Check console.');
                                            }
                                        }}
                                        className="bg-purple-600 text-white px-4 py-2 rounded text-xs font-bold hover:bg-purple-500 transition-all flex items-center gap-2"
                                    >
                                        <i className="fas fa-eye-slash"></i> Set All Private
                                    </button>
                                    <button
                                        onClick={openCreateModal}
                                        className="bg-[#D4AF37] hover:bg-[#E5C158] text-black shadow-[0_0_15px_rgba(212,175,55,0.2)] px-4 py-2 rounded text-xs font-bold transition-all flex items-center gap-2"
                                    >
                                        <i className="fas fa-user-plus"></i> Create User
                                    </button>
                                </div>
                            </div>

                            <div className="bg-[#0a0a0a] rounded-xl border border-white/10 overflow-x-auto overflow-hidden">
                                <table className="w-full text-left text-sm min-w-[800px]">
                                    <thead className="bg-gray-200 text-white/50 uppercase text-xs">
                                        <tr>
                                            <th className="p-3 sm:p-4">User</th>
                                            <th className="p-3 sm:p-4">Email</th>
                                            <th className="p-3 sm:p-4">Credits</th>
                                            <th className="p-3 sm:p-4">Role</th>
                                            <th className="p-3 sm:p-4 text-center">Privacy</th>
                                            <th className="p-3 sm:p-4 text-center">Alliance</th>
                                            <th className="p-3 sm:p-4 text-center" title="Lifetime free VIP: full platform access without subscription">VIP</th>
                                            <th className="p-3 sm:p-4 text-center">PCK</th>
                                            <th className="p-3 sm:p-4 text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/10 text-white/80">
                                        {users.map((u, i) => (
                                            <tr key={i} className="hover:bg-[#0a0a0a]">
                                                <td className="p-3 sm:p-4">
                                                    <div className="font-bold text-white">{u.username}</div>
                                                    <div className="text-[10px] text-white/40">Joined: {new Date(u.joined_date).toLocaleDateString()}</div>
                                                </td>
                                                <td className="p-3 sm:p-4 text-white/50">{u.email}</td>
                                                <td className="p-3 sm:p-4">
                                                    <span className="text-[#D4AF37] font-black">{u.scans_this_week}</span>
                                                    <span className="text-white/50 mx-1">/</span>
                                                    <span className="font-bold">{u.scan_limit + (u.bonus_scans || 0)}</span>
                                                    {u.bonus_scans > 0 && <span className="text-[10px] text-poke-gold ml-1">({u.bonus_scans} bonus)</span>}
                                                    <span className="text-[10px] text-[#D4AF37] ml-1">Pro: {u.paid_credits ?? 0}</span>
                                                </td>
                                                <td className="p-3 sm:p-4">
                                                    <span className="bg-blue-100 text-blue-700 border border-blue-300 px-2 py-0.5 rounded text-[10px] font-bold uppercase">Member</span>
                                                </td>
                                                <td className="p-3 sm:p-4 text-center">
                                                    <button
                                                        onClick={async () => {
                                                            const newMode = (u.privacy_mode === 'private') ? 'public' : 'private';
                                                            if (!confirm(`Set ${u.username} to ${newMode.toUpperCase()} mode?`)) return;
                                                            try {
                                                                const resp = await fetch('api/privacy.php?action=admin_set_user_privacy', {
                                                                    method: 'POST',
                                                                    credentials: 'include',
                                                                    headers: { 'Content-Type': 'application/json' },
                                                                    body: JSON.stringify({ user_id: u.id, privacy_mode: newMode })
                                                                });
                                                                const result = await resp.json();
                                                                if (result.success) {
                                                                    fetchUsers();
                                                                } else {
                                                                    alert('Failed: ' + result.error);
                                                                }
                                                            } catch (e) {
                                                                console.error('Toggle privacy failed', e);
                                                            }
                                                        }}
                                                        className={`px-3 py-1 rounded text-[10px] font-bold uppercase transition-all ${
                                                            u.privacy_mode === 'private'
                                                                ? 'bg-purple-500/20 text-purple-400 border border-purple-500/50'
                                                                : 'bg-gray-200 text-white/50 border border-white/20 hover:border-purple-500/50'
                                                        }`}
                                                        title={`Privacy: ${u.privacy_mode || 'public'}`}
                                                    >
                                                        <i className={`fas ${u.privacy_mode === 'private' ? 'fa-eye-slash' : 'fa-eye'} mr-1`}></i>
                                                        {u.privacy_mode === 'private' ? 'Private' : 'Public'}
                                                    </button>
                                                </td>
                                                <td className="p-4 text-center">
                                                    <input
                                                        type="checkbox"
                                                        checked={u.is_alliance === 1}
                                                        onChange={() => handleToggleAlliance(u.id, u.is_alliance)}
                                                        className="w-5 h-5 cursor-pointer accent-yellow-500"
                                                        title="Grant Alliance Crown"
                                                    />
                                                </td>
                                                <td className="p-3 sm:p-4 text-center">
                                                    <input
                                                        type="checkbox"
                                                        checked={u.vip_lifetime === 1}
                                                        onChange={() => handleToggleVipLifetime(u.id, u.vip_lifetime)}
                                                        className="w-5 h-5 cursor-pointer accent-amber-500"
                                                        title="Lifetime VIP: full platform access (disable = normal membership rules)"
                                                    />
                                                </td>
                                                <td className="p-3 sm:p-4 text-center">
                                                    <input
                                                        type="checkbox"
                                                        checked={u.is_pck === 1}
                                                        onChange={() => handleTogglePck(u.id, u.is_pck)}
                                                        className="w-5 h-5 cursor-pointer accent-yellow-400"
                                                        title="Grant Pokemon Card King Star"
                                                    />
                                                </td>
                                                <td className="p-3 sm:p-4 text-right">
                                                    <div className="flex justify-end gap-1 sm:gap-2 flex-wrap">
                                                        <button
                                                            onClick={() => openEditModal(u)}
                                                            className="p-2 text-white/40 hover:text-[#D4AF37] transition-colors"
                                                            title="Edit User"
                                                        >
                                                            <i className="fas fa-edit"></i>
                                                        </button>
                                                        <button
                                                            onClick={() => handleResetPassword(u.id, u.username)}
                                                            className="p-2 text-white/40 hover:text-yellow-600 transition-colors"
                                                            title="Reset Password"
                                                        >
                                                            <i className="fas fa-key"></i>
                                                        </button>
                                                        <button
                                                            onClick={async () => {
                                                                if (!confirm(`Reset ${u.username}'s weekly credits to 0?`)) return;
                                                                try {
                                                                    await storeService.apiRequest('admin_refresh_user_credits', 'POST', { user_id: u.id });
                                                                    fetchUsers();
                                                                } catch (e) {
                                                                    alert('Failed: ' + (e instanceof Error ? e.message : 'Unknown error'));
                                                                }
                                                            }}
                                                            className="p-2 text-white/40 hover:text-amber-600 transition-colors"
                                                            title="Reset credits"
                                                        >
                                                            <i className="fas fa-sync-alt"></i>
                                                        </button>
                                                        <button
                                                            onClick={() => handleDeleteUser(u.id)}
                                                            className="p-2 text-white/40 hover:text-red-600 transition-colors"
                                                            title="Delete User"
                                                        >
                                                            <i className="fas fa-trash-alt"></i>
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    ) : activeTab === 'certs' ? (
                        <div>
                            <h3 className="text-sm font-bold text-white/50 uppercase mb-4">Recent Certificates ({stats?.certificates?.length || 0})</h3>
                            <div className="bg-[#0a0a0a] rounded-xl border border-white/10 overflow-x-auto overflow-hidden">
                                <table className="w-full text-left text-sm min-w-[400px]">
                                    <thead className="bg-gray-200 text-white/50 uppercase text-xs">
                                        <tr>
                                            <th className="p-3 sm:p-4">Name</th>
                                            <th className="p-3 sm:p-4">Grade</th>
                                            <th className="p-3 sm:p-4">Scanned</th>
                                            <th className="p-3 sm:p-4">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/10 text-white/80">
                                        {stats?.certificates?.map((cert: any, i: number) => (
                                            <tr key={i} className="hover:bg-[#0a0a0a]">
                                                <td className="p-3 sm:p-4">
                                                    <div className="font-bold">{cert.name}</div>
                                                    <div className="text-[10px] text-white/40">Owner: {cert.owner_name || 'Guest'}</div>
                                                </td>
                                                <td className="p-3 sm:p-4 text-poke-gold font-bold">{cert.overall_grade}</td>
                                                <td className="p-3 sm:p-4 text-white/40 text-xs">{new Date(cert.date_scanned).toLocaleDateString()}</td>
                                                <td className="p-3 sm:p-4">
                                                    <div className="flex gap-2 flex-wrap">
                                                        <button
                                                            onClick={() => setReassigningCert(cert)}
                                                            className="bg-blue-900/50 hover:bg-blue-900 text-blue-300 px-3 py-1 rounded text-xs font-bold transition-colors"
                                                        >
                                                            Re-assign
                                                        </button>
                                                        <button
                                                            onClick={() => deleteCert(cert.id)}
                                                            className="bg-red-900/50 hover:bg-red-900 text-red-300 px-3 py-1 rounded text-xs font-bold transition-colors"
                                                        >
                                                            Delete
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    ) : activeTab === 'settings' ? (
                        <div className="space-y-6">
                            <div className="bg-[#050505] rounded-xl p-4 sm:p-6 lg:p-8 border border-white/10 shadow-lg">
                                <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                                    <i className="fas fa-sync-alt text-poke-blue"></i> Site cache
                                </h3>
                                <p className="text-sm text-white/50 mb-4">
                                    After deploying updates, bump the cache version so visitors get the new build on their next load without clearing browser cache.
                                </p>
                                <button
                                    onClick={flushCache}
                                    disabled={loading}
                                    className="bg-poke-blue hover:bg-blue-700 disabled:opacity-50 text-white px-6 py-3 rounded-lg font-bold shadow-lg flex items-center gap-2"
                                >
                                    <i className={`fas ${loading ? 'fa-spinner fa-spin' : 'fa-broom'}`}></i>
                                    Flush cache (bump version)
                                </button>
                            </div>
                            <div className="bg-[#050505] rounded-xl p-4 sm:p-6 lg:p-8 border border-white/10 shadow-lg">
                                <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                                    <i className="fas fa-key text-poke-gold"></i> Gemini AI API Key
                                </h3>
                                <p className="text-sm text-white/50 mb-6">
                                    Configure the API key used for AI-powered card grading. The system will use this key stored in the database, falling back to environment variables if unavailable.
                                </p>

                                <div className="space-y-4">
                                    {/* remove.bg API key (written via SQL Sync) */}
                                    <div>
                                        <label className="block text-xs font-bold text-white/50 uppercase mb-2">
                                            remove.bg API Key (for background removal preview)
                                        </label>
                                        <input
                                            type={showApiKey ? 'text' : 'password'}
                                            value={removeBgApiKey}
                                            onChange={(e) => setRemoveBgApiKey(e.target.value)}
                                            placeholder="Enter remove.bg API key..."
                                            className="w-full bg-[#050505] border border-white/20 rounded-lg px-4 py-3 text-white font-mono text-sm focus:outline-none focus:border-[#D4AF37]"
                                        />
                                        <p className="text-[10px] text-white/30 mt-2 leading-relaxed">
                                            Click save to run SQL Sync and persist the key.
                                        </p>
                                        <button
                                            onClick={() => syncDb({ setRemoveBgOnly: true })}
                                            disabled={loading || !removeBgApiKey}
                                            className="mt-3 w-full bg-[#990000] hover:bg-[#660000] disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-3 rounded-lg font-bold transition-all shadow-lg flex items-center justify-center gap-2"
                                        >
                                            <i className="fas fa-save"></i> Save remove.bg API Key
                                        </button>
                                    </div>

                                    {/* API Key Input */}
                                    <div>
                                        <label className="block text-xs font-bold text-white/50 uppercase mb-2">
                                            API Key
                                        </label>
                                        <div className="flex gap-2">
                                            <div className="flex-1 relative">
                                                <input
                                                    type={showApiKey ? 'text' : 'password'}
                                                    value={apiKey}
                                                    onChange={(e) => setApiKey(e.target.value)}
                                                    placeholder="Enter Gemini API Key..."
                                                    className="w-full bg-[#050505] border border-white/20 rounded-lg px-4 py-3 text-white font-mono text-sm focus:outline-none focus:border-[#D4AF37]"
                                                />
                                            </div>
                                            <button
                                                onClick={() => setShowApiKey(!showApiKey)}
                                                className="bg-[#0a0a0a] hover:bg-gray-200 text-white/80 px-4 py-3 rounded-lg transition-colors"
                                                title={showApiKey ? 'Hide' : 'Show'}
                                            >
                                                <i className={`fas fa-eye${showApiKey ? '-slash' : ''}`}></i>
                                            </button>
                                        </div>
                                    </div>

                                    {/* Action Buttons */}
                                    <div className="flex gap-3">
                                        <button
                                            onClick={saveApiKey}
                                            disabled={apiKeyStatus !== 'idle' || !apiKey}
                                            className="bg-poke-accent hover:bg-red-600 disabled:bg-gray-200 disabled:cursor-not-allowed text-white px-6 py-3 rounded-lg font-bold transition-all shadow-lg flex items-center gap-2"
                                        >
                                            {apiKeyStatus === 'saving' ? (
                                                <React.Fragment><i className="fas fa-spin fa-spinner"></i> Saving...</React.Fragment>
                                            ) : (
                                                <React.Fragment><i className="fas fa-save"></i> Save API Key</React.Fragment>
                                            )}
                                        </button>
                                        <button
                                            onClick={testApiKey}
                                            disabled={apiKeyStatus !== 'idle'}
                                            className="bg-blue-600 hover:bg-blue-500 disabled:bg-gray-200 disabled:cursor-not-allowed text-white px-6 py-3 rounded-lg font-bold transition-all shadow-lg flex items-center gap-2"
                                        >
                                            {apiKeyStatus === 'testing' ? (
                                                <React.Fragment><i className="fas fa-spin fa-spinner"></i> Testing...</React.Fragment>
                                            ) : (
                                                <React.Fragment><i className="fas fa-vial"></i> Test Connection</React.Fragment>
                                            )}
                                        </button>
                                    </div>

                                    {/* Info Alert */}
                                    <div className="bg-blue-900/20 border border-blue-700/50 rounded-lg p-4 text-sm text-blue-300">
                                        <i className="fas fa-info-circle mr-2"></i>
                                        <strong>Note:</strong> After saving, the new API key will be used for all grading operations. Clear your browser cache if the old key is still being used.
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : activeTab === 'badges' ? (
                        <div className="space-y-6">
                            <div className="flex justify-between items-center">
                                <h3 className="text-sm font-bold text-white/50 uppercase">Badge System ({badges.length})</h3>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => syncAllBadges(false)}
                                        disabled={syncing}
                                        className="bg-poke-gold hover:bg-yellow-600 text-black px-3 py-2 rounded text-xs font-bold transition-all flex items-center gap-2"
                                        title="Only awards new badges, does not remove existing ones"
                                    >
                                        <i className={`fas ${syncing ? 'fa-spinner fa-spin' : 'fa-sync-alt'}`}></i>
                                        {syncing ? 'Syncing...' : 'Sync (Award Only)'}
                                    </button>
                                    <button
                                        onClick={() => syncAllBadges(true)}
                                        disabled={syncing}
                                        className="bg-red-900/50 hover:bg-red-800 border border-red-500/30 text-red-200 px-3 py-2 rounded text-xs font-bold transition-all flex items-center gap-2"
                                        title="Awards new badges AND removes unearned ones"
                                    >
                                        <i className={`fas ${syncing ? 'fa-spinner fa-spin' : 'fa-exclamation-triangle'}`}></i>
                                        Sync & Revoke
                                    </button>
                                    <button
                                        onClick={() => openBadgeModal()}
                                        className="bg-[#D4AF37] hover:bg-[#E5C158] text-black shadow-[0_0_15px_rgba(212,175,55,0.2)] px-4 py-2 rounded text-xs font-bold transition-all flex items-center gap-2"
                                    >
                                        <i className="fas fa-plus"></i> Create Badge
                                    </button>
                                </div>
                            </div>

                            <div className="bg-muted/30 rounded-xl border border-silver overflow-hidden">
                                <table className="w-full text-left text-sm">
                                    <thead className="bg-muted/50 text-white/50 uppercase text-xs">
                                        <tr>
                                            <th className="p-4">Badge</th>
                                            <th className="p-4">Rank</th>
                                            <th className="p-4">Requirements</th>
                                            <th className="p-4">Bonus Scans</th>
                                            <th className="p-4">Earned By</th>
                                            <th className="p-4 text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-silver text-white/80">
                                        {badges.map((bdg, i) => (
                                            <tr key={i} className="hover:bg-muted/30">
                                                <td className="p-4">
                                                    <div className="flex items-center gap-3">
                                                        {bdg.icon_url ? (
                                                            <img src={bdg.icon_url} alt={bdg.name} className="w-8 h-8 rounded" />
                                                        ) : (
                                                            <div className="w-8 h-8 bg-poke-gold rounded flex items-center justify-center">
                                                                <i className="fas fa-medal text-black"></i>
                                                            </div>
                                                        )}
                                                        <div>
                                                            <div className="font-bold text-white">{bdg.name}</div>
                                                            {bdg.description && <div className="text-[10px] text-white/40">{bdg.description}</div>}
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="p-4">
                                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${bdg.rank_level === 'Master' ? 'bg-purple-900/30 text-purple-400 border border-purple-500/20' :
                                                        bdg.rank_level === 'Leader' ? 'bg-blue-100 text-blue-700 border border-blue-300' :
                                                            'bg-green-100 text-green-700 border border-green-300'
                                                        }`}>
                                                        {bdg.rank_level}
                                                    </span>
                                                </td>
                                                <td className="p-4 text-xs">
                                                    {bdg.requirements && bdg.requirements.length > 0 ? (
                                                        bdg.requirements.map((req: any, ri: number) => {
                                                            const opText: Record<string, string> = {
                                                                '>=': 'at least',
                                                                '>': 'more than',
                                                                '=': 'exactly',
                                                                '<': 'less than',
                                                                '<=': 'at most',
                                                                '!=': 'not'
                                                            };
                                                            return (
                                                                <div key={ri} className="text-white/50">
                                                                    {req.requirement_type.replace('_', ' ')} <span className="text-poke-gold">{opText[req.operator] || req.operator}</span> {req.required_value}
                                                                </div>
                                                            );
                                                        })
                                                    ) : (
                                                        <span className="text-white/50">No requirements</span>
                                                    )}
                                                </td>
                                                <td className="p-4">
                                                    <span className="text-poke-gold font-black">+{bdg.bonus_scans || 0}</span>
                                                </td>
                                                <td className="p-4">
                                                    <span className="text-white/40">{bdg.user_count || 0} users</span>
                                                </td>
                                                <td className="p-4 text-right">
                                                    <div className="flex justify-end gap-2">
                                                        <button
                                                            onClick={() => openBadgeModal(bdg)}
                                                            className="p-2 text-white/40 hover:text-[#D4AF37] transition-colors"
                                                            title="Edit Badge"
                                                        >
                                                            <i className="fas fa-edit"></i>
                                                        </button>
                                                        <button
                                                            onClick={() => deleteBadge(bdg.id)}
                                                            className="p-2 text-white/40 hover:text-red-600 transition-colors"
                                                            title="Delete Badge"
                                                        >
                                                            <i className="fas fa-trash-alt"></i>
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    ) : activeTab === 'ownership' ? (
                        <div className="space-y-6">
                            <div className="bg-[#050505] rounded-xl p-8 border border-silver shadow-lg relative overflow-hidden">
                                <div className="absolute top-0 right-0 p-32 bg-purple-500/5 rounded-full blur-3xl pointer-events-none"></div>

                                <div className="relative z-10">
                                    <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                                        <i className="fas fa-user-friends text-purple-400"></i> Certificate Ownership Transfer
                                    </h3>
                                    <p className="text-sm text-white/50 mb-8 max-w-2xl">
                                        Bulk transfer certificates between users. Useful for correcting scans that were attributed to the wrong account or reclaiming certificates that belong to you.
                                    </p>

                                    <div className="bg-muted/30 p-6 rounded-xl border border-silver mb-8">
                                        <h4 className="text-xs font-black text-white/40 uppercase tracking-widest mb-4">Quick Action for Gato</h4>
                                        <div className="flex flex-col md:flex-row items-center gap-4">
                                            <div className="flex-1 text-sm text-white/80">
                                                Move all current certificates from <strong>NyteWolf22</strong> to your admin account.
                                            </div>
                                            <button
                                                onClick={() => {
                                                    // Find NyteWolf22 in users list if possible, but user says he has low ID
                                                    // I'll allow them to enter the ID manually or use a common default
                                                    const nyteId = users.find(u => u.username.toLowerCase().includes('nyte'))?.id;
                                                    if (nyteId) handleClaimCerts(nyteId);
                                                    else {
                                                        const manualId = prompt("Enter NyteWolf22's User ID:");
                                                        if (manualId) handleClaimCerts(parseInt(manualId));
                                                    }
                                                }}
                                                className="bg-purple-600 hover:bg-purple-500 text-white px-6 py-3 rounded-lg font-black text-xs uppercase tracking-widest transition-all shadow-lg"
                                            >
                                                Claim NyteWolf's Scans
                                            </button>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
                                        <div className="space-y-3">
                                            <label className="text-[10px] font-black text-white/40 uppercase tracking-widest block">Source User (Losing Certs)</label>
                                            <select
                                                onChange={(e) => setOwnershipFrom(parseInt(e.target.value))}
                                                className="w-full bg-[#050505] border border-silver p-4 rounded-xl text-white outline-none focus:border-[#D4AF37]"
                                            >
                                                <option value="">Select source user...</option>
                                                {users.map(u => (
                                                    <option key={u.id} value={u.id}>{u.username} (ID: {u.id})</option>
                                                ))}
                                            </select>
                                        </div>

                                        <div className="space-y-3">
                                            <label className="text-[10px] font-black text-white/40 uppercase tracking-widest block">Destination User (Gaining Certs)</label>
                                            <select
                                                onChange={(e) => setOwnershipTo(parseInt(e.target.value))}
                                                className="w-full bg-[#050505] border border-silver p-4 rounded-xl text-white outline-none focus:border-[#D4AF37]"
                                            >
                                                <option value="">Select destination user...</option>
                                                {users.map(u => (
                                                    <option key={u.id} value={u.id}>{u.username} (ID: {u.id})</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>

                                    <button
                                        onClick={handleBulkTransfer}
                                        disabled={loading || !ownershipFrom || !ownershipTo}
                                        className="w-full bg-[#D4AF37] hover:bg-[#E5C158] text-black shadow-[0_0_15px_rgba(212,175,55,0.2)] py-4 rounded-xl font-black text-sm uppercase tracking-widest transition-all shadow-xl disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
                                    >
                                        <i className={`fas ${loading ? 'fa-spinner fa-spin' : 'fa-exchange-alt'}`}></i>
                                        Execute Bulk Transfer
                                    </button>
                                </div>
                            </div>
                        </div>
                    ) : activeTab === 'shop' ? (
                        <div className="space-y-8 pb-10">
                            {/* Stripe Settings Section */}
                            <div className="bg-[#050505] rounded-xl p-8 border border-silver shadow-lg">
                                <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                                    <i className="fab fa-stripe text-[#635bff] text-2xl"></i> Stripe API Configuration
                                </h3>
                                <p className="text-sm text-white/50 mb-6">
                                    Enter your Stripe credentials to enable payments. Use <strong>test keys</strong> first to verify the flow.
                                </p>

                                <div className="space-y-4 max-w-2xl">
                                    <div>
                                        <label className="block text-[10px] font-bold text-white/50 uppercase mb-2">Publishable Key</label>
                                        <input
                                            type="text"
                                            value={stripePubKey}
                                            onChange={(e) => setStripePubKey(e.target.value)}
                                            placeholder="pk_test_..."
                                            className="w-full bg-[#050505] border border-silver rounded-lg px-4 py-2 text-white font-mono text-sm focus:border-[#D4AF37] outline-none"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold text-white/50 uppercase mb-2">Secret Key</label>
                                        <input
                                            type="password"
                                            value={stripePrivKey}
                                            onChange={(e) => setStripePrivKey(e.target.value)}
                                            placeholder="sk_test_..."
                                            className="w-full bg-[#050505] border border-silver rounded-lg px-4 py-2 text-white font-mono text-sm focus:border-[#D4AF37] outline-none"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold text-white/50 uppercase mb-2">Webhook Secret</label>
                                        <input
                                            type="password"
                                            value={stripeWebhookSecret}
                                            onChange={(e) => setStripeWebhookSecret(e.target.value)}
                                            placeholder="whsec_..."
                                            className="w-full bg-[#050505] border border-silver rounded-lg px-4 py-2 text-white font-mono text-sm focus:border-[#D4AF37] outline-none"
                                        />
                                    </div>

                                    <button
                                        onClick={() => saveSettings({
                                            stripe_publishable_key: stripePubKey,
                                            stripe_secret_key: stripePrivKey,
                                            stripe_webhook_secret: stripeWebhookSecret
                                        })}
                                        className="bg-[#635bff] hover:bg-[#4b44d3] text-white px-6 py-2 rounded-lg font-bold transition-all shadow-md flex items-center gap-2"
                                    >
                                        <i className="fas fa-save"></i> Save Stripe Keys
                                    </button>
                                </div>
                            </div>

                            {/* Recurring membership plans (Stripe Price IDs, day-based recurring) */}
                            <div className="bg-[#050505] rounded-xl p-8 border border-silver shadow-lg">
                                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-4">
                                    <div>
                                        <h3 className="text-lg font-bold text-white mb-2">Recurring membership plans</h3>
                                        <p className="text-sm text-white/50 max-w-2xl">
                                            In Stripe Dashboard create a <strong className="text-white/70">recurring</strong> Price with billing period{' '}
                                            <code className="text-white/70">day</code> and <code className="text-white/70">interval_count</code> equal to the number below (1–365).
                                            You can add multiple plans at the same cadence (for example two different 30-day tiers). Run <code className="text-white/60">sync_db</code> once if upgrades fail with a duplicate-key error on <code className="text-white/60">interval_days</code>.
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={addSubscriptionPlanDraft}
                                        className="shrink-0 bg-[#D4AF37] hover:bg-[#E5C158] text-black px-4 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-2"
                                    >
                                        <i className="fas fa-plus-circle"></i> Add plan
                                    </button>
                                </div>
                                <div className="space-y-4">
                                    {subscriptionPlans.length === 0 ? (
                                        <p className="text-sm text-white/40 py-6">No plans yet. Click Add plan or run database sync to seed defaults.</p>
                                    ) : (
                                        subscriptionPlans.map((plan) => {
                                            const presetVal = (SUBSCRIPTION_INTERVAL_PRESETS as readonly number[]).includes(plan.interval_days)
                                                ? String(plan.interval_days)
                                                : 'custom';
                                            return (
                                                <div key={plan.id} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end bg-black/30 p-4 rounded border border-white/10">
                                                    <div className="md:col-span-2">
                                                        <label className="text-[10px] text-white/50 uppercase">Label</label>
                                                        <input
                                                            className="w-full bg-[#050505] border border-silver rounded px-2 py-1 text-white text-sm"
                                                            value={plan.label}
                                                            onChange={(e) => setSubscriptionPlans((prev) => prev.map((p) => (p.id === plan.id ? { ...p, label: e.target.value } : p)))}
                                                        />
                                                    </div>
                                                    <div className="md:col-span-2">
                                                        <label className="text-[10px] text-white/50 uppercase">Billing every (days)</label>
                                                        <div className="flex gap-2">
                                                            <select
                                                                className="flex-1 min-w-0 bg-[#050505] border border-silver rounded px-2 py-1 text-white text-xs"
                                                                value={presetVal}
                                                                onChange={(e) => {
                                                                    const v = e.target.value;
                                                                    setSubscriptionPlans((prev) =>
                                                                        prev.map((p) =>
                                                                            p.id === plan.id
                                                                                ? {
                                                                                      ...p,
                                                                                      interval_days:
                                                                                          v === 'custom'
                                                                                              ? Math.min(365, Math.max(1, p.interval_days || 1))
                                                                                              : parseInt(v, 10),
                                                                                  }
                                                                                : p
                                                                        )
                                                                    );
                                                                }}
                                                            >
                                                                {SUBSCRIPTION_INTERVAL_PRESETS.map((d) => (
                                                                    <option key={d} value={d}>
                                                                        {d} days
                                                                    </option>
                                                                ))}
                                                                <option value="custom">Custom…</option>
                                                            </select>
                                                            <input
                                                                type="number"
                                                                min={1}
                                                                max={365}
                                                                className="w-16 bg-[#050505] border border-silver rounded px-1 py-1 text-white text-xs font-mono"
                                                                value={plan.interval_days ?? ''}
                                                                disabled={presetVal !== 'custom'}
                                                                title={presetVal === 'custom' ? '1–365' : 'Pick Custom to edit'}
                                                                onChange={(e) =>
                                                                    setSubscriptionPlans((prev) =>
                                                                        prev.map((p) =>
                                                                            p.id === plan.id
                                                                                ? { ...p, interval_days: Math.min(365, Math.max(1, parseInt(e.target.value, 10) || 1)) }
                                                                                : p
                                                                        )
                                                                    )
                                                                }
                                                            />
                                                        </div>
                                                    </div>
                                                    <div className="md:col-span-2">
                                                        <label className="text-[10px] text-white/50 uppercase">Stripe price id</label>
                                                        <input
                                                            className="w-full bg-[#050505] border border-silver rounded px-2 py-1 text-white text-xs font-mono"
                                                            value={plan.stripe_price_id || ''}
                                                            onChange={(e) => setSubscriptionPlans((prev) => prev.map((p) => (p.id === plan.id ? { ...p, stripe_price_id: e.target.value } : p)))}
                                                            placeholder="price_..."
                                                        />
                                                    </div>
                                                    <div className="md:col-span-1">
                                                        <label className="text-[10px] text-white/50 uppercase">¢</label>
                                                        <input
                                                            type="number"
                                                            min={0}
                                                            className="w-full bg-[#050505] border border-silver rounded px-2 py-1 text-white text-sm"
                                                            value={plan.amount_cents ?? ''}
                                                            onChange={(e) => setSubscriptionPlans((prev) => prev.map((p) => (p.id === plan.id ? { ...p, amount_cents: parseInt(e.target.value, 10) || 0 } : p)))}
                                                        />
                                                    </div>
                                                    <div className="md:col-span-1">
                                                        <label className="text-[10px] text-white/50 uppercase">CCY</label>
                                                        <input
                                                            maxLength={3}
                                                            className="w-full bg-[#050505] border border-silver rounded px-2 py-1 text-white text-xs font-mono uppercase"
                                                            value={plan.currency || 'usd'}
                                                            onChange={(e) =>
                                                                setSubscriptionPlans((prev) =>
                                                                    prev.map((p) => (p.id === plan.id ? { ...p, currency: e.target.value.toLowerCase().replace(/[^a-z]/g, '').slice(0, 3) } : p))
                                                                )
                                                            }
                                                        />
                                                    </div>
                                                    <div className="md:col-span-1">
                                                        <label className="text-[10px] text-white/50 uppercase">Sort</label>
                                                        <input
                                                            type="number"
                                                            className="w-full bg-[#050505] border border-silver rounded px-2 py-1 text-white text-sm"
                                                            value={plan.sort_order ?? 0}
                                                            onChange={(e) =>
                                                                setSubscriptionPlans((prev) =>
                                                                    prev.map((p) => (p.id === plan.id ? { ...p, sort_order: parseInt(e.target.value, 10) || 0 } : p))
                                                                )
                                                            }
                                                        />
                                                    </div>
                                                    <div className="md:col-span-1 flex items-center gap-2 pb-1">
                                                        <input
                                                            type="checkbox"
                                                            checked={!!plan.active}
                                                            onChange={(e) => setSubscriptionPlans((prev) => prev.map((p) => (p.id === plan.id ? { ...p, active: e.target.checked ? 1 : 0 } : p)))}
                                                        />
                                                        <span className="text-xs text-white/60">Active</span>
                                                    </div>
                                                    <div className="md:col-span-2 flex flex-col gap-2">
                                                        <button
                                                            type="button"
                                                            onClick={() => void saveSubscriptionPlanRow(plan)}
                                                            className="w-full bg-[#D4AF37] text-black text-xs font-bold py-2 rounded"
                                                        >
                                                            {plan.id > 0 ? 'Save' : 'Create'}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => void deleteSubscriptionPlanRow(plan)}
                                                            className="w-full border border-white/15 text-white/60 hover:text-red-400 text-xs font-bold py-1.5 rounded"
                                                        >
                                                            {plan.id > 0 ? 'Delete' : 'Cancel'}
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            </div>

                            {/* Pack Manager Section */}
                            <div className="space-y-4">
                                <div className="flex justify-between items-center">
                                    <h3 className="text-sm font-bold text-white/50 uppercase">Scan Pack Manager ({scanPacks.length})</h3>
                                    <button
                                        onClick={() => openPackModal()}
                                        className="bg-[#D4AF37] hover:bg-[#E5C158] text-black shadow-[0_0_15px_rgba(212,175,55,0.2)] px-4 py-2 rounded text-xs font-bold flex items-center gap-2 transition-all"
                                    >
                                        <i className="fas fa-plus-circle"></i> Create New Pack
                                    </button>
                                </div>

                                <div className="bg-muted/30 rounded-xl border border-silver overflow-hidden">
                                    <table className="w-full text-left text-sm">
                                        <thead className="bg-muted/50 text-white/50 uppercase text-xs">
                                            <tr>
                                                <th className="p-4">Pack Name</th>
                                                <th className="p-4">Credits</th>
                                                <th className="p-4">Price</th>
                                                <th className="p-4 text-center">Status</th>
                                                <th className="p-4 text-right">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-silver text-white/80">
                                            {scanPacks.length > 0 ? scanPacks.map((p, i) => (
                                                <tr key={i} className="hover:bg-muted/30">
                                                    <td className="p-4">
                                                        <div className="font-bold text-white tracking-wide">{p.name}</div>
                                                        <div className="text-[10px] text-white/40 line-clamp-1">{p.description || 'No description'}</div>
                                                    </td>
                                                    <td className="p-4">
                                                        <span className="text-poke-gold font-black bg-poke-gold/10 px-2 py-0.5 rounded border border-poke-gold/20">
                                                            {p.credits} Scans
                                                        </span>
                                                    </td>
                                                    <td className="p-4">
                                                        <span className="text-white font-bold">${p.price} {p.currency}</span>
                                                    </td>
                                                    <td className="p-4 text-center">
                                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${p.active ? 'bg-green-100 text-green-700 border border-green-300' : 'bg-gray-900/50 text-white/40 border border-silver'}`}>
                                                            {p.active ? 'Active' : 'Hidden'}
                                                        </span>
                                                    </td>
                                                    <td className="p-4 text-right">
                                                        <div className="flex justify-end gap-2">
                                                            <button
                                                                onClick={() => openPackModal(p)}
                                                                className="p-2 text-white/40 hover:text-[#D4AF37] transition-colors"
                                                            >
                                                                <i className="fas fa-edit"></i>
                                                            </button>
                                                            <button
                                                                onClick={() => handleDeletePack(p.id)}
                                                                className="p-2 text-white/40 hover:text-red-600 transition-colors"
                                                            >
                                                                <i className="fas fa-trash-alt"></i>
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            )) : (
                                                <tr>
                                                    <td colSpan={5} className="p-8 text-center text-white/40 italic">
                                                        No scan packs defined yet.
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    ) : activeTab === 'disputes' ? (
                        <div className="space-y-6 pb-10">
                            <div className="flex justify-between items-center mb-4">
                                <div>
                                    <h3 className="text-xl font-bold text-white flex items-center gap-2">
                                        <i className="fas fa-gavel text-poke-gold"></i> Ownership Disputes ({disputes.length})
                                    </h3>
                                    <p className="text-xs text-white/50 mt-1">
                                        Review and resolve conflicting ownership claims for registered slabs.
                                    </p>
                                </div>
                                <button
                                    onClick={fetchDisputes}
                                    disabled={loading}
                                    className="bg-[#0a0a0a] hover:bg-white/5 text-white/80 px-4 py-2 rounded-lg text-xs font-bold transition-colors flex items-center gap-2 border border-white/10"
                                >
                                    <i className={`fas ${loading ? 'fa-spinner fa-spin' : 'fa-sync-alt'}`}></i> Refresh
                                </button>
                            </div>

                            {disputes.length > 0 ? (
                                <div className="bg-[#050505] rounded-xl border border-white/10 overflow-hidden shadow-lg">
                                    <table className="w-full text-left text-sm">
                                        <thead className="bg-[#0a0a0a] text-white/50 uppercase text-xs border-b border-white/5">
                                            <tr>
                                                <th className="p-4">Slab Details</th>
                                                <th className="p-4">Current Owner</th>
                                                <th className="p-4">Disputing Requester</th>
                                                <th className="p-4">Date Added</th>
                                                <th className="p-4 text-right">Action</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-white/10 text-white/80">
                                            {disputes.map((d, i) => (
                                                <tr key={i} className="hover:bg-white/5 transition-colors">
                                                    <td className="p-4">
                                                        <div className="font-bold text-white mb-1">{d.card_name}</div>
                                                        <div className="flex items-center gap-2 text-[10px] text-white/50">
                                                            <span className="font-mono text-poke-gold tracking-wider">{d.psa_serial}</span>
                                                            <span className="bg-white/10 px-1.5 py-0.5 rounded text-white/80">{d.grader}</span>
                                                        </div>
                                                    </td>
                                                    <td className="p-4">
                                                        <div className="flex items-center gap-2">
                                                            <div className="w-6 h-6 rounded-full bg-blue-900/50 flex items-center justify-center text-[10px] font-bold text-blue-300">
                                                                {d.current_owner ? d.current_owner.charAt(0).toUpperCase() : '?'}
                                                            </div>
                                                            <span className="font-bold">{d.current_owner || 'Unknown'}</span>
                                                        </div>
                                                        <div className="text-[10px] text-white/40 mt-1">ID: {d.current_owner_id}</div>
                                                    </td>
                                                    <td className="p-4">
                                                        <div className="flex items-center gap-2">
                                                            <div className="w-6 h-6 rounded-full bg-red-900/50 flex items-center justify-center text-[10px] font-bold text-red-300">
                                                                {d.requester ? d.requester.charAt(0).toUpperCase() : '?'}
                                                            </div>
                                                            <span className="font-bold">{d.requester || 'Unknown'}</span>
                                                        </div>
                                                        <div className="text-[10px] text-white/40 mt-1">ID: {d.transfer_requested_by}</div>
                                                    </td>
                                                    <td className="p-4 text-white/50 text-xs">
                                                        {new Date(d.added_at).toLocaleString()}
                                                    </td>
                                                    <td className="p-4 text-right">
                                                        <div className="flex flex-col gap-2 items-end">
                                                            <button
                                                                onClick={() => resolveDispute(d.slab_id, 'award_requester')}
                                                                className="bg-green-600/20 hover:bg-green-600/40 text-green-400 border border-green-500/30 px-3 py-1.5 rounded text-[10px] font-bold uppercase transition-colors whitespace-nowrap"
                                                            >
                                                                <i className="fas fa-check mr-1"></i> Award to Requester
                                                            </button>
                                                            <button
                                                                onClick={() => resolveDispute(d.slab_id, 'keep_owner')}
                                                                className="bg-red-600/20 hover:bg-red-600/40 text-red-400 border border-red-500/30 px-3 py-1.5 rounded text-[10px] font-bold uppercase transition-colors whitespace-nowrap"
                                                            >
                                                                <i className="fas fa-times mr-1"></i> Keep Current Owner
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <div className="bg-[#050505] rounded-xl border border-white/10 p-12 text-center shadow-lg">
                                    <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-4 border border-white/10">
                                        <i className="fas fa-check-circle text-2xl text-green-500"></i>
                                    </div>
                                    <h4 className="text-white font-bold mb-2">No Active Disputes</h4>
                                    <p className="text-sm text-white/40 max-w-sm mx-auto">
                                        All ownership transfers are settled. There are currently no conflicting claims requiring admin intervention.
                                    </p>
                                </div>
                            )}
                        </div>
                    ) : null}

                </div>
            </div>

            {/* Re-assign Certificate Modal */}
            {
                reassigningCert && (
                    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm animate-fade-in">
                        <div className="bg-[#050505] w-full max-w-md rounded-2xl border border-silver shadow-2xl overflow-hidden">
                            <div className="p-6 border-b border-gray-700 flex justify-between items-center">
                                <h3 className="text-xl font-bold text-white">Re-assign Certificate</h3>
                                <button onClick={() => setReassigningCert(null)} className="text-white/40 hover:text-white">
                                    <i className="fas fa-times text-xl"></i>
                                </button>
                            </div>
                            <div className="p-8 space-y-6">
                                <div className="text-white/80 text-sm">
                                    Re-assigning <span className="text-poke-gold font-bold">{reassigningCert.name}</span> to a new owner.
                                </div>

                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold text-white/50 uppercase">Select New Owner</label>
                                    <select
                                        className="w-full bg-[#050505] border border-silver p-3 rounded-lg text-white text-sm focus:border-[#D4AF37] outline-none"
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            if (val) reassignCert(reassigningCert.id, parseInt(val));
                                        }}
                                        defaultValue=""
                                    >
                                        <option value="" disabled>Choose a user...</option>
                                        {users.map(u => (
                                            <option key={u.id} value={u.id}>{u.username} ({u.email})</option>
                                        ))}
                                    </select>
                                </div>

                                <p className="text-[10px] text-white/40 italic">
                                    Note: This will move the certificate to the selected user's "My Vault".
                                </p>

                                <button
                                    onClick={() => setReassigningCert(null)}
                                    className="w-full bg-muted/50 hover:bg-gray-200 text-white py-3 rounded-lg font-bold transition-all"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* User Create/Edit Modal */}
            {
                showUserModal && (
                    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm animate-fade-in">
                        <div className="bg-[#050505] w-full max-w-lg rounded-2xl border border-silver shadow-2xl overflow-hidden">
                            <div className="p-6 border-b border-gray-700 flex justify-between items-center">
                                <h3 className="text-xl font-bold text-white">
                                    {editingUser ? `Edit User: ${editingUser.username}` : 'Create New User'}
                                </h3>
                                <button onClick={() => setShowUserModal(false)} className="text-white/40 hover:text-white">
                                    <i className="fas fa-times text-xl"></i>
                                </button>
                            </div>
                            <div className="p-8 space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-bold text-white/50 uppercase">Username</label>
                                        <input
                                            type="text"
                                            value={userFormData.username}
                                            onChange={(e) => setUserFormData({ ...userFormData, username: e.target.value })}
                                            className="w-full bg-[#050505] border border-silver p-3 rounded-lg text-white text-sm focus:border-[#D4AF37] outline-none"
                                            placeholder="johndoe"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-bold text-white/50 uppercase">Email Address</label>
                                        <input
                                            type="email"
                                            value={userFormData.email}
                                            onChange={(e) => setUserFormData({ ...userFormData, email: e.target.value })}
                                            className="w-full bg-[#050505] border border-silver p-3 rounded-lg text-white text-sm focus:border-[#D4AF37] outline-none"
                                            placeholder="john@example.com"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-1">
                                    <label className="text-[10px] font-bold text-white/50 uppercase">
                                        {editingUser ? 'New Password (leave blank to keep current)' : 'Password'}
                                    </label>
                                    <input
                                        type="password"
                                        value={userFormData.password}
                                        onChange={(e) => setUserFormData({ ...userFormData, password: e.target.value })}
                                        className="w-full bg-[#050505] border border-silver p-3 rounded-lg text-white text-sm focus:border-[#D4AF37] outline-none"
                                        placeholder="••••••••"
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-bold text-white/50 uppercase flex justify-between">
                                            Base Scan Limit
                                            <span className="text-[9px] text-white/50 font-normal">Default is 5</span>
                                        </label>
                                        <input
                                            type="number"
                                            value={userFormData.scan_limit}
                                            onChange={(e) => setUserFormData({ ...userFormData, scan_limit: parseInt(e.target.value) })}
                                            className="w-full bg-[#050505] border border-silver p-3 rounded-lg text-white text-sm focus:border-[#D4AF37] outline-none"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-bold text-poke-gold uppercase flex justify-between">
                                            Bonus Scans
                                            <span className="text-[9px] text-white/50 font-normal">Add/Subtract</span>
                                        </label>
                                        <input
                                            type="number"
                                            value={userFormData.bonus_scans}
                                            onChange={(e) => setUserFormData({ ...userFormData, bonus_scans: parseInt(e.target.value) })}
                                            className="w-full bg-[#050505] border border-silver p-3 rounded-lg text-poke-gold font-black text-sm focus:border-[#D4AF37] outline-none"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-bold text-[#D4AF37] uppercase flex justify-between">
                                            Pro Credits
                                            <span className="text-[9px] text-white/50 font-normal">Paid balance</span>
                                        </label>
                                        <input
                                            type="number"
                                            min={0}
                                            value={userFormData.paid_credits}
                                            onChange={(e) => setUserFormData({ ...userFormData, paid_credits: Math.max(0, parseInt(e.target.value) || 0) })}
                                            className="w-full bg-[#050505] border border-silver p-3 rounded-lg text-[#D4AF37] font-black text-sm focus:border-[#D4AF37] outline-none"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-1">
                                    <label className="text-[10px] font-bold text-white/50 uppercase">X (Twitter) Username</label>
                                    <div className="relative">
                                        <span className="absolute left-3 top-3.5 text-white/50">@</span>
                                        <input
                                            type="text"
                                            value={userFormData.x_username}
                                            onChange={(e) => setUserFormData({ ...userFormData, x_username: e.target.value })}
                                            className="w-full bg-[#050505] border border-silver p-3 pl-8 rounded-lg text-white text-sm focus:border-[#D4AF37] outline-none"
                                            placeholder="handle"
                                        />
                                    </div>
                                </div>

                                {editingUser && (
                                    <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg border border-white/10 bg-white/5">
                                        <input
                                            type="checkbox"
                                            checked={userFormData.vip_lifetime === 1}
                                            onChange={(e) => setUserFormData({ ...userFormData, vip_lifetime: e.target.checked ? 1 : 0 })}
                                            className="mt-1 w-5 h-5 accent-amber-500 shrink-0"
                                        />
                                        <span>
                                            <span className="text-sm font-bold text-amber-200/90 block">Lifetime VIP (free platform access)</span>
                                            <span className="text-[11px] text-white/45">When enabled, this user bypasses trial and subscription gates. Uncheck to apply normal membership rules again.</span>
                                        </span>
                                    </label>
                                )}

                                <div className="pt-4 flex gap-3">
                                    <button
                                        onClick={() => setShowUserModal(false)}
                                        className="flex-1 bg-muted/50 hover:bg-gray-200 text-white py-3 rounded-lg font-bold transition-all"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={handleSaveUser}
                                        disabled={loading}
                                        className="flex-1 bg-[#D4AF37] hover:bg-[#E5C158] text-black shadow-[0_0_15px_rgba(212,175,55,0.2)] py-3 rounded-lg font-bold transition-all shadow-lg flex items-center justify-center gap-2"
                                    >
                                        {loading ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-check-circle"></i>}
                                        {editingUser ? 'Save Changes' : 'Create User'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Badge Modal */}
            {
                showBadgeModal && (
                    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
                        <div className="bg-[#050505] rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                            <div className="sticky top-0 bg-gradient-to-r from-poke-gold to-poke-accent p-6 flex justify-between items-center">
                                <h3 className="text-xl font-black text-white">
                                    {editingBadge ? 'Edit Badge' : 'Create Badge'}
                                </h3>
                                <button
                                    onClick={() => setShowBadgeModal(false)}
                                    className="text-white/80 hover:text-white text-2xl"
                                >
                                    <i className="fas fa-times"></i>
                                </button>
                            </div>
                            <div className="p-8 space-y-6">
                                {/* Basic Info */}
                                <div className="space-y-4">
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-bold text-white/50 uppercase">Badge Name</label>
                                        <input
                                            type="text"
                                            value={badgeFormData.name}
                                            onChange={(e) => setBadgeFormData({ ...badgeFormData, name: e.target.value })}
                                            className="w-full bg-[#050505] border border-silver p-3 rounded-lg text-white text-sm focus:border-[#D4AF37] outline-none"
                                            placeholder="First Scan"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-bold text-white/50 uppercase">Description</label>
                                        <textarea
                                            value={badgeFormData.description}
                                            onChange={(e) => setBadgeFormData({ ...badgeFormData, description: e.target.value })}
                                            className="w-full bg-[#050505] border border-silver p-3 rounded-lg text-white text-sm focus:border-[#D4AF37] outline-none"
                                            placeholder="Awarded for your first card scan"
                                            rows={2}
                                        />
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-1">
                                            <label className="text-[10px] font-bold text-white/50 uppercase">Icon Image</label>
                                            <div className="flex gap-4 items-start">
                                                <div className="flex-1 space-y-2">
                                                    <div className="relative">
                                                        <input
                                                            type="text"
                                                            value={badgeFormData.icon_url}
                                                            onChange={(e) => setBadgeFormData({ ...badgeFormData, icon_url: e.target.value })}
                                                            className="w-full bg-[#050505] border border-silver p-3 rounded-lg text-white text-sm focus:border-[#D4AF37] outline-none pr-20"
                                                            placeholder="https://..."
                                                        />
                                                        <div className="absolute right-1 top-1 bottom-1 flex items-center">
                                                            <label htmlFor="badge-icon-upload" className="cursor-pointer bg-gray-600 hover:bg-[#080808]0 text-white text-[10px] uppercase font-bold px-3 py-1.5 rounded flex items-center gap-1 transition-colors h-full">
                                                                <i className="fas fa-upload"></i> Upload
                                                            </label>
                                                            <input
                                                                id="badge-icon-upload"
                                                                type="file"
                                                                accept="image/*"
                                                                className="hidden"
                                                                onChange={handleBadgeIconUpload}
                                                            />
                                                        </div>
                                                    </div>
                                                    <p className="text-[10px] text-white/40">Supported: JPG, PNG, GIF, WEBP (Max 2MB)</p>
                                                </div>
                                                {badgeFormData.icon_url && (
                                                    <div className="w-[46px] h-[46px] bg-[#050505] rounded-lg border border-silver flex items-center justify-center overflow-hidden flex-shrink-0">
                                                        <img src={badgeFormData.icon_url} alt="Preview" className="w-full h-full object-contain" />
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-[10px] font-bold text-white/50 uppercase">Rank Level</label>
                                            <select
                                                value={badgeFormData.rank_level}
                                                onChange={(e) => setBadgeFormData({ ...badgeFormData, rank_level: e.target.value })}
                                                className="w-full bg-[#050505] border border-silver p-3 rounded-lg text-white text-sm focus:border-[#D4AF37] outline-none"
                                            >
                                                <option value="Trainer">Trainer</option>
                                                <option value="Leader">Leader</option>
                                                <option value="Master">Master</option>
                                            </select>
                                        </div>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-bold text-white/50 uppercase">Bonus Scans</label>
                                        <input
                                            type="number"
                                            value={badgeFormData.bonus_scans}
                                            onChange={(e) => setBadgeFormData({ ...badgeFormData, bonus_scans: parseInt(e.target.value) || 0 })}
                                            className="w-full bg-[#050505] border border-silver p-3 rounded-lg text-white text-sm focus:border-[#D4AF37] outline-none"
                                            placeholder="5"
                                        />
                                    </div>
                                </div>

                                {/* Requirements */}
                                <div className="space-y-3">
                                    <div className="flex justify-between items-center">
                                        <label className="text-[10px] font-bold text-white/50 uppercase">Requirements</label>
                                        <button
                                            onClick={() => setBadgeFormData({
                                                ...badgeFormData,
                                                requirements: [...badgeFormData.requirements, { requirement_type: 'total_scans', operator: '>=', required_value: 1 }]
                                            })}
                                            className="text-[#D4AF37] text-xs font-bold hover:text-poke-gold"
                                        >
                                            <i className="fas fa-plus mr-1"></i> Add Requirement
                                        </button>
                                    </div>
                                    {badgeFormData.requirements.map((req, idx) => (
                                        <div key={idx} className="bg-[#050505] border border-silver p-4 rounded-lg space-y-2">
                                            <div className="grid grid-cols-3 gap-2">
                                                <select
                                                    value={req.requirement_type}
                                                    onChange={(e) => {
                                                        const newReqs = [...badgeFormData.requirements];
                                                        newReqs[idx].requirement_type = e.target.value;
                                                        // Reset value when changing type to prevent type mismatch
                                                        newReqs[idx].required_value = e.target.value === 'signup_date' ? '' : 0;
                                                        setBadgeFormData({ ...badgeFormData, requirements: newReqs });
                                                    }}
                                                    className="bg-[#050505] border border-silver p-2 rounded text-white text-xs"
                                                >
                                                    <option value="total_scans">Total Scans</option>
                                                    <option value="current_streak">Current Streak (Days)</option>
                                                    <option value="unique_sets">Distinct Sets Scanned</option>
                                                    <option value="total_value">Total Portfolio Value</option>
                                                    <option value="total_investment">Total Investment</option>
                                                    <option value="category_count">Scans in Category (e.g. Yu-Gi-Oh)</option>
                                                    <option value="set_count">Scans in Set (e.g. Jungle)</option>
                                                    <option value="character_count">Scans of Character (e.g. Pikachu)</option>
                                                    <option value="year_count">Scans from Year (e.g. 1999)</option>
                                                </select>

                                                {/* Target Logic for Specific Counts */}
                                                {['category_count', 'set_count', 'character_count', 'year_count', 'artist_count'].includes(req.requirement_type) && (
                                                    <div className="mt-2 bg-poke-dark p-2 rounded border border-[#D4AF37]/30 animate-fade-in">
                                                        <label className="text-[10px] text-poke-gold uppercase font-bold block mb-1">
                                                            Target Criteria (Exact or Partial Match)
                                                        </label>
                                                        <input
                                                            type="text"
                                                            className="w-full bg-[#050505] border border-silver rounded p-1 text-white text-xs"
                                                            placeholder={
                                                                req.requirement_type === 'category_count' ? "e.g. Yu-Gi-Oh" :
                                                                    req.requirement_type === 'set_count' ? "e.g. Jungle" :
                                                                        req.requirement_type === 'character_count' ? "e.g. Pikachu" :
                                                                            req.requirement_type === 'year_count' ? "e.g. 1999" : "Search term..."
                                                            }
                                                            value={(req as any).target_criteria || ''}
                                                            onChange={(e) => {
                                                                const newReqs = [...badgeFormData.requirements];
                                                                (newReqs[idx] as any).target_criteria = e.target.value;
                                                                setBadgeFormData({ ...badgeFormData, requirements: newReqs });
                                                            }}
                                                        />
                                                    </div>
                                                )}
                                            </div>

                                            <div className="w-1/4">
                                                <select
                                                    value={req.operator}
                                                    onChange={(e) => {
                                                        const newReqs = [...badgeFormData.requirements];
                                                        newReqs[idx].operator = e.target.value;
                                                        setBadgeFormData({ ...badgeFormData, requirements: newReqs });
                                                    }}
                                                    className="bg-[#050505] border border-silver p-2 rounded text-white text-xs"
                                                >
                                                    <option value=">=">Greater Than or Equal (&ge;)</option>
                                                    <option value=">">Greater Than (&gt;)</option>
                                                    <option value="=">Equal To (=)</option>
                                                    <option value="<">Less Than (&lt;)</option>
                                                    <option value="<=">Less Than or Equal (&le;)</option>
                                                    <option value="!=">Not Equal (!=)</option>
                                                </select>
                                                {req.requirement_type === 'signup_date' ? (
                                                    <input
                                                        type="date"
                                                        value={req.required_value}
                                                        onChange={(e) => {
                                                            const newReqs = [...badgeFormData.requirements];
                                                            newReqs[idx].required_value = e.target.value;
                                                            setBadgeFormData({ ...badgeFormData, requirements: newReqs });
                                                        }}
                                                        className="bg-[#050505] border border-silver p-2 rounded text-white text-xs"
                                                    />
                                                ) : (
                                                    <input
                                                        type="number"
                                                        value={req.required_value}
                                                        onChange={(e) => {
                                                            const newReqs = [...badgeFormData.requirements];
                                                            newReqs[idx].required_value = parseInt(e.target.value) || 0;
                                                            setBadgeFormData({ ...badgeFormData, requirements: newReqs });
                                                        }}
                                                        className="bg-[#050505] border border-silver p-2 rounded text-white text-xs"
                                                        placeholder="Value"
                                                    />
                                                )}
                                            </div>
                                            <button
                                                onClick={() => {
                                                    const newReqs = badgeFormData.requirements.filter((_, i) => i !== idx);
                                                    setBadgeFormData({ ...badgeFormData, requirements: newReqs });
                                                }}
                                                className="text-red-500 text-xs hover:text-red-400"
                                            >
                                                <i className="fas fa-trash-alt mr-1"></i> Remove
                                            </button>
                                        </div>
                                    ))}
                                    {badgeFormData.requirements.length === 0 && (
                                        <p className="text-white/40 text-xs text-center py-4">No requirements added. Badge will be awarded immediately.</p>
                                    )}
                                </div>

                                {/* Actions */}
                                <div className="flex gap-3 pt-4">
                                    <button
                                        onClick={() => setShowBadgeModal(false)}
                                        className="flex-1 bg-gray-600 hover:bg-[#080808]0 text-white py-3 rounded-lg font-bold transition-all"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={saveBadge}
                                        disabled={loading}
                                        className="flex-1 bg-[#D4AF37] hover:bg-[#E5C158] text-black shadow-[0_0_15px_rgba(212,175,55,0.2)] py-3 rounded-lg font-bold transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                                    >
                                        {loading ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-check-circle"></i>}
                                        {editingBadge ? 'Save Changes' : 'Create Badge'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Scan Pack Modal */}
            {
                showPackModal && (
                    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm animate-fade-in">
                        <div className="bg-[#050505] w-full max-w-lg rounded-2xl border border-silver shadow-2xl overflow-hidden">
                            <div className="p-6 border-b border-gray-700 flex justify-between items-center bg-gradient-to-r from-[#635bff] to-[#4b44d3]">
                                <h3 className="text-xl font-black text-white">
                                    {editingPack ? `Edit Pack: ${editingPack.name}` : 'Create New Scan Pack'}
                                </h3>
                                <button onClick={() => setShowPackModal(false)} className="text-white/80 hover:text-white">
                                    <i className="fas fa-times text-xl"></i>
                                </button>
                            </div>
                            <div className="p-8 space-y-4">
                                <div className="space-y-1">
                                    <label className="text-[10px] font-bold text-white/50 uppercase">Pack Name</label>
                                    <input
                                        type="text"
                                        value={packFormData.name}
                                        onChange={(e) => setPackFormData({ ...packFormData, name: e.target.value })}
                                        className="w-full bg-[#050505] border border-silver p-3 rounded-lg text-white text-sm focus:border-[#D4AF37] outline-none"
                                        placeholder="e.g. Starter Pack"
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-bold text-white/50 uppercase">Scan Credits</label>
                                        <input
                                            type="number"
                                            value={packFormData.credits}
                                            onChange={(e) => setPackFormData({ ...packFormData, credits: parseInt(e.target.value) })}
                                            className="w-full bg-[#050505] border border-silver p-3 rounded-lg text-white text-sm focus:border-[#D4AF37] outline-none"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-bold text-white/50 uppercase">Price ({packFormData.currency})</label>
                                        <input
                                            type="number"
                                            step="0.01"
                                            value={packFormData.price}
                                            onChange={(e) => setPackFormData({ ...packFormData, price: parseFloat(e.target.value) })}
                                            className="w-full bg-[#050505] border border-silver p-3 rounded-lg text-white text-sm focus:border-[#D4AF37] outline-none"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-1">
                                    <label className="text-[10px] font-bold text-white/50 uppercase">Description</label>
                                    <textarea
                                        value={packFormData.description}
                                        onChange={(e) => setPackFormData({ ...packFormData, description: e.target.value })}
                                        className="w-full bg-[#050505] border border-silver p-3 rounded-lg text-white text-sm focus:border-[#D4AF37] outline-none"
                                        placeholder="Brief details about the pack..."
                                        rows={3}
                                    />
                                </div>

                                <div className="flex items-center gap-3 bg-black/20 p-3 rounded-lg border border-silver">
                                    <input
                                        type="checkbox"
                                        id="pack-active"
                                        checked={packFormData.active === 1}
                                        onChange={(e) => setPackFormData({ ...packFormData, active: e.target.checked ? 1 : 0 })}
                                        className="w-5 h-5 accent-green-500 cursor-pointer"
                                    />
                                    <label htmlFor="pack-active" className="text-sm font-bold text-white/80 cursor-pointer">
                                        Pack is Active (Visible in Shop)
                                    </label>
                                </div>

                                <div className="pt-4 flex gap-3">
                                    <button
                                        onClick={() => setShowPackModal(false)}
                                        className="flex-1 bg-muted/50 hover:bg-gray-200 text-white py-3 rounded-lg font-bold transition-all"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={handleSavePack}
                                        disabled={loading}
                                        className="flex-1 bg-[#635bff] hover:bg-[#4b44d3] text-white py-3 rounded-lg font-bold transition-all shadow-lg flex items-center justify-center gap-2"
                                    >
                                        {loading ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-check-circle"></i>}
                                        {editingPack ? 'Update Pack' : 'Create Pack'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }
        </div >
    );
};

export default AdminDashboard;

