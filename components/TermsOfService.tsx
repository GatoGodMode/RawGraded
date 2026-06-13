import React from 'react';

interface TermsOfServiceProps {
    onBack: () => void;
}

const TermsOfService: React.FC<TermsOfServiceProps> = ({ onBack }) => {
    return (
        <div className="min-h-screen bg-poke-dark text-white p-8 md:p-12 font-sans relative">
            <button onClick={onBack} className="absolute top-8 left-8 text-gray-400 hover:text-white transition-colors flex items-center gap-2">
                <i className="fas fa-arrow-left"></i> Back
            </button>
            <div className="max-w-4xl mx-auto space-y-8 animate-fade-in">
                <div className="border-b border-gray-700 pb-6">
                    <h1 className="text-4xl font-black text-poke-accent mb-2">Terms of Service</h1>
                    <p className="text-gray-400">Last Updated: {new Date().toLocaleDateString()}</p>
                </div>

                <div className="space-y-6 text-gray-300 leading-relaxed">
                    <section>
                        <h2 className="text-2xl font-bold text-white mb-3">1. Service Subscription</h2>
                        <p>
                            RawGraded offers both free and paid services. By selecting a paid service, you agree to pay RawGraded the monthly or annual subscription fees indicated for that service. Payments will be charged on a pre-pay basis on the day you sign up for a Premium Service and will cover the use of that service for a monthly or annual subscription period as indicated.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-bold text-white mb-3">2. Account and Authentication</h2>
                        <p>
                            Accounts can be created or accessed via email and password and/or Google Sign-In. By using Google Sign-In you agree to comply with Google&apos;s Terms of Service and our use of your data as described in our Privacy Policy. We may require or offer two-factor authentication (2FA). You are responsible for keeping your credentials and any 2FA devices or codes secure.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-bold text-white mb-3">3. Credit System</h2>
                        <p>
                            RawGraded operates on a credit-based system for scans.
                        </p>
                        <ul className="list-disc pl-5 mt-2 space-y-1">
                            <li><strong>Free Tier:</strong> Users receive a limited number of free scans per week. Unused free scans do not rollover.</li>
                            <li><strong>Purchased Credits:</strong> Additional credits can be purchased and do not expire unless explicitly stated at the time of purchase.</li>
                            <li><strong>Refunds:</strong> All purchases of credits or subscriptions are final and non-refundable, except as required by applicable law.</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-2xl font-bold text-white mb-3">4. Termination</h2>
                        <p>
                            We may terminate or suspend access to our Service immediately, without prior notice or liability, for any reason whatsoever, including without limitation if you breach the Terms. All provisions of the Terms which by their nature should survive termination shall survive termination, including, without limitation, ownership provisions, warranty disclaimers, indemnity and limitations of liability.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-bold text-white mb-3">5. Limitation of Liability</h2>
                        <p>
                            In no event shall RawGraded, nor its directors, employees, partners, agents, suppliers, or affiliates, be liable for any indirect, incidental, special, consequential or punitive damages, including without limitation, loss of profits, data, use, goodwill, or other intangible losses, resulting from (i) your access to or use of or inability to access or use the Service; (ii) any conduct or content of any third party on the Service; (iii) any content obtained from the Service; and (iv) unauthorized access, use or alteration of your transmissions or content, whether based on warranty, contract, tort (including negligence) or any other legal theory, whether or not we have been informed of the possibility of such damage, and even if a remedy set forth herein is found to have failed of its essential purpose.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-bold text-white mb-3">6. Governing Law</h2>
                        <p>
                            These Terms shall be governed and construed in accordance with the laws of the State of Delaware, United States, without regard to its conflict of law provisions. Our failure to enforce any right or provision of these Terms will not be considered a waiver of those rights.
                        </p>
                    </section>
                </div>
            </div>
        </div>
    );
};

export default TermsOfService;
