import { HashRouter, Link, Route, Routes } from 'react-router-dom';
import { RecoveryBoundary } from './RecoveryBoundary';
import { AppShell } from './AppShell';
import { AppProvider, RuntimeStatus } from './AppProvider';
import { StartPage } from '../features/onboarding/StartPage';
import { t } from '../ui/copy';

function Start() {
  return <><h1>{t('app.name')}</h1><p className="study-text">{t('app.tagline')}</p><div className="actions"><Link className="button primary" to="/start">{t('action.start')}</Link><Link to="/about">Курс турында</Link></div></>;
}

export function App() {
  return <RecoveryBoundary><HashRouter><AppProvider>
    <AppShell status={<RuntimeStatus />}><div className="document"><Routes>
      <Route path="/" element={<Start />} />
      <Route path="/start" element={<StartPage />} />
      <Route path="/about" element={<><h1>Курс турында</h1><p>Аңлатмалар хәзерге татар телендә бирелә.</p><Link to="/">Баш бит</Link></>} />
      <Route path="*" element={<><h1>Бу бүлек табылмады</h1><Link to="/">Баш бит</Link></>} />
    </Routes></div></AppShell>
  </AppProvider></HashRouter></RecoveryBoundary>;
}
