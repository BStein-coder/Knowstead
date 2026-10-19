import {
  cloneElement,
  forwardRef,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { NavLink } from 'react-router';
import { AlertCircle, Info, Loader2, TriangleAlert, X, type LucideIcon } from 'lucide-react';
import { useI18n } from '../../i18n';

export { Popover } from './Popover';
export { Menu, type MenuEntry } from './Menu';

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

/* ------------------------------------------------------------------ */
/* Schaltflächen                                                        */
/* ------------------------------------------------------------------ */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  icon?: LucideIcon;
  iconRight?: LucideIcon;
  loading?: boolean;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon: Icon, iconRight: IconRight, loading, block, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx('btn', `btn-${variant}`, size !== 'md' && `btn-${size}`, block && 'btn-block', !children && 'btn-icon-only', className)}
      disabled={disabled || loading}
      aria-label={rest['aria-label'] ?? (!children && typeof rest.title === 'string' ? rest.title : undefined)}
      {...rest}
    >
      {loading ? <Loader2 size={16} className="spin" /> : Icon ? <Icon size={size === 'sm' ? 14 : 16} /> : null}
      {children && <span>{children}</span>}
      {IconRight && <IconRight size={size === 'sm' ? 14 : 16} />}
    </button>
  );
});

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  label: string;
  size?: number;
  active?: boolean;
  variant?: 'ghost' | 'subtle';
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, label, size = 16, active, className, variant = 'ghost', type = 'button', ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} className={cx('icon-btn', `icon-btn-${variant}`, active && 'active', className)} aria-label={label} title={label} {...rest}>
      <Icon size={size} />
    </button>
  );
});

/* ------------------------------------------------------------------ */
/* Formularelemente                                                     */
/* ------------------------------------------------------------------ */

interface FieldProps {
  label?: ReactNode;
  help?: ReactNode;
  error?: string | null;
  required?: boolean;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
  inline?: boolean;
}

export function Field({ label, help, error, required, children, className, htmlFor, inline }: FieldProps) {
  const autoId = useId();
  // Beschriftung mit dem (einzigen) Eingabeelement verknüpfen – für Screenreader und Klick auf das Label.
  const directChild = isValidElement<{ id?: string }>(children) ? children : null;
  const id = htmlFor ?? directChild?.props.id ?? autoId;
  const control = directChild && !directChild.props.id ? cloneElement(directChild, { id }) : children;
  return (
    <div className={cx('field', inline && 'field-inline', error && 'has-error', className)}>
      {label && (
        <label className="field-label" htmlFor={directChild ? id : htmlFor}>
          {label}
          {required && <span className="field-required"> *</span>}
        </label>
      )}
      <div className="field-control">{control}</div>
      {error ? <div className="field-error">{error}</div> : help ? <div className="field-help">{help}</div> : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { icon?: LucideIcon }>(function Input(
  { className, icon: Icon, ...rest },
  ref,
) {
  if (Icon) {
    return (
      <div className={cx('input-with-icon', className)}>
        <Icon size={16} className="input-icon" />
        <input ref={ref} className="input" {...rest} />
      </div>
    );
  }
  return <input ref={ref} className={cx('input', className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cx('input textarea', className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cx('input select', className)} {...rest}>
      {children}
    </select>
  );
});

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  /** Zugänglicher Name, wenn kein sichtbares `label` angezeigt wird */
  ariaLabel?: string;
  id?: string;
}

export function Switch({ checked, onChange, label, description, disabled, ariaLabel, id: idProp }: SwitchProps) {
  const autoId = useId();
  const id = idProp ?? autoId;
  return (
    <label className={cx('switch-row', disabled && 'disabled')} htmlFor={id}>
      <span className="switch">
        <input id={id} type="checkbox" role="switch" checked={checked} disabled={disabled} aria-label={label ? undefined : ariaLabel} onChange={(e) => onChange(e.target.checked)} />
        <span className="switch-track" />
      </span>
      {(label || description) && (
        <span className="switch-text">
          {label && <span className="switch-label">{label}</span>}
          {description && <span className="switch-desc">{description}</span>}
        </span>
      )}
    </label>
  );
}

export function Checkbox({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cx('checkbox-row', disabled && 'disabled')}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label && <span>{label}</span>}
    </label>
  );
}

/* ------------------------------------------------------------------ */
/* Modal                                                                */
/* ------------------------------------------------------------------ */

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  dismissible?: boolean;
  className?: string;
  icon?: LucideIcon;
}

