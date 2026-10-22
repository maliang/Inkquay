import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

interface ToastItem { id: number; message: string; kind: 'ok' | 'warn' }
interface ToastContextValue { toast: (message: string, kind?: 'ok' | 'warn') => void }

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const toast = useCallback((message: string, kind: 'ok' | 'warn' = 'ok') => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, message, kind }]);
    window.setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== id)), 2600);
  }, []);
  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="toast-root" aria-live="polite">
        {items.map((item) => (
          <div key={item.id} className={`toast${item.kind === 'warn' ? ' toast--warn' : ''}`}>
            <Icon name={item.kind === 'warn' ? 'alert' : 'check'} />
            <span>{item.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
