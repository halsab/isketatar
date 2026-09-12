import { HashRouter, Link, Route, Routes } from 'react-router-dom';
import { RecoveryBoundary } from './RecoveryBoundary';

function Start() {
  return <><h1>Иске имля</h1><p>Татарча аңлатмалар белән иске язуны укырга өйрән.</p><Link to="/about">Курс турында</Link></>;
}

export function App() {
  return <RecoveryBoundary><HashRouter>
    <a className="skip-link" href="#main" onClick={event => { event.preventDefault(); document.getElementById('main')?.focus(); }}>Төп эчтәлеккә күчәргә</a>
    <header><Link to="/">Иске имля</Link></header>
    <main id="main" tabIndex={-1}><Routes>
      <Route path="/" element={<Start />} />
      <Route path="/about" element={<><h1>Курс турында</h1><p>Аңлатмалар хәзерге татар телендә бирелә.</p><Link to="/">Баш бит</Link></>} />
      <Route path="*" element={<><h1>Бу бүлек табылмады</h1><Link to="/">Баш бит</Link></>} />
    </Routes></main>
  </HashRouter></RecoveryBoundary>;
}
