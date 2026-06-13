import React from 'react';

interface PrivacyPolicyProps {
    onBack: () => void;
}

const PrivacyPolicy: React.FC<PrivacyPolicyProps> = ({ onBack }) => {
    return (
        <div className="min-h-screen bg-poke-dark text-white p-8 md:p-12 font-sans relative">
            <button onClick={onBack} className="absolute top-8 left-8 text-gray-400 hover:text-white transition-colors flex items-center gap-2">
                <i className="fas fa-arrow-left"></i> Back
            </button>
            <div className="max-w-4xl mx-auto space-y-8 animate-fade-in">
                <div className="border-b border-gray-700 pb-6">
                    <h1 className="text-4xl font-black text-poke-accent mb-2">Privacy Policy</h1>
                    <p className="text-gray-400">Effective date: June 8, 2026</p>
                    <p className="mt-3 text-sm">
                        <a
                            href="/privacy-policy.html"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-poke-accent hover:underline font-semibold"
                        >
                            View full policy (all RAW ENGINE products) ↗
                        </a>
                    </p>
                </div>

                <div className="space-y-6 text-gray-300 leading-relaxed">
                    <section>
                        <h2 className="text-2xl font-bold text-white mb-3">1. Introduction</h2>
                        <p>
                            RawGraded (RAW ENGINE) respects your privacy. This summary covers the <strong>RawGraded Web</strong> dashboard.
                            Desktop apps (Studio, Raw Investor, RawMarkets) are local-first — see the{' '}
                            <a href="/privacy-policy.html" target="_blank" rel="noopener noreferrer" className="text-poke-accent hover:underline">full policy</a>{' '}
                            for product-specific details.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-bold text-white mb-3">2. Data We Collect (Web)</h2>
                        <ul className="list-disc pl-5 mt-2 space-y-1">
                            <li><strong>Identity:</strong> username, email, optional X username, invite codes.</li>
                            <li><strong>Authentication:</strong> password hash, Google Sign-In (sub, email, name, picture), 2FA settings, session cookies.</li>
                            <li><strong>Grading data:</strong> card images, grades, metadata, acquisition details, user notes when you save certificates.</li>
                            <li><strong>Payments:</strong> Stripe customer/subscription IDs (card data handled by Stripe).</li>
                            <li><strong>Technical:</strong> IP address, browser type, usage such as scan history.</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-2xl font-bold text-white mb-3">3. Google Sign-In and Third Parties</h2>
                        <p>
                            Google Sign-In is subject to{' '}
                            <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer" className="text-poke-accent hover:underline">Google&apos;s Privacy Policy</a>.
                            We also use Google Gemini for AI grading, Stripe for payments, TCGDex/Pokémon TCG API for card identity, and api.qrserver.com for QR codes.
                            We do not embed third-party analytics or advertising trackers.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-bold text-white mb-3">4. Cookies and Local Storage</h2>
                        <p>
                            Session cookies keep you logged in and secure 2FA. Browser localStorage and IndexedDB may cache your profile and certificate images for performance.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-bold text-white mb-3">5. Public Archive and Controls</h2>
                        <p>
                            You control whether certificates appear in public population stats and the archive via per-cert hide settings and a global privacy mode.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-bold text-white mb-3">6. Retention, Security, and Rights</h2>
                        <p>
                            We retain account data while your account is active. You may request access, correction, or deletion via{' '}
                            <a href="mailto:support@rawgraded.com" className="text-poke-accent hover:underline">support@rawgraded.com</a>{' '}
                            or{' '}
                            <a href="https://x.com/GatoGodMode" target="_blank" rel="noopener noreferrer" className="text-poke-accent hover:underline">@GatoGodMode</a> on X.
                            This policy is governed by Delaware law.
                        </p>
                    </section>
                </div>

                <div className="pt-8 border-t border-gray-700">
                    <p className="text-sm text-gray-500">
                        Full policy for RawGraded Studio, Raw Investor, and RawMarkets:{' '}
                        <a href="/privacy-policy.html" target="_blank" rel="noopener noreferrer" className="text-poke-accent hover:underline">rawgraded.com/privacy-policy.html</a>
                    </p>
                </div>
            </div>
        </div>
    );
};

export default PrivacyPolicy;
