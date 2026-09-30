import { ToastProvider } from "./components/toast";
import { LanguageProvider } from "./i18n";
import { StoreProvider, useStore } from "./store";
import { Dashboard } from "./components/Dashboard";
import { Welcome } from "./components/Welcome";
import { LockScreen } from "./components/LockScreen";

function Gate() {
  const { ready, wallet, walletLocked } = useStore();
  if (!ready) return null;
  if (walletLocked) return <LockScreen />;
  return wallet ? <Dashboard /> : <Welcome />;
}

export function App() {
  return (
    <LanguageProvider>
      <ToastProvider>
        <StoreProvider>
          <Gate />
        </StoreProvider>
      </ToastProvider>
    </LanguageProvider>
  );
}

export default App;
