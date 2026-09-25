import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { ErrorProvider } from './contexts/ErrorProvider';
import { AuthProvider } from './contexts/AuthProvider';
import { I18nProvider } from './contexts/I18nProvider';
import { ThemeProvider } from './contexts/ThemeProvider';
import App from './App.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorProvider>
      <AuthProvider>
        <I18nProvider>
          <ThemeProvider>
            <App />
          </ThemeProvider>
        </I18nProvider>
      </AuthProvider>
    </ErrorProvider>
  </StrictMode>
);
