import { ToastProvider } from "./components/toast";
import { StoreProvider, useStore } from "./store";
import { Dashboard } from "./components/Dashboard";
import { Welcome } from "./components/Welcome";

function Gate() {
  const { ready, wallet } = useStore();
  if (!ready) return null;
  return wallet ? <Dashboard /> : <Welcome />;
}

export function App() {
  return (
    <ToastProvider>
      <StoreProvider>
        <Gate />
      </StoreProvider>
    </ToastProvider>
  );
}

export default App;
