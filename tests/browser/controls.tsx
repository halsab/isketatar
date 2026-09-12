import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { HashRouter } from 'react-router-dom';
import { AppShell } from '../../src/app/AppShell';
import { ArabicText } from '../../src/ui/ArabicText';
import { Button, ChoiceGroup, SourceCard, Status } from '../../src/ui/controls';
import { Dialog } from '../../src/ui/Dialog';
import { TextAnswer } from '../../src/ui/TextAnswer';
import '../../src/styles/base.css';

function Controls() {
  const [value, setValue] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [submitted, setSubmitted] = useState(0);
  return <HashRouter><AppShell><div className="page-grid"><div className="document">
    <div className="breadcrumbs">Дәресләр / Сузыклар</div>
    <div className="page-heading"><h1>Сузыкларны уку</h1><p className="study-text">Хәрефләрне чагыштыр һәм сүзләрне укы.</p></div>
    <div className="section-links"><a href="#theory">Аңлатма</a><a href="#examples">Мисаллар</a><a href="#practice">Күнегүләр</a></div>
    <h2 id="theory">Уку тәртибе</h2><p className="study-text">Иске язуны укырга өйрәнәбез.</p>
    <section className="example" id="examples"><ArabicText block>كتاب</ArabicText><p>Укылыш: китап</p><p>Мәгънә: китап</p></section>
    <h2 id="practice">Укып кара</h2><TextAnswer identity="fixture" value={value} onChange={setValue} onEnter={() => setSubmitted(count => count + 1)} />
    <div className="actions"><Button variant="primary" onClick={() => setSubmitted(count => count + 1)}>Тикшерергә</Button><Button>Әлегә белмим</Button></div>
    <ChoiceGroup label="Бер җавапны сайла" options={[{id:'a',content:<ArabicText>ۇ</ArabicText>},{id:'b',content:<ArabicText>وُ</ArabicText>}]} selected={selected} onChange={setSelected} />
    <Status announce>Җаваплар: <output id="submitted">{submitted}</output></Status>
    <Button onClick={() => setOpen(true)}>Чыганакны ачарга</Button>
  </div><aside><Dialog context open={open} title="Чыганак" onClose={() => setOpen(false)}><SourceCard title="Язылыш"><ArabicText block>كتاب</ArabicText><label>Билге<input type="text" /></label></SourceCard></Dialog></aside></div></AppShell></HashRouter>;
}
createRoot(document.getElementById('root')!).render(<Controls />);
