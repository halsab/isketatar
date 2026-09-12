import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { ArabicText, ArabicFontGate } from '../../src/ui/ArabicText';
import { applyPreferences } from '../../src/ui/preferences';
import cases from '../../docs/production/typography-fixtures.json';
import '../../src/styles/base.css';

function Typography() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  return <main><h1>Язылышны тикшерү</h1>
    <button onClick={() => { const next = theme === 'light' ? 'dark' : 'light'; setTheme(next); applyPreferences({ theme: next, text_size_px: 24, arabic_size_px: 48, reduced_motion: 'reduce' }); }}>Төсне алыштырырга</button>
    <div className="prose"><p>Әә Өө Үү Җҗ Ңң Һһ</p>
      {cases.cases.filter(item => item.lang === 'tt-Arab').map(item => <section key={item.id} data-case={item.id}><h2>{item.id}</h2><ArabicText block>{item.text}</ArabicText></section>)}
      <p data-case="BI-01">Мисал (<ArabicText>كوُموُش</ArabicText>): көмеш — 2 нче сүз.</p>
      <p data-case="BI-02"><ArabicText>عالم</ArabicText> — галим; <ArabicText>عالم</ArabicText> — галәм.</p>
      <ArabicFontGate><button id="graded-action">Тикшерергә</button></ArabicFontGate>
    </div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Typography />);
