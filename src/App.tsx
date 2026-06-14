import { useEffect, useState } from 'react';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { useUIStore } from '@/stores/uiStore';
import { applyThemeToDom } from '@/hooks/useTheme';
import type { ThemeMode } from '@/hooks/useTheme';
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard';
import { settingsApi } from '@/lib/ipc';

// Apply saved theme on startup before any render
function ThemeInitializer() {
  const theme = useUIStore(state => state.theme) as ThemeMode;
  useEffect(() => {
    applyThemeToDom(theme);
  }, [theme]);
  return null;
}

function App() {
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingChecked, setOnboardingChecked] = useState(false);

  useEffect(() => {
    settingsApi.get().then(result => {
      if (result.success && !result.data.onboardingCompleted) {
        setShowOnboarding(true);
      }
      setOnboardingChecked(true);
    }).catch(() => {
      // If settings can't be loaded (e.g., first launch), show onboarding
      setShowOnboarding(true);
      setOnboardingChecked(true);
    });
  }, []);

  const handleOnboardingComplete = () => {
    setShowOnboarding(false);
  };

  if (!onboardingChecked) {
    return null; // Brief blank during settings check
  }

  return (
    <>
      <ThemeInitializer />
      <RouterProvider router={router} />
      {showOnboarding && (
        <OnboardingWizard onComplete={handleOnboardingComplete} />
      )}
    </>
  );
}

export default App;
