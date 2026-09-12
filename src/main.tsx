import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './styles/base.css';
import { loadArabicFont } from './ui/arabic-font';

void loadArabicFont();
if (!location.hash) history.replaceState(history.state, '', `${location.pathname}${location.search}#/`);
const root = document.getElementById('root');
if (root) createRoot(root).render(<StrictMode><App /></StrictMode>);
