import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Button, Field, Input, Modal } from '../components/ui';
import { useI18n } from '../i18n';

interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** Eingabe, die exakt übereinstimmen muss (z. B. Bereichsschlüssel). */
  requireText?: string;
}

interface PromptOptions {
  title: string;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  multiline?: boolean;
}

interface DialogApi {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  prompt: (options: PromptOptions) => Promise<string | null>;
}

const DialogContext = createContext<DialogApi | null>(null);

type State =
  | { kind: 'confirm'; options: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: 'prompt'; options: PromptOptions; resolve: (v: string | null) => void }
  | null;

export function DialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(null);
  const [text, setText] = useState('');
  const { t } = useI18n();
  const stateRef = useRef<State>(null);
  stateRef.current = state;

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setText('');
        setState({ kind: 'confirm', options, resolve });
      }),
    [],
  );

  const prompt = useCallback(
    (options: PromptOptions) =>
      new Promise<string | null>((resolve) => {
        setText(options.defaultValue ?? '');
        setState({ kind: 'prompt', options, resolve });
      }),
    [],
  );

  const close = (value: boolean | string | null) => {
    const current = stateRef.current;
    if (!current) return;
    if (current.kind === 'confirm') current.resolve(value === true);
    else current.resolve(typeof value === 'string' ? value : null);
    setState(null);
  };

  const confirmDisabled = state?.kind === 'confirm' && !!state.options.requireText && text.trim().toUpperCase() !== state.options.requireText.toUpperCase();

  return (
    <DialogContext.Provider value={{ confirm, prompt }}>
      {children}
      {state && (
        <Modal
          open
          size="sm"
          title={state.options.title}
          onClose={() => close(state.kind === 'confirm' ? false : null)}
          footer={
            <>
              <Button onClick={() => close(state.kind === 'confirm' ? false : null)}>
                {(state.kind === 'confirm' && state.options.cancelLabel) || t('common.cancel')}
              </Button>
              <Button
                variant={state.kind === 'confirm' && state.options.danger ? 'danger' : 'primary'}
                disabled={confirmDisabled}
                onClick={() => close(state.kind === 'confirm' ? true : text)}
              >
                {state.options.confirmLabel ?? t('common.ok')}
              </Button>
            </>
          }
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (confirmDisabled) return;
              close(state.kind === 'confirm' ? true : text);
            }}
          >
            {state.kind === 'confirm' ? (
              <>
                {state.options.message && <div className="dialog-message">{state.options.message}</div>}
                {state.options.requireText && (
                  <Field>
                    <Input value={text} onChange={(e) => setText(e.target.value)} autoFocus placeholder={state.options.requireText} />
                  </Field>
                )}
              </>
            ) : (
              <Field label={state.options.label}>
                {state.options.multiline ? (
                  <textarea className="input textarea" rows={5} value={text} onChange={(e) => setText(e.target.value)} autoFocus placeholder={state.options.placeholder} />
                ) : (
                  <Input value={text} onChange={(e) => setText(e.target.value)} autoFocus placeholder={state.options.placeholder} />
                )}
              </Field>
            )}
            <button type="submit" hidden />
          </form>
        </Modal>
      )}
    </DialogContext.Provider>
  );
}

export function useDialogs(): DialogApi {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('DialogProvider fehlt');
  return ctx;
}
