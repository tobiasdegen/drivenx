/** Keep the active theme in sync with OS appearance while System is selected.
 * Returns an unsubscribe function. No listener is needed for explicit themes.
 */
/**
 * @param {'dark' | 'light' | 'system'} preference
 * @param {(theme: 'dark' | 'light') => void} onChange
 * @param {(query: string) => Pick<MediaQueryList, 'matches' | 'addEventListener' | 'removeEventListener'>} matchMedia
 * @returns {() => void}
 */
export function watchSystemTheme(preference, onChange, matchMedia) {
  if (preference !== 'system') {
    onChange(preference === 'light' ? 'light' : 'dark');
    return () => {};
  }
  const query = matchMedia('(prefers-color-scheme: dark)');
  const update = () => onChange(query.matches ? 'dark' : 'light');
  query.addEventListener('change', update);
  update();
  return () => query.removeEventListener('change', update);
}
