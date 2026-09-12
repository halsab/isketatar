let identity: Promise<string> | undefined;

export function tabIdentity(): Promise<string> {
  identity ??= acquireIdentity();
  return identity;
}
async function acquireIdentity(): Promise<string> {
  if (!navigator.locks) return crypto.randomUUID();
  let saved: string | null = null;
  try { saved = sessionStorage.getItem('iske-imla-tab'); } catch { /* Без sessionStorage перезагрузка требует явного takeover. */ }
  const candidate = saved && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(saved) ? saved : crypto.randomUUID();
  try {
    for (const id of [candidate, crypto.randomUUID()]) {
      const acquired = await new Promise<boolean>((resolve, reject) => {
        // Блокировка удерживается документом; дублированная вкладка не наследует полномочия.
        void navigator.locks.request(`iske-imla-tab:${id}`, { ifAvailable: true }, async lock => {
          resolve(!!lock);
          if (lock) await new Promise<void>(() => {});
        }).catch(reject);
      });
      if (acquired) { try { sessionStorage.setItem('iske-imla-tab', id); } catch { /* ID остаётся уникальным для документа. */ } return id; }
    }
  } catch { /* Недоступная блокировка запрещает повторное использование сохранённого ID. */ }
  return crypto.randomUUID();
}
