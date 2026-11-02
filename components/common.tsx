'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { DialogHTMLAttributes, ReactNode, RefObject } from 'react';
import Store from '../lib/store.ts';
import type { StoreKey } from '../lib/store.ts';

// ---------- toast ----------

type Toast = (text: string) => void;
const ToastContext = createContext<Toast>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState('');
  const [show, setShow] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toast = useCallback<Toast>((text) => {
    setMsg(text);
    setShow(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setShow(false), 2600);
  }, []);
  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className={'toast' + (show ? ' show' : '')} id="toast" role="status">
        {msg}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = (): Toast => useContext(ToastContext);

// ---------- modal dialog ----------

type ModalProps = Omit<DialogHTMLAttributes<HTMLDialogElement>, 'open' | 'onClose'> & {
  open: boolean;
  onClose?: () => void;
  children?: ReactNode;
};

/** A native <dialog> shown as a modal while `open` is true. Clicking the backdrop or pressing Esc closes it. */
export function Modal({ open, onClose, className = '', id, children, ...rest }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      id={id}
      className={className}
      onClose={() => open && onClose?.()}
      onClick={(e) => e.target === ref.current && onClose?.()}
      {...rest}
    >
      {open ? children : null}
    </dialog>
  );
}

// ---------- stored values ----------

/**
 * A value from the browser store, kept in sync with changes from this tab,
 * other tabs and the other page. `keys` are the store keys it depends on.
 */
export function useStored<T>(getter: () => T, keys: StoreKey[]): T {
  const [value, setValue] = useState<T>(getter);
  const ref = useRef({ getter, keys });
  ref.current = { getter, keys };
  useEffect(
    () =>
      Store.onChange((key) => {
        if (ref.current.keys.includes(key)) setValue(ref.current.getter());
      }),
    []
  );
  return value;
}

/** True on phones and tablets (no Ctrl+V: point people to the Paste button). */
export function useIsTouch(): boolean {
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(pointer: coarse)');
    const update = () => setTouch(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return touch;
}

/** Close a popup when clicking outside `ref` or pressing Esc. */
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, onDismiss: () => void): void {
  useEffect(() => {
    if (!open) return;
    const click = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onDismiss();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onDismiss();
    document.addEventListener('click', click);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('click', click);
      document.removeEventListener('keydown', key);
    };
  }, [ref, open, onDismiss]);
}
