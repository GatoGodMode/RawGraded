import React from 'react';
import ReactDOM from 'react-dom/client';
import DesktopShell from './desktop/DesktopShell';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Could not find root element');

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <DesktopShell />
  </React.StrictMode>
);
