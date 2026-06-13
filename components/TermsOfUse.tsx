import React from 'react';

interface TermsOfUseProps {
    onBack: () => void;
}

const TermsOfUse: React.FC<TermsOfUseProps> = ({ onBack }) => {
    return (
        <div className="min-h-screen bg-poke-dark text-white p-8 md:p-12 font-sans relative">
            <button onClick={onBack} className="absolute top-8 left-8 text-gray-400 hover:text-white transition-colors flex items-center gap-2">
                <i className="fas fa-arrow-left"></i> Back
            </button>
            <div className="max-w-4xl mx-auto space-y-8 animate-fade-in">
                <div className="border-b border-gray-700 pb-6">
                    <h1 className="text-4xl font-black text-poke-accent mb-2">Terms of Use</h1>
                    <p className="text-gray-400">Last Updated: {new Date().toLocaleDateString()}</p>
                </div>

                <div className="space-y-6 text-gray-300 leading-relaxed">
                    <section>
                        <h2 className="text-2xl font-bold text-white mb-3">1. Acceptance of Terms</h2>
                        <p>
                            By accessing and using RawGraded, you accept and agree to be bound by the terms and provision of this agreement. Use of Google Sign-In or other third-party sign-in is subject to that provider&apos;s terms and to our Privacy Policy (available in the app footer). In addition, when using these particular services, you shall be subject to any posted guidelines or rules applicable to such services.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-bold text-white mb-3">2. Description of Service</h2>
                        <p>
                            RawGraded provides users with AI-powered trading card grading and analysis tools. You understand and agree that the Service may include certain communications from RawGraded, such as service announcements, administrative messages, and that these communications are considered part of RawGraded membership.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-bold text-white mb-3">3. AI Grading Disclaimer</h2>
                        <p>
                            The grading services provided by RawGraded are automated AI estimates based on digital imagery. These grades are for informational purposes only and do not guarantee outcomes from third-party professional grading services (e.g., PSA, BGS, CGC). RawGraded is not liable for discrepancies between our AI analysis and physical grading results.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-bold text-white mb-3">4. Intellectual Property</h2>
                        <p>
                            The site and its original content, features, and functionality are owned by RawGraded and are protected by international copyright, trademark, patent, trade secret, and other intellectual property or proprietary rights laws.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-bold text-white mb-3">5. User Conduct</h2>
                        <p>
                            You agree not to use the Service to:
                        </p>
                        <ul className="list-disc pl-5 mt-2 space-y-1">
                            <li>Upload any content that is unlawful, harmful, threatening, abusive, harassing, defaming, vulgar, obscene, libelous, invasive of another's privacy, hateful, or racially, ethnically or otherwise objectionable.</li>
                            <li>Impersonate any person or entity or falsely state or otherwise misrepresent your affiliation with a person or entity.</li>
                            <li>Upload any material that contains software viruses or any other computer code, files or programs designed to interrupt, destroy or limit the functionality of any computer software or hardware or telecommunications equipment.</li>
                        </ul>
                    </section>
                </div>
            </div>
        </div>
    );
};

export default TermsOfUse;
