'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import Store from '../lib/store.js';

// ---------- toast ----------

const ToastContext = createContext(() => {});

export function ToastProvider({ children }) {
  const [msg, setMsg] = useState('');
  const [show, setShow] = useState(false);
  const timer = useRef(null);
  const toast = useCallback((text) => {
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

export const useToast = () => useContext(ToastContext);

// ---------- modal dialog ----------

/** A native <dialog> shown as a modal while `open` is true. Clicking the backdrop or pressing Esc closes it. */
export function Modal({ open, onClose, className = '', id, children, ...rest }) {
  const ref = useRef(null);
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
export function useStored(getter, keys) {
  const [value, setValue] = useState(getter);
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
export function useIsTouch() {
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
export function useDismiss(ref, open, onDismiss) {
  useEffect(() => {
    if (!open) return;
    const click = (e) => ref.current && !ref.current.contains(e.target) && onDismiss();
    const key = (e) => e.key === 'Escape' && onDismiss();
    document.addEventListener('click', click);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('click', click);
      document.removeEventListener('keydown', key);
    };
  }, [ref, open, onDismiss]);
}
