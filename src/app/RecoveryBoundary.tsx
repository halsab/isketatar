import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

export class RecoveryBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(_error: Error, _info: ErrorInfo) { /* Содержимое ответов не отправляется наружу. */ }
  render() {
    if (this.state.failed) return <main id="main"><h1>Материалны ачып булмады</h1><p>Уку нәтиҗәләре бетерелмәде.</p><a href="./recovery.html">Ярдәм</a></main>;
    return this.props.children;
  }
}