export function Modal({ open, onClose, title, children, footer, size = 'md', dismissible = true, className, icon: Icon }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const { t } = useI18n();

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      // Hat schon etwas im Dialog die Taste verarbeitet (Vorschlagsmenü im Editor), bleibt der Dialog offen
      if (e.key === 'Escape' && dismissible && !e.defaultPrevented) {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('modal-open');
    const timer = window.setTimeout(() => {
      const el = ref.current?.querySelector<HTMLElement>('[autofocus], [data-autofocus], input:not([type=hidden]):not([disabled]), textarea, select');
      el?.focus();
    }, 20);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('modal-open');
      window.clearTimeout(timer);
      prev?.focus?.();
    };
  }, [open, dismissible, onClose]);

  if (!open) return null;
  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && dismissible) onClose();
      }}
    >
      <div ref={ref} className={cx('modal', `modal-${size}`, className)} role="dialog" aria-modal="true" aria-labelledby={title ? titleId : undefined}>
        {title && (
          <div className="modal-header">
            <h2 className="modal-title" id={titleId}>
              {Icon && <Icon size={18} />}
              {title}
            </h2>
            {dismissible && <IconButton icon={X} label={t('common.close')} onClick={onClose} />}
          </div>
        )}
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ */
/* Rückmeldungen                                                        */
/* ------------------------------------------------------------------ */

export function Spinner({ size = 18, className }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={cx('spin', className)} aria-hidden />;
}

export function Loading({ label, inline }: { label?: string; inline?: boolean }) {
  const { t } = useI18n();
  return (
    <div className={cx('loading', inline && 'loading-inline')} role="status">
      <Spinner />
      <span>{label ?? t('common.loading')}</span>
    </div>
  );
}

interface EmptyStateProps {
  icon?: LucideIcon;
  title: ReactNode;
  text?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}

