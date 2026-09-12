export type IconName = 'lessons' | 'review' | 'reading' | 'dictionary' | 'reference' | 'settings' | 'menu' | 'close' | 'check' | 'warning' | 'arrow';
const paths: Record<IconName, string> = {
  lessons: 'M12 5v15M3 4h5a4 4 0 0 1 4 2 4 4 0 0 1 4-2h5v15h-5a4 4 0 0 0-4 2 4 4 0 0 0-4-2H3Z',
  review: 'M20 7a9 9 0 0 0-15-2L2 8m0-5v5h5M4 17a9 9 0 0 0 15 2l3-3m0 5v-5h-5',
  reading: 'M14 2H5v20h14V7ZM14 2v5h5M8 12h8M8 16h6',
  dictionary: 'M5 3h15v18H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM3 17h17M8 7h8M8 11h5',
  reference: 'M4 3h5v18H4ZM12 3h4l4 17-4 1ZM5 7h3M5 17h3',
  settings: 'm9 3-1 3-3 1-2 3 2 2v3l3 2 1 4h6l1-4 3-2v-3l2-2-2-3-3-1-1-3ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  menu: 'M3 6h18M3 12h18M3 18h18', close: 'm6 6 12 12M6 18 18 6',
  check: 'm5 12 4 4L19 6', warning: 'm12 3 10 18H2ZM12 9v5m0 3v1', arrow: 'M4 12h16m-6-6 6 6-6 6',
};
export function Icon({ name }: { name: IconName }) {
  return <svg className="icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={paths[name]} /></svg>;
}
