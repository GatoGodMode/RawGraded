import React, { useState, useEffect } from 'react';

interface ShopModalProps {
    isOpen: boolean;
    onClose: () => void;
    user: any;
    onSuccess?: () => void;
    onNavigate: (step: any) => void;
}

const BRASS = 'linear-gradient(90deg, #BF953F, #FCF6BA, #B38728)';
const BRASS_TEXT = 'bg-gradient-to-r from-[#BF953F] via-[#FCF6BA] to-[#B38728] text-transparent bg-clip-text';

const ShopModal: React.FC<ShopModalProps> = ({ isOpen, onClose, user, onSuccess, onNavigate }) => {
    const [packs, setPacks] = useState<any[]>([]);
    const [subPlans, setSubPlans] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [subLoading, setSubLoading] = useState(false);
    const [activeTab, setActiveTab] = useState<'credits' | 'subscriptions'>('credits');
    const [processingId, setProcessingId] = useState<number | null>(null);

    useEffect(() => {
        if (isOpen) fetchPacks();
    }, [isOpen]);

    useEffect(() => {
        if (isOpen && activeTab === 'subscriptions') void fetchSubPlans();
    }, [isOpen, activeTab]);

    const fetchPacks = async () => {
        setLoading(true);
        try {
            const res = await fetch('api/stripe.php?action=get_packs');
            const json = await res.json();
            if (json.data) setPacks(json.data);
        } catch (e) {
            console.error('Failed to fetch packs', e);
        } finally {
            setLoading(false);
        }
    };

    const fetchSubPlans = async () => {
        setSubLoading(true);
        try {
            const res = await fetch('api/stripe.php?action=get_subscription_plans');
            const json = await res.json();
            if (json.data) setSubPlans(json.data);
        } catch (e) {
            console.error('Failed to fetch subscription plans', e);
        } finally {
            setSubLoading(false);
        }
    };

    const handleSubscribeCheckout = async (planId: number) => {
        setProcessingId(planId);
        try {
            const res = await fetch('api/stripe.php?action=create_subscription_checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ plan_id: planId }),
            });
            const json = await res.json();
            if (json.data?.url) {
                window.location.href = json.data.url;
            } else {
                alert(json.error || 'Could not start checkout. Ensure Stripe Price IDs are set in Admin.');
            }
        } catch {
            alert('Failed to connect to payment server');
        } finally {
            setProcessingId(null);
        }
    };

    const openBillingPortal = async () => {
        try {
            const res = await fetch('api/stripe.php?action=create_billing_portal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({}),
            });
            const json = await res.json();
            if (json.data?.url) window.location.href = json.data.url;
            else alert(json.error || 'Billing portal unavailable until you have subscribed once.');
        } catch {
            alert('Failed to open billing portal');
        }
    };

    const handlePurchase = async (packId: number) => {
        setProcessingId(packId);
        try {
            const res = await fetch('api/stripe.php?action=create_checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ pack_id: packId })
            });
            const json = await res.json();
            if (json.data?.url) {
                window.location.href = json.data.url;
            } else {
                alert('Purchase Error: ' + (json.error || 'Failed to initialize checkout'));
            }
        } catch (e) {
            alert('Failed to connect to payment server');
        } finally {
            setProcessingId(null);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fade-in">
            <div className="w-full max-w-lg flex flex-col relative max-h-[90vh] overflow-hidden"
                style={{background:'linear-gradient(160deg,rgba(20,20,20,1) 0%,rgba(10,10,10,1) 100%)', border:'1px solid rgba(255,255,255,0.08)'}}>

                {/* Top brass line */}
                <div className="h-[2px] w-full shrink-0" style={{background:BRASS}}></div>

                {/* Ambient glow */}
                <div className="absolute top-0 right-0 w-80 h-80 rounded-full pointer-events-none blur-[120px]" style={{background:'rgba(191,149,63,0.04)'}}></div>

                {/* Header */}
                <div className="px-8 py-6 flex justify-between items-center shrink-0" style={{borderBottom:'1px solid rgba(255,255,255,0.06)'}}>
                    <div className="flex items-center gap-4">
                        <div className="w-9 h-9 flex items-center justify-center" style={{background:'linear-gradient(135deg,#BF953F,#B38728)'}}>
                            <i className="fas fa-gem text-black text-sm"></i>
                        </div>
                        <div>
                            <p className={`text-base font-black tracking-tight ${BRASS_TEXT}`}>Inner Circle Access</p>
                            <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-white/30 mt-0.5">Pro Credits · Membership</p>
                        </div>
                    </div>
                    <button onClick={onClose}
                        className="w-8 h-8 flex items-center justify-center text-white/30 hover:text-white transition-colors">
                        <i className="fas fa-times text-sm"></i>
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex shrink-0 px-8 pt-5 gap-6" style={{borderBottom:'1px solid rgba(255,255,255,0.06)'}}>
                    {(['credits','subscriptions'] as const).map(tab => (
                        <button key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`pb-4 text-[10px] font-black uppercase tracking-[0.3em] transition-all relative ${activeTab === tab ? 'text-white' : 'text-white/25 hover:text-white/50'}`}>
                            {tab === 'credits' ? 'Pro Credits' : 'Subscriptions'}
                            {activeTab === tab && (
                                <div className="absolute bottom-0 left-0 right-0 h-[2px]" style={{background:BRASS}}></div>
                            )}
                        </button>
                    ))}
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto px-8 py-6 space-y-3 relative z-10">

                    {activeTab === 'credits' ? (
                        <>
                            {loading ? (
                                <div className="flex flex-col items-center justify-center py-20 gap-4">
                                    <div className="w-8 h-8 border-2 border-t-transparent border-[#BF953F] rounded-full animate-spin"></div>
                                    <p className="text-white/30 text-[10px] uppercase tracking-widest font-bold">Loading…</p>
                                </div>
                            ) : packs.length > 0 ? (
                                packs.map((pack) => {
                                    const isBest = pack.credits >= 100;
                                    const isProcessing = processingId === pack.id;
                                    return (
                                        <div key={pack.id}
                                            className="relative overflow-hidden transition-all duration-200 group"
                                            style={{background:'rgba(255,255,255,0.025)', border:'1px solid rgba(255,255,255,0.06)'}}>

                                            {/* Best Value tag */}
                                            {isBest && (
                                                <div className="absolute top-0 right-0 px-3 py-1 text-[8px] font-black uppercase tracking-widest text-black"
                                                    style={{background:'linear-gradient(90deg,#BF953F,#FCF6BA)'}}>
                                                    Best Value
                                                </div>
                                            )}

                                            {/* Top brass accent on hover */}
                                            <div className="absolute top-0 left-0 right-0 h-[1px] opacity-0 group-hover:opacity-100 transition-opacity" style={{background:BRASS}}></div>

                                            <div className="p-5 flex items-center justify-between gap-4">
                                                <div className="flex-1 space-y-1">
                                                    <p className="text-sm font-black text-white tracking-tight">{pack.name}</p>
                                                    <p className="text-xs font-light text-white/40 leading-relaxed">{pack.description}</p>
                                                    <div className="flex items-center gap-2 pt-1">
                                                        <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 border"
                                                            style={{color:'#C5A059', borderColor:'rgba(191,149,63,0.25)', background:'rgba(191,149,63,0.06)'}}>
                                                            {pack.credits} Credits
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="text-right space-y-2 shrink-0">
                                                    <p className="text-xl font-black text-white">${pack.price}</p>
                                                    <button
                                                        onClick={() => handlePurchase(pack.id)}
                                                        disabled={processingId !== null}
                                                        className="px-6 py-2 text-[10px] font-black uppercase tracking-widest text-black transition-opacity disabled:opacity-50"
                                                        style={{background:'linear-gradient(90deg,#BF953F,#E8C881,#B38728)'}}>
                                                        {isProcessing ? <i className="fas fa-spinner fa-spin"></i> : 'Unlock'}
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })
                            ) : (
                                <p className="text-center py-20 text-white/20 text-sm italic">No packs available at the moment.</p>
                            )}

                            {/* Payment trust */}
                            <div className="pt-4 pb-2">
                                <div className="flex items-center justify-center gap-6 mb-3" style={{opacity:0.2}}>
                                    <i className="fab fa-stripe text-3xl text-white"></i>
                                    <i className="fab fa-cc-visa text-2xl text-white"></i>
                                    <i className="fab fa-cc-mastercard text-2xl text-white"></i>
                                    <i className="fab fa-cc-apple-pay text-2xl text-white"></i>
                                </div>
                                <p className="text-[9px] text-white/20 uppercase font-bold tracking-widest text-center">
                                    <i className="fas fa-lock mr-2"></i>Secure Checkout via Stripe
                                </p>
                            </div>
                        </>
                    ) : (
                        <>
                            {user?.stripe_customer_id && (
                                <div className="mb-4">
                                    <button
                                        type="button"
                                        onClick={() => void openBillingPortal()}
                                        className="w-full py-2 text-[10px] font-black uppercase tracking-widest border border-white/15 text-white/70 hover:text-white"
                                    >
                                        Manage card &amp; subscription
                                    </button>
                                </div>
                            )}
                            {subLoading ? (
                                <div className="flex flex-col items-center justify-center py-20 gap-4">
                                    <div className="w-8 h-8 border-2 border-t-transparent border-[#BF953F] rounded-full animate-spin"></div>
                                    <p className="text-white/30 text-[10px] uppercase tracking-widest font-bold">Loading plans…</p>
                                </div>
                            ) : subPlans.length > 0 ? (
                                subPlans.map((plan) => {
                                    const price =
                                        plan.amount_cents != null && plan.amount_cents > 0
                                            ? (Number(plan.amount_cents) / 100).toFixed(2)
                                            : null;
                                    const busy = processingId === plan.id;
                                    return (
                                        <div
                                            key={plan.id}
                                            className="relative overflow-hidden p-5 flex items-center justify-between gap-4"
                                            style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)' }}
                                        >
                                            <div className="flex-1 space-y-1">
                                                <p className="text-sm font-black text-white tracking-tight">{plan.label}</p>
                                                <p className="text-xs text-white/40">
                                                    Billed every {plan.interval_days} days · recurring
                                                </p>
                                                {price && (
                                                    <p className="text-lg font-black text-white pt-1">
                                                        ${price}{' '}
                                                        <span className="text-[10px] font-normal text-white/40 uppercase">
                                                            {plan.currency || 'usd'}
                                                        </span>
                                                    </p>
                                                )}
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => void handleSubscribeCheckout(plan.id)}
                                                disabled={processingId !== null}
                                                className="px-5 py-2 text-[10px] font-black uppercase tracking-widest text-black transition-opacity disabled:opacity-50 shrink-0"
                                                style={{ background: 'linear-gradient(90deg,#BF953F,#E8C881,#B38728)' }}
                                            >
                                                {busy ? <i className="fas fa-spinner fa-spin"></i> : 'Subscribe'}
                                            </button>
                                        </div>
                                    );
                                })
                            ) : (
                                <div className="py-12 text-center space-y-3">
                                    <p className="text-white/40 text-sm">No subscription prices are live yet.</p>
                                    <p className="text-[11px] text-white/25 max-w-xs mx-auto">
                                        An admin must create recurring Stripe Prices (day interval + interval count) and attach them under Shop → Membership plans in the admin dashboard.
                                    </p>
                                </div>
                            )}
                            <p className="text-[9px] text-white/25 text-center pt-4 leading-relaxed">
                                7-day trial without a card. After trial, choose a plan—your card is saved for renewals. Cancel anytime from the billing portal.
                            </p>
                        </>
                    )}
                </div>

                {/* Footer */}
                <div className="px-8 py-4 shrink-0 flex justify-between items-center" style={{borderTop:'1px solid rgba(255,255,255,0.06)', background:'rgba(0,0,0,0.3)'}}>
                    <p className="text-[10px] font-bold text-white/25">
                        Balance: <span className={`font-black ${BRASS_TEXT}`}>{user?.paid_credits ?? 0} Credits</span>
                    </p>
                    <button onClick={() => onNavigate('TERMS_SERVICE')}
                        className="text-[9px] font-black uppercase tracking-widest text-white/20 hover:text-white/60 transition-colors">
                        Terms of Service
                    </button>
                </div>

                {/* Bottom brass line */}
                <div className="h-[1px] w-full shrink-0" style={{background:'linear-gradient(90deg,transparent,rgba(191,149,63,0.3),transparent)'}}></div>

            </div>
        </div>
    );
};

export default ShopModal;
