// Zuerst: Einstellungen im Browser unter ihre heutigen Schlüssel umziehen, bevor irgendein Modul sie liest
import './lib/legacy-storage';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
import 'katex/dist/katex.min.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/layout.css';
import './styles/content.css';
import './styles/editor.css';
import './styles/pages.css';
import './styles/modern.css';
import './styles/shell.css';
import './styles/features.css';
import './styles/motion.css';
import './styles/scene.css';
import './styles/planner.css';
// Zuletzt: Die Aussehen „Glas“ und „Papier“ überschreiben Token und einzelne Flächen der übrigen Stylesheets
import './styles/appearance.css';
import { I18nProvider } from './i18n';
import { ToastProvider } from './lib/toast';
import { DialogProvider } from './lib/dialogs';
import { AuthProvider } from './lib/auth';
import { applyTheme } from './lib/theme';
import { initMotion } from './lib/motion';
import { initAppearance } from './lib/appearance';
import { router } from './App';

applyTheme();
initAppearance();
// Vor dem ersten Rendern: sonst würden Einblend-Effekte Inhalte erst zeigen und dann verstecken
initMotion();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: 1 },
  },
});

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <ToastProvider>
          <DialogProvider>
            <AuthProvider>
              <RouterProvider router={router} />
            </AuthProvider>
          </DialogProvider>
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
