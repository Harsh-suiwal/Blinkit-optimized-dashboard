const form = document.getElementById('loginForm');
const errorEl = document.getElementById('loginError');
const btn = document.getElementById('loginBtn');
const btnText = document.getElementById('loginBtnText');
const spinner = document.getElementById('loginSpinner');

// If already logged in, redirect straight to dashboard
(async () => {
  try {
    const res = await fetch('/api/me');
    if (res.ok) {
      window.location.href = '/app/';
    }
  } catch (_) { /* not logged in, stay on login page */ }
})();

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.style.display = 'none';
  btn.disabled = true;
  btnText.textContent = 'Signing in…';
  spinner.style.display = 'inline-block';

  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Login failed');
    }

    // Success — redirect to dashboard
    window.location.href = '/app/';
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btnText.textContent = 'Sign In';
    spinner.style.display = 'none';
  }
});