export function EmptyState({ icon: Icon, title, text, action, compact }: EmptyStateProps) {
  return (
    <div className={cx('empty-state', compact && 'compact')}>
      {Icon && (
        <div className="empty-icon">
          <Icon size={compact ? 22 : 32} />
        </div>
      )}
      <div className="empty-title">{title}</div>
      {text && <div className="empty-text">{text}</div>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

export function Alert({ variant = 'info', title, children, action }: { variant?: 'info' | 'warning' | 'error' | 'success'; title?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  const Icon = variant === 'error' ? AlertCircle : variant === 'warning' ? TriangleAlert : Info;
  return (
    <div className={`alert alert-${variant}`} role={variant === 'error' ? 'alert' : undefined}>
      <Icon size={18} className="alert-icon" />
      <div className="alert-body">
        {title && <div className="alert-title">{title}</div>}
        {children && <div className="alert-text">{children}</div>}
      </div>
      {action && <div className="alert-action">{action}</div>}
    </div>
  );
}

export function ErrorView({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useI18n();
  const message = error instanceof Error ? error.message : String(error ?? t('common.errorGeneric'));
  return (
    <div data-error-view>
      <Alert variant="error" title={t('common.error')} action={onRetry && <Button size="sm" onClick={onRetry}>{t('common.retry')}</Button>}>
        {message}
      </Alert>
    </div>
  );
}

export function Badge({ children, color = 'gray', title, className }: { children: ReactNode; color?: string; title?: string; className?: string }) {
  return (
    <span className={cx('badge', `badge-${color}`, className)} title={title}>
      {children}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

/* ------------------------------------------------------------------ */
/* Avatar, Zeit, Tabs                                                   */
/* ------------------------------------------------------------------ */

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Schwarz oder Weiß – je nachdem, was auf der Hintergrundfarbe besser lesbar ist (Kontrast ≥ 4,5 : 1). */
export function readableTextColor(background: string): string {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(background.trim());
  if (!m) return '#fff';
  const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  return 1.05 / (luminance + 0.05) >= 4.5 ? '#fff' : '#0b1220';
}

export function Avatar({ user, size = 28, title }: { user: { displayName: string; avatarColor?: string | null } | null | undefined; size?: number; title?: string }) {
  const name = user?.displayName ?? '?';
  const background = user?.avatarColor ?? '#64748b';
  // Zwei Buchstaben passen erst ab etwa 20 px in den Kreis; in kleineren ragten sie heraus (dunkle Schrift auf dunklem Grund)
  const text = size < 20 ? initials(name).slice(0, 1) : initials(name);
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.4)), background, color: readableTextColor(background) }}
      title={title ?? name}
      role="img"
      aria-label={name}
    >
      {text}
    </span>
  );
}

export function AvatarStack({ users, max = 4, size = 24 }: { users: { id: number; displayName: string; avatarColor?: string | null }[]; max?: number; size?: number }) {
  const shown = users.slice(0, max);
  return (
    <span className="avatar-stack">
      {shown.map((u) => (
        <Avatar key={u.id} user={u} size={size} />
      ))}
      {users.length > max && <span className="avatar avatar-more" style={{ width: size, height: size }}>+{users.length - max}</span>}
    </span>
  );
}

export function Time({ value, mode = 'relative' }: { value: string | null | undefined; mode?: 'relative' | 'date' | 'datetime' }) {
  const { fmt } = useI18n();
  const [, force] = useState(0);
  useEffect(() => {
    if (mode !== 'relative') return;
    const id = window.setInterval(() => force((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, [mode]);
  if (!value) return <span>–</span>;
  const text = mode === 'relative' ? fmt.relative(value) : mode === 'date' ? fmt.date(value) : fmt.dateTime(value);
  return (
    <time dateTime={value} title={fmt.dateTime(value)}>
      {text}
    </time>
  );
}

interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
  icon?: LucideIcon;
  count?: number;
  hidden?: boolean;
}

export function Tabs<T extends string>({ value, onChange, items, className }: { value: T; onChange: (v: T) => void; items: TabItem<T>[]; className?: string }) {
  return (
    <div className={cx('tabs', className)} role="tablist">
      {items
        .filter((i) => !i.hidden)
        .map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.value} type="button" role="tab" aria-selected={value === item.value} className={cx('tab', value === item.value && 'active')} onClick={() => onChange(item.value)}>
              {Icon && <Icon size={15} />}
              {item.label}
              {item.count !== undefined && <span className="tab-count">{item.count}</span>}
            </button>
          );
        })}
    </div>
  );
}

export function TabLinks({ items, className }: { items: { to: string; label: ReactNode; icon?: LucideIcon; end?: boolean; hidden?: boolean }[]; className?: string }) {
  return (
    <nav className={cx('tabs', className)}>
      {items
        .filter((i) => !i.hidden)
        .map((item) => {
          const Icon = item.icon;
          return (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => cx('tab', isActive && 'active')}>
              {Icon && <Icon size={15} />}
              {item.label}
            </NavLink>
          );
        })}
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* Seitenkopf                                                           */
/* ------------------------------------------------------------------ */

export function PageHeader({ title, subtitle, actions, icon: Icon }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; icon?: LucideIcon }) {
  return (
    <div className="page-header">
      <div className="page-header-text">
        <h1 className="page-header-title">
          {Icon && <Icon size={22} className="page-header-icon" />}
          {title}
        </h1>
        {subtitle && <p className="page-header-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </div>
  );
}

export function Card({
  title,
  actions,
  children,
  className,
  padded = true,
  spot,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  padded?: boolean;
  /** Lichtkegel, der dem Zeiger folgt (siehe lib/motion.ts) */
  spot?: boolean;
}) {
  return (
    <section className={cx('card', className)} data-spot={spot ? '' : undefined}>
      {(title || actions) && (
        <div className="card-header">
          {title && <h3 className="card-title">{title}</h3>}
          {actions && <div className="card-actions">{actions}</div>}
        </div>
      )}
      <div className={cx(padded && 'card-body')}>{children}</div>
    </section>
  );
}

/** Kopierbares Feld (z. B. für Tokens). */
export function CopyField({ value, onCopied }: { value: string; onCopied?: () => void }) {
  const { t } = useI18n();
  return (
    <div className="copy-field">
      <code>{value}</code>
      <Button
        size="sm"
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          onCopied?.();
        }}
      >
        {t('common.copy')}
      </Button>
    </div>
  );
}
