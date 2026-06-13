import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

declare const __BUILD_ID__: number | undefined;

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}
if (typeof __BUILD_ID__ !== 'undefined') {
  rootElement.setAttribute('data-build', String(__BUILD_ID__));
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);