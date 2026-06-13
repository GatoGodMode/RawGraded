import React, { useState } from 'react';

export const RG_MEMBERSHIP_APP_TOKEN_KEY = 'rg_membership_application_token';

type Step = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface ApplicationAnswers {
  grading_company: string;
  grade_frequency: string;
  business_or_individual: string;
  sell_channels: string;
  card_shows: string;
  scanning_scope: string;
  usage_intent: string;
  email: string;
}

const initialAnswers = (): ApplicationAnswers => ({
  grading_company: '',
  grade_frequency: '',
  business_or_individual: '',
  sell_channels: '',
  card_shows: '',
  scanning_scope: '',
  usage_intent: '',
  email: '',
});

interface MembershipApplicationWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: (applicationToken: string) => void;
}

const MembershipApplicationWizard: React.FC<MembershipApplicationWizardProps> = ({ isOpen, onClose, onComplete }) => {
  const [step, setStep] = useState<Step>(0);
  const [answers, setAnswers] = useState<ApplicationAnswers>(initialAnswers);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const update = (patch: Partial<ApplicationAnswers>) => setAnswers((a) => ({ ...a, ...patch }));

  const canNext = (): boolean => {
    switch (step) {
      case 0: return answers.grading_company !== '';
      case 1: return answers.grade_frequency !== '';
      case 2: return answers.business_or_individual !== '';
      case 3: return answers.sell_channels !== '';
      case 4: return answers.card_shows !== '';
      case 5: return answers.scanning_scope !== '';
      case 6: return answers.usage_intent.trim().length >= 8;
      case 7: return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(answers.email.trim());
      default: return false;
    }
  };

  const submit = async () => {
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/applications.php?action=submit_application', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: answers.email.trim(), answers }),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || 'Submit failed');
      const token = json.data?.application_token as string | undefined;
      if (!token) throw new Error('No application token returned');
      try {
        sessionStorage.setItem(RG_MEMBERSHIP_APP_TOKEN_KEY, token);
      } catch {
        /* ignore */
      }
      onComplete(token);
      setStep(0);
      setAnswers(initialAnswers());
      onClose();
    } catch (e: any) {
      setError(e.message || 'Failed');
    } finally {
      setSubmitting(false);
    }
  };

  const next = () => {
    if (step < 7) setStep((s) => (s + 1) as Step);
    else void submit();
  };

  const back = () => {
    if (step > 0) setStep((s) => (s - 1) as Step);
  };

  const labels: Record<number, { title: string; subtitle?: string }> = {
    0: { title: 'What company do you grade with?', subtitle: 'Primary grading service you care about for outcomes' },
    1: { title: 'How often do you grade?', subtitle: 'Rough cadence is fine' },
    2: { title: 'Are you a business or an individual?', subtitle: '' },
    3: { title: 'Do you sell cards online, in person, or both?', subtitle: '' },
    4: { title: 'Do you go to card shows?', subtitle: '' },
    5: { title: 'Are you planning to scan your entire collection or just some candidates?', subtitle: '' },
    6: { title: 'How do you plan on using RawGraded?', subtitle: 'A few sentences help us prioritize access' },
    7: { title: 'Confirm your email', subtitle: 'Must match the account you will register with' },
  };

  return (
    <div className="fixed inset-0 z-[190] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl border border-white/10 shadow-2xl p-6 md:p-8"
        style={{ background: 'linear-gradient(165deg,rgba(24,24,24,0.98) 0%,rgba(10,10,10,1) 100%)' }}
      >
        <div className="flex justify-between items-start mb-6">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.35em] text-[#D4AF37] mb-2">Membership application</p>
            <h2 className="text-xl font-serif text-white">{labels[step]?.title}</h2>
            {labels[step]?.subtitle ? <p className="text-sm text-white/50 mt-2">{labels[step].subtitle}</p> : null}
          </div>
          <button type="button" onClick={onClose} className="text-white/40 hover:text-white text-sm px-2">
            <i className="fas fa-times" />
          </button>
        </div>

        <div className="flex gap-1 mb-6">
          {([0, 1, 2, 3, 4, 5, 6, 7] as Step[]).map((i) => (
            <div key={i} className={`h-1 flex-1 rounded ${i <= step ? 'bg-[#BF953F]' : 'bg-white/10'}`} />
          ))}
        </div>

        {error ? (
          <div className="mb-4 text-red-400 text-xs font-bold uppercase tracking-wider">{error}</div>
        ) : null}

        <div className="space-y-4 min-h-[200px]">
          {step === 0 && (
            <select
              value={answers.grading_company}
              onChange={(e) => update({ grading_company: e.target.value })}
              className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg p-3 text-white"
            >
              <option value="">Select…</option>
              <option value="PSA">PSA</option>
              <option value="BGS">BGS / Beckett</option>
              <option value="CGC">CGC</option>
              <option value="SGC">SGC</option>
              <option value="Other">Other</option>
            </select>
          )}
          {step === 1 && (
            <select
              value={answers.grade_frequency}
              onChange={(e) => update({ grade_frequency: e.target.value })}
              className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg p-3 text-white"
            >
              <option value="">Select…</option>
              <option value="rarely">Rarely</option>
              <option value="monthly">About monthly</option>
              <option value="weekly">Weekly</option>
              <option value="daily">Several times a week</option>
              <option value="professional">Professional volume</option>
            </select>
          )}
          {step === 2 && (
            <div className="grid grid-cols-1 gap-2">
              {['individual', 'business'].map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => update({ business_or_individual: v })}
                  className={`p-4 rounded-lg border text-left text-sm font-bold uppercase tracking-wider ${
                    answers.business_or_individual === v ? 'border-[#BF953F] bg-[#BF953F]/10 text-white' : 'border-white/10 text-white/70 hover:border-white/30'
                  }`}
                >
                  {v === 'individual' ? 'Individual collector' : 'Business / shop'}
                </button>
              ))}
            </div>
          )}
          {step === 3 && (
            <div className="grid grid-cols-1 gap-2">
              {[
                { v: 'online', l: 'Online' },
                { v: 'in_person', l: 'In person' },
                { v: 'both', l: 'Both' },
                { v: 'neither', l: 'Neither / not selling' },
              ].map(({ v, l }) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => update({ sell_channels: v })}
                  className={`p-4 rounded-lg border text-left text-sm font-bold uppercase tracking-wider ${
                    answers.sell_channels === v ? 'border-[#BF953F] bg-[#BF953F]/10 text-white' : 'border-white/10 text-white/70 hover:border-white/30'
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          )}
          {step === 4 && (
            <div className="grid grid-cols-2 gap-2">
              {['yes', 'no'].map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => update({ card_shows: v })}
                  className={`p-4 rounded-lg border text-sm font-bold uppercase tracking-wider ${
                    answers.card_shows === v ? 'border-[#BF953F] bg-[#BF953F]/10 text-white' : 'border-white/10 text-white/70'
                  }`}
                >
                  {v === 'yes' ? 'Yes' : 'No'}
                </button>
              ))}
            </div>
          )}
          {step === 5 && (
            <div className="grid grid-cols-1 gap-2">
              {[
                { v: 'entire', l: 'Entire collection (over time)' },
                { v: 'candidates', l: 'Just candidates / highlights' },
              ].map(({ v, l }) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => update({ scanning_scope: v })}
                  className={`p-4 rounded-lg border text-left text-sm font-bold ${
                    answers.scanning_scope === v ? 'border-[#BF953F] bg-[#BF953F]/10 text-white' : 'border-white/10 text-white/70'
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          )}
          {step === 6 && (
            <textarea
              value={answers.usage_intent}
              onChange={(e) => update({ usage_intent: e.target.value })}
              rows={5}
              className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg p-3 text-white text-sm"
              placeholder="Pre-submission checks, inventory documentation, resale, shows…"
            />
          )}
          {step === 7 && (
            <input
              type="email"
              value={answers.email}
              onChange={(e) => update({ email: e.target.value })}
              className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg p-3 text-white"
              placeholder="you@example.com"
            />
          )}
        </div>

        <div className="flex justify-between mt-8 gap-3">
          <button
            type="button"
            onClick={back}
            disabled={step === 0 || submitting}
            className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-white/50 disabled:opacity-30"
          >
            Back
          </button>
          <button
            type="button"
            onClick={next}
            disabled={!canNext() || submitting}
            className="px-8 py-3 text-[11px] font-black uppercase tracking-widest text-black disabled:opacity-40"
            style={{ background: 'linear-gradient(90deg,#BF953F,#E8C881,#B38728)' }}
          >
            {submitting ? <i className="fas fa-circle-notch fa-spin" /> : step === 7 ? 'Submit application' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default MembershipApplicationWizard;
