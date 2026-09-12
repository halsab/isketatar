import './app/installation';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { startApplication } from './app/AppProvider';
import './styles/base.css';

if (!location.hash) history.replaceState(history.state, '', `${location.pathname}${location.search}#/`);
void startApplication();
const root = document.getElementById('root');
if (root) createRoot(root).render(<StrictMode><App /></StrictMode>);
