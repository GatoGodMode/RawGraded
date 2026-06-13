import React from 'react';
import ReactDOM from 'react-dom/client';
import './mobile/studio.css';
import { initMobilePlatformBridge } from './services/platform/platformBridge';
import MobileShell from './mobile/MobileShell';

declare const __BUILD_ID__: number | undefined;

async function bootstrap() {
  await initMobilePlatformBridge();

  const rootElement = document.getElementById('root');
  if (!rootElement) throw new Error('Could not find root element');

  if (typeof __BUILD_ID__ !== 'undefined') {
    rootElement.setAttribute('data-build', String(__BUILD_ID__));
  }

  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <MobileShell />
    </React.StrictMode>
  );
}

void bootstrap();
