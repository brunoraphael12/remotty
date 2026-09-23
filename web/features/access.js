// Pairing screen: trade the host's one-time code for a device cookie.
import { api } from './api.js';

export function showPairing(onPaired) {
  const form = document.getElementById('pair-form');
  const code = document.getElementById('pair-code');
  const error = document.getElementById('pair-error');
  document.getElementById('pair').hidden = false;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.textContent = '';
    try {
      await api('POST', '/api/pair', {
        code: code.value,
        name: document.getElementById('pair-name').value || guessDeviceName(),
      });
      document.getElementById('pair').hidden = true;
      onPaired();
    } catch (e) {
      error.textContent = e.message;
      code.select();
    }
  });

  // `remotty pair` prints a link with the code in the fragment, which browsers
  // never send to a server or log. Following it pairs in one tap.
  const fromLink = location.hash.slice(1);
  history.replaceState(null, '', location.pathname);
  if (fromLink) {
    code.value = fromLink;
    form.requestSubmit();
  } else {
    code.focus();
  }
}

function guessDeviceName() {
  const ua = navigator.userAgent;
  if (/Android/.test(ua)) return 'Android';
  if (/iPad|iPhone/.test(ua)) return 'iOS';
  return 'browser';
}
