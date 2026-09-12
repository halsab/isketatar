import { useEffect, useId, useRef, useState } from 'react';
import { Button } from './controls';
import { t } from './copy';

interface Props {
  identity: string; value: string; onChange: (value: string) => void; segment?: boolean;
  disabled?: boolean; error?: string; onEnter?: () => void; onCompositionChange?: (active: boolean) => void;
}
interface Range { start: number; end: number; direction: 'forward' | 'backward' | 'none' }
export function TextAnswer({ identity, ...props }: Props) { return <AnswerField key={identity} {...props} />; }
function AnswerField({ value, onChange, segment = false, disabled = false, error, onEnter, onCompositionChange }: Omit<Props, 'identity'>) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const range = useRef<Range>({ start: value.length, end: value.length, direction: 'none' });
  const composing = useRef(false);
  const [compositionMessage, setCompositionMessage] = useState(false);
  const [limitError, setLimitError] = useState(false);
  const [undo, setUndo] = useState<{ before: string; after: string; range: Range } | null>(null);
  useEffect(() => { if (undo && value !== undo.after) setUndo(null); }, [value, undo]);
  const remember = () => {
    const field = input.current;
    if (field) range.current = { start: field.selectionStart ?? 0, end: field.selectionEnd ?? 0, direction: field.selectionDirection ?? 'none' };
  };
  function restoreSelection(next: Range) {
    const field = input.current;
    if (!field) return;
    field.focus(); field.scrollIntoView({ block: 'nearest' }); field.setSelectionRange(next.start, next.end, next.direction); range.current = next;
  }
  function insert(letter: string) {
    if (disabled) return;
    if (composing.current) { setCompositionMessage(true); return; }
    const field = input.current;
    if (!field) return;
    if (document.activeElement === field) remember();
    const before = { ...range.current };
    if (value.length - (before.end - before.start) + letter.length > 4096) { setLimitError(true); return; }
    setLimitError(false);
    field.setSelectionRange(before.start, before.end, before.direction);
    field.setRangeText(letter, before.start, before.end, 'end');
    const after = field.value;
    setUndo({ before: value, after, range: before }); onChange(after);
    restoreSelection({ start: before.start + letter.length, end: before.start + letter.length, direction: 'none' });
  }
  return <div className="answer-field">
    <label htmlFor={id}>{t('exercise.answer_placeholder')}</label>
    <input ref={input} id={id} dir="ltr" lang="tt-Cyrl" type="text" value={value} disabled={disabled} maxLength={4096}
      spellCheck={false} autoComplete="off" autoCorrect="off" autoCapitalize="off"
      aria-invalid={!!error || limitError} aria-describedby={`${id}-format${error || limitError ? ` ${id}-error` : ''}${compositionMessage ? ` ${id}-composition` : ''}`}
      onSelect={remember} onBlur={remember} onChange={event => {
        // Blur после setRangeText может повторить change с уже принятым значением.
        if (event.target.value !== value) { setUndo(null); setLimitError(false); onChange(event.target.value); }
        remember();
      }}
      onCompositionStart={() => { composing.current = true; onCompositionChange?.(true); }}
      onCompositionEnd={event => { if (event.currentTarget.value !== value) onChange(event.currentTarget.value); composing.current = false; setCompositionMessage(false); onCompositionChange?.(false); remember(); }}
      onKeyDown={event => {
        if (event.key !== 'Enter' || composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
        event.preventDefault(); if (!disabled) onEnter?.();
      }} />
    <p className="meta muted" id={`${id}-format`}>{t(segment ? 'exercise.segment' : 'exercise.reading')}</p>
    {(error || limitError) && <p className="field-error" id={`${id}-error`}>{error || t('keyboard.answer_limit')}</p>}
    <div className="tatar-keys" role="group" aria-label={t('accessibility.tatar_keyboard')}>
      {['ә', 'ө', 'ү', 'җ', 'ң', 'һ', ...(segment ? ['+'] : [])].map(letter => <Button key={letter} disabled={disabled}
        aria-label={t(letter === '+' ? 'accessibility.insert_segment_separator' : 'accessibility.insert_letter', { letter })}
        preserveFocus onMouseDown={event => { if (event.button === 0) event.preventDefault(); }} onClick={() => insert(letter)}>{letter}</Button>)}
    </div>
    {compositionMessage && <p id={`${id}-composition`} role="status">{t('keyboard.finish_composition')}</p>}
    {undo && value === undo.after && <Button variant="quiet" disabled={disabled} preserveFocus onMouseDown={event => { if (event.button === 0) event.preventDefault(); }} onClick={() => { if (composing.current) { setCompositionMessage(true); return; } const saved = undo; setUndo(null); onChange(saved.before); if (input.current) input.current.value = saved.before; restoreSelection(saved.range); }}>{t('keyboard.undo_insert')}</Button>}
  </div>;
}
