/**
 * Vercel Geist aesthetic Device Authorization HTML page renderer.
 */
export function renderDevicePage(params: {
  userCode?: string;
  clientMetadata?: {
    cliVersion?: string;
    nodeVersion?: string;
    platform?: string;
    arch?: string;
    ip?: string;
    location?: string;
    timestamp?: string;
  };
  currentUserEmail?: string;
  csrfToken: string;
  error?: string;
  success?: boolean;
}): string {
  const code = (params.userCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const part1 = code.slice(0, 4);
  const part2 = code.slice(4, 8);

  const meta = params.clientMetadata || {};
  const cliText = `ZIMBI CLI zimbi ${meta.cliVersion || '0.1.0'} node-${meta.nodeVersion || 'v20.11.1'} ${meta.platform || 'linux'} (${meta.arch || 'x64'})`;
  const locationText = meta.location || 'Local Development Environment';
  const timeText = meta.timestamp || new Date().toUTCString().replace(/^[A-Za-z]+, /, '').replace(/ GMT$/, ' UTC');
  const ipText = meta.ip || '127.0.0.1';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authorize Device – ZIMBI</title>
  <style>
    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Inter, sans-serif;
      background-color: #ffffff;
      color: #000000;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px 16px;
      -webkit-font-smoothing: antialiased;
    }
    .container {
      width: 100%;
      max-width: 480px;
      margin: 0 auto;
      text-align: center;
    }
    .title {
      font-size: 26px;
      font-weight: 700;
      letter-spacing: -0.03em;
      margin-bottom: 24px;
      color: #111111;
    }
    .code-grid {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      margin-bottom: 28px;
    }
    .char-box {
      width: 40px;
      height: 48px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: #fafafa;
      border: 1px solid #e5e5e5;
      border-radius: 8px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 18px;
      font-weight: 600;
      color: #111111;
      text-transform: uppercase;
      box-shadow: 0 1px 2px rgba(0,0,0,0.02);
    }
    .char-dash {
      font-size: 18px;
      color: #999999;
      margin: 0 4px;
      font-weight: 500;
    }
    .card {
      background: #ffffff;
      border: 1px solid #eaeaea;
      border-radius: 10px;
      padding: 20px;
      text-align: left;
      margin-bottom: 20px;
      box-shadow: 0 2px 6px rgba(0,0,0,0.03);
    }
    .meta-row {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 12px;
      font-size: 14px;
      color: #444444;
    }
    .meta-row:last-child {
      margin-bottom: 0;
    }
    .meta-row.header {
      font-weight: 600;
      color: #111111;
      padding-bottom: 12px;
      border-bottom: 1px solid #f2f2f2;
      margin-bottom: 14px;
    }
    .icon {
      width: 16px;
      height: 16px;
      stroke-width: 2;
      stroke: #666666;
      fill: none;
      flex-shrink: 0;
    }
    .header-icon {
      width: 18px;
      height: 18px;
      background: #000000;
      color: #ffffff;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      font-weight: 900;
      flex-shrink: 0;
    }
    .form-group {
      margin-bottom: 16px;
      text-align: left;
    }
    .label {
      display: block;
      font-size: 13px;
      font-weight: 500;
      margin-bottom: 6px;
      color: #444444;
    }
    .input {
      width: 100%;
      padding: 11px 14px;
      border: 1px solid #e1e1e1;
      border-radius: 6px;
      font-size: 14px;
      color: #111111;
      background: #fafafa;
      transition: all 0.15s ease;
    }
    .input:focus {
      outline: none;
      background: #ffffff;
      border-color: #000000;
      box-shadow: 0 0 0 1px #000000;
    }
    .btn-primary {
      width: 100%;
      padding: 12px 18px;
      background: #000000;
      color: #ffffff;
      border: none;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s ease;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .btn-primary:hover {
      background: #222222;
    }
    .btn-secondary {
      display: inline-block;
      margin-top: 14px;
      font-size: 13px;
      color: #666666;
      text-decoration: none;
    }
    .btn-secondary:hover {
      color: #111111;
      text-decoration: underline;
    }
    .alert-error {
      background: #fff5f5;
      border: 1px solid #fed7d7;
      color: #c53030;
      padding: 12px 16px;
      border-radius: 6px;
      font-size: 13px;
      margin-bottom: 20px;
      text-align: left;
    }
    .success-box {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 32px 24px;
      text-align: center;
      box-shadow: 0 4px 12px rgba(0,0,0,0.04);
    }
    .success-icon {
      width: 48px;
      height: 48px;
      background: #000000;
      color: #ffffff;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 16px;
      font-size: 22px;
    }
    .success-title {
      font-size: 20px;
      font-weight: 700;
      margin-bottom: 8px;
    }
    .success-desc {
      font-size: 14px;
      color: #666666;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <div class="container">
    ${
      params.success
        ? `
      <div class="success-box">
        <div class="success-icon">✓</div>
        <h2 class="success-title">Device Authorized</h2>
        <p class="success-desc">
          Your CLI has been securely authenticated as <strong>${params.currentUserEmail || 'developer'}</strong>.<br><br>
          You can now close this window and return to your terminal.
        </p>
      </div>
      `
        : `
      <h1 class="title">Authorize Device</h1>

      <div class="code-grid">
        ${(part1 || '    ')
          .split('')
          .map((ch) => `<span class="char-box">${ch.trim() || '&nbsp;'}</span>`)
          .join('')}
        <span class="char-dash">—</span>
        ${(part2 || '    ')
          .split('')
          .map((ch) => `<span class="char-box">${ch.trim() || '&nbsp;'}</span>`)
          .join('')}
      </div>

      ${params.error ? `<div class="alert-error">${params.error}</div>` : ''}

      <div class="card">
        <div class="meta-row header">
          <div class="header-icon">▲</div>
          <div>${cliText}</div>
        </div>
        <div class="meta-row">
          <svg class="icon" viewBox="0 0 24 24" stroke="currentColor">
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z"/>
          </svg>
          <div>${locationText}</div>
        </div>
        <div class="meta-row">
          <svg class="icon" viewBox="0 0 24 24" stroke="currentColor">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
          <div>${timeText}</div>
        </div>
        <div class="meta-row">
          <svg class="icon" viewBox="0 0 24 24" stroke="currentColor">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
            <line x1="8" y1="21" x2="16" y2="21"/>
            <line x1="12" y1="17" x2="12" y2="21"/>
          </svg>
          <div>${ipText}</div>
        </div>
      </div>

      <form method="POST" action="/v1/auth/device/verify">
        <input type="hidden" name="userCode" value="${params.userCode || ''}" />
        <input type="hidden" name="csrfToken" value="${params.csrfToken}" />

        ${
          !code
            ? `
          <div class="form-group">
            <label class="label" for="manualCode">Confirmation Code</label>
            <input class="input" id="manualCode" name="manualCode" placeholder="e.g. L7QK-DM2P" required autofocus />
          </div>
          `
            : ''
        }

        <div class="form-group">
          <label class="label" for="email">Developer Email</label>
          <input
            class="input"
            id="email"
            name="email"
            type="email"
            placeholder="you@company.com"
            value="${params.currentUserEmail || ''}"
            required
            ${params.currentUserEmail ? 'readonly' : ''}
          />
        </div>

        <button type="submit" class="btn-primary">
          ${params.currentUserEmail ? `Authorize as ${params.currentUserEmail}` : 'Sign In & Authorize'}
        </button>
      </form>

      <a href="https://zimbi.dev" class="btn-secondary">Cancel</a>
    `
    }
  </div>
</body>
</html>`;
}
