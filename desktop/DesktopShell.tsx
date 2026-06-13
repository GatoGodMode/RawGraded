import React, { useState, useCallback } from 'react';

import StudioApp from './StudioApp';

import PortfolioApp from './PortfolioApp';

import DesktopSettings from '../components/DesktopSettings';

import AiLauncher from '../components/AiLauncher';

import OllamaBootstrap from '../components/OllamaBootstrap';

import { checkAiHealth, getSetupPending } from '../services/ai/healthCheck';



type ShellPhase = 'loading' | 'bootstrap' | 'launcher' | 'studio';

type DesktopTab = 'studio' | 'portfolio';



const DesktopShell: React.FC = () => {

  const [phase, setPhase] = useState<ShellPhase>('loading');

  const [tab, setTab] = useState<DesktopTab>('studio');

  const [showSettings, setShowSettings] = useState(false);



  const resolvePhase = useCallback(async (): Promise<ShellPhase> => {

    const pending = await getSetupPending();

    const full = window.desktop?.getSettingsFull ? await window.desktop.getSettingsFull() : null;

    const provider = full?.llmProvider ?? 'gemini';

    const bootstrapComplete = full?.bootstrapComplete ?? false;

    const report = await checkAiHealth();



    if (report.ready) {
      if (pending && window.desktop?.clearSetupPending) {
        await window.desktop.clearSetupPending();
      }
      return 'studio';
    }



    if (

      pending ||

      (provider === 'ollama' && !bootstrapComplete) ||

      full?.installerChoseOllama

    ) {

      if (pending?.installOllama || pending?.pullModel || provider === 'ollama') {

        return 'bootstrap';

      }

    }



    return 'launcher';

  }, []);



  React.useEffect(() => {

    void resolvePhase().then(setPhase);

  }, [resolvePhase]);



  if (phase === 'loading') {

    return (

      <div className="min-h-screen bg-black flex items-center justify-center text-poke-gold text-sm uppercase tracking-widest">

        Loading RawGraded Studio...

      </div>

    );

  }



  if (showSettings) {

    return (

      <div className="min-h-screen bg-black">

        <DesktopSettings

          onClose={async () => {

            setShowSettings(false);

            setPhase(await resolvePhase());

          }}

        />

      </div>

    );

  }



  if (phase === 'bootstrap') {

    return (

      <OllamaBootstrap

        onReady={() => setPhase('studio')}

        onUseGemini={() => setPhase('launcher')}

      />

    );

  }



  if (phase === 'launcher') {

    return (

      <AiLauncher

        onReady={() => setPhase('studio')}

        onOpenSettings={() => setShowSettings(true)}

      />

    );

  }



  return (

    <div className="min-h-screen bg-black">

      <nav className="border-b border-white/10 px-4 py-2 flex items-center gap-4">

        <button

          type="button"

          onClick={() => setTab('studio')}

          className={`text-[10px] font-black uppercase tracking-[0.25em] px-3 py-1.5 rounded ${

            tab === 'studio' ? 'bg-poke-gold text-black' : 'text-gray-400 hover:text-white'

          }`}

        >

          Scan Studio

        </button>

        <button

          type="button"

          onClick={() => setTab('portfolio')}

          className={`text-[10px] font-black uppercase tracking-[0.25em] px-3 py-1.5 rounded ${

            tab === 'portfolio' ? 'bg-poke-gold text-black' : 'text-gray-400 hover:text-white'

          }`}

        >

          Portfolio

        </button>

      </nav>

      {tab === 'studio' ? (

        <StudioApp onOpenSettings={() => setShowSettings(true)} />

      ) : (

        <PortfolioApp

          onOpenSettings={() => setShowSettings(true)}

          onOpenStudio={() => setTab('studio')}

        />

      )}

    </div>

  );

};



export default DesktopShell;

