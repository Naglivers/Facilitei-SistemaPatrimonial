(() => {
  const isNative = Boolean(window.Capacitor?.isNativePlatform?.());
  if (!isNative) return;

  document.documentElement.classList.add('native-app');

  const browser = window.Capacitor?.Plugins?.Browser;
  const originalOpen = window.open.bind(window);

  window.open = (url, target, features) => {
    if (typeof url === 'string' && /^https?:/i.test(url) && browser?.open) {
      browser.open({ url });
      return null;
    }
    return originalOpen(url, target, features);
  };

  // Mantém links externos (pagamentos, documentos e suporte) no navegador do aparelho.
  document.addEventListener('click', event => {
    const anchor = event.target.closest('a[href]');
    if (!anchor || !/^https?:/i.test(anchor.href)) return;
    event.preventDefault();
    if (browser?.open) browser.open({ url: anchor.href });
    else originalOpen(anchor.href, '_system');
  });
})();
