import React, { useState, useEffect } from 'react';
import type { UserProfile } from '../types';

interface PrivacyControlPluginProps {
  user: UserProfile;
  onRefresh?: () => void;
}

/**
 * PRIVACY CONTROL PLUGIN
 * -----------------------
 * Allows users to:
 * 1. Toggle global privacy mode (public vs private - auto-hides all scans)
 * 2. View current privacy status
 * Integrates into My Vault UI as a compact control panel.
 */
const PrivacyControlPlugin: React.FC<PrivacyControlPluginProps> = ({ user, onRefresh }) => {
  const [privacyMode, setPrivacyMode] = useState<'public' | 'private'>('public');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const fetchPrivacyMode = async () => {
      try {
        const resp = await fetch('api/privacy.php?action=get_privacy_mode', { credentials: 'include' });
        const data = await resp.json();
        setPrivacyMode(data.privacy_mode || 'public');
      } catch (e) {
        console.error('[PrivacyControlPlugin] Failed to fetch privacy mode:', e);
      }
    };
    fetchPrivacyMode();
  }, []);

  const handleTogglePrivacy = async () => {
    const newMode = privacyMode === 'public' ? 'private' : 'public';
    const confirmMsg = newMode === 'private'
      ? 'Switch to Private Mode? All your certificates will be hidden from the Public Archive (but still count in your stats).'
      : 'Switch to Public Mode? Your certificates will be visible in the Public Archive.';
    
    if (!confirm(confirmMsg)) return;

    setIsLoading(true);
    try {
      const resp = await fetch('api/privacy.php?action=set_privacy_mode', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ privacy_mode: newMode })
      });
      const result = await resp.json();
      if (result.success) {
        setPrivacyMode(newMode);
        if (onRefresh) onRefresh();
      } else {
        alert('Privacy mode update failed: ' + result.error);
      }
    } catch (e) {
      console.error('[PrivacyControlPlugin] Toggle failed:', e);
      alert('Privacy mode update failed. Check console.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ background: '#0a0a0a', border: '1px solid rgba(212,175,55,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', padding: '16px 24px', position: 'relative', overflow: 'hidden' }}>
      {/* Ambient glow */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '1px', background: 'linear-gradient(90deg, transparent, rgba(212,175,55,0.3), transparent)', pointerEvents: 'none' }} />
      
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        <div style={{
          width: '36px', height: '36px', border: `1px solid ${privacyMode === 'private' ? 'rgba(212,175,55,0.4)' : 'rgba(255,255,255,0.1)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', background: privacyMode === 'private' ? 'rgba(212,175,55,0.08)' : 'rgba(255,255,255,0.03)', flexShrink: 0
        }}>
          <i className={`fas ${privacyMode === 'private' ? 'fa-eye-slash' : 'fa-eye'}`} style={{ fontSize: '14px', color: privacyMode === 'private' ? '#D4AF37' : 'rgba(255,255,255,0.4)' }}></i>
        </div>
        <div>
          <p style={{ fontFamily: 'system-ui, sans-serif', fontWeight: 800, fontSize: '11px', letterSpacing: '0.18em', textTransform: 'uppercase', color: privacyMode === 'private' ? '#D4AF37' : 'rgba(255,255,255,0.7)', margin: 0, lineHeight: 1.2 }}>
            {privacyMode === 'private' ? 'Private Mode' : 'Public Mode'}
          </p>
          <p style={{ fontFamily: 'system-ui, sans-serif', fontWeight: 400, fontSize: '9px', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.25)', margin: '4px 0 0', lineHeight: 1 }}>
            {privacyMode === 'private' ? 'Hidden from Public Archive' : 'Visible in Public Archive'}
          </p>
        </div>
      </div>

      <button
        onClick={handleTogglePrivacy}
        disabled={isLoading}
        style={{
          padding: '8px 20px', fontFamily: 'system-ui, sans-serif', fontWeight: 700, fontSize: '10px',
          letterSpacing: '0.18em', textTransform: 'uppercase', cursor: isLoading ? 'not-allowed' : 'pointer',
          opacity: isLoading ? 0.5 : 1, transition: 'all 0.2s ease', flexShrink: 0,
          border: `1px solid ${privacyMode === 'private' ? 'rgba(255,255,255,0.15)' : '#D4AF37'}`,
          background: privacyMode === 'private' ? 'rgba(255,255,255,0.05)' : 'rgba(212,175,55,0.12)',
          color: privacyMode === 'private' ? 'rgba(255,255,255,0.5)' : '#D4AF37',
        }}
      >
        {isLoading ? <i className="fas fa-spinner fa-spin"></i> : (privacyMode === 'private' ? 'Go Public' : 'Go Private')}
      </button>
    </div>
  );
};

export default PrivacyControlPlugin;
