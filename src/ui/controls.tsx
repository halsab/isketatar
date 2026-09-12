import { useId, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export function Button({ variant = 'secondary', busy = false, className = '', disabled, onClick, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'quiet' | 'danger'; busy?: boolean }) {
  return <button type="button" {...props} className={`button ${variant} ${className}`} disabled={disabled} aria-disabled={busy || disabled || undefined} aria-busy={busy || undefined} onClick={event => { if (busy || disabled) event.preventDefault(); else onClick?.(event); }} />;
}
export function IconButton({ icon, label, ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'> & { icon: IconName; label: string }) {
  return <Button {...props} className={`icon-button ${props.className ?? ''}`} aria-label={label}><Icon name={icon} /></Button>;
}
export function ChoiceGroup({ label, multiple = false, options, selected, onChange, disabled = false }: {
  label: string; multiple?: boolean; options: { id: string; content: ReactNode }[];
  selected: string[]; onChange: (ids: string[]) => void; disabled?: boolean;
}) {
  const name = useId();
  return <fieldset className="choice-group" disabled={disabled}><legend>{label}</legend>{options.map(option =>
    <label className="choice" key={option.id} data-selected={selected.includes(option.id)}>
      <input type={multiple ? 'checkbox' : 'radio'} name={name} value={option.id} checked={selected.includes(option.id)} onChange={event => onChange(multiple ? event.target.checked ? [...selected, option.id] : selected.filter(id => id !== option.id) : [option.id])} />
      <span>{option.content}</span>
    </label>)}
  </fieldset>;
}
export function Status({ children, tone = 'neutral', announce = false }: { children: ReactNode; tone?: 'neutral' | 'success' | 'error' | 'warning'; announce?: boolean }) {
  return <div className={`status ${tone}`} role={announce ? tone === 'error' ? 'alert' : 'status' : undefined}>
    {tone !== 'neutral' && <Icon name={tone === 'success' ? 'check' : 'warning'} />}<div>{children}</div>
  </div>;
}
export function SourceCard({ title, children }: { title: string; children: ReactNode }) {
  return <section className="source-card"><h3>{title}</h3>{children}</section>;
}
export function Table({ caption, children }: { caption: string; children: ReactNode }) {
  const id = useId();
  return <div className="table-scroll" role="region" aria-labelledby={id} tabIndex={0}><table><caption id={id}>{caption}</caption>{children}</table></div>;
}
