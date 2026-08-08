// Invoice dashboard for the Pathao Courier merchant integration.
// Talks to the local Express API in src/routes, never to Pathao directly.

const state = {
  tab: 'invoices',
  search: '',
  totals: null,
};

const els = {
  stats: document.getElementById('stats'),
  panel: document.getElementById('panel'),
  notice: document.getElementById('syncNotice'),
  search: document.getElementById('search'),
  syncBtn: document.getElementById('syncBtn'),
  importBtn: document.getElementById('importBtn'),
  importAllBtn: document.getElementById('importAllBtn'),
  baseUrl: document.getElementById('baseUrl'),
  drawer: document.getElementById('drawer'),
  drawerTitle: document.getElementById('drawerTitle'),
  drawerContent: document.getElementById('drawerContent'),
};

// ------------------------------------------------------------------ helpers

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Request failed (${response.status})`);
  }
  return payload;
}

const taka = new Intl.NumberFormat('en-BD', {
  style: 'currency',
  currency: 'BDT',
  maximumFractionDigits: 2,
});

function money(value) {
  return taka.format(Number(value ?? 0));
}

function esc(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
}

function when(value) {
  if (!value) return '—';
  // Pathao returns "YYYY-MM-DD HH:mm:ss"; make it parseable across browsers.
  const date = new Date(String(value).replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? esc(value) : date.toLocaleString();
}

function statusChip(status) {
  const label = status || 'Unknown';
  const normalized = label.toLowerCase();
  let variant = 'chip-neutral';
  if (normalized.includes('deliver') && !normalized.includes('fail')) variant = 'chip-ok';
  else if (normalized.includes('return') || normalized.includes('fail')) variant = 'chip-danger';
  else if (
    normalized.includes('transit') ||
    normalized.includes('pending') ||
    normalized.includes('pickup') ||
    normalized.includes('hub')
  ) {
    variant = 'chip-warn';
  }
  return `<span class="chip ${variant}">${esc(label.replace(/_/g, ' '))}</span>`;
}

function flash(message, variant = 'is-ok') {
  els.notice.className = `notice ${variant}`;
  els.notice.textContent = message;
  els.notice.hidden = false;
}

/** Return rate as text, with the ratio it came from. Null means nothing settled. */
function percent(value) {
  return value === null || value === undefined ? '—' : `${value.toFixed(1)}%`;
}

/** Low return rates read green, high ones red — the thresholds are advisory. */
function rateChip(rate, settled) {
  if (rate === null || rate === undefined || !settled) {
    return '<span class="chip chip-neutral">no settled parcels</span>';
  }
  const variant = rate >= 30 ? 'chip-danger' : rate >= 15 ? 'chip-warn' : 'chip-ok';
  return `<span class="chip ${variant}">${percent(rate)}</span>`;
}

function emptyState(title, body) {
  return `<div class="empty"><h3>${esc(title)}</h3><p>${body}</p></div>`;
}

// ------------------------------------------------------------------- render

async function renderStats() {
  const { data } = await api('/api/invoices/summary');
  state.totals = data;
  els.stats.innerHTML = `
    <div class="stat">
      <div class="stat-label">Invoices</div>
      <div class="stat-value">${data.invoice_count}</div>
      <div class="stat-sub">${data.invoiced_order_count} consignment(s) invoiced</div>
    </div>
    <div class="stat">
      <div class="stat-label">Collected (COD)</div>
      <div class="stat-value">${money(data.total_collected)}</div>
      <div class="stat-sub">across all invoices</div>
    </div>
    <div class="stat">
      <div class="stat-label">Delivery fees</div>
      <div class="stat-value">${money(data.total_delivery_fee)}</div>
      <div class="stat-sub">charged by Pathao</div>
    </div>
    <div class="stat">
      <div class="stat-label">Net payable</div>
      <div class="stat-value is-accent">${money(data.net_payable)}</div>
      <div class="stat-sub">collected minus fees</div>
    </div>
    <div class="stat">
      <div class="stat-label">Awaiting invoice</div>
      <div class="stat-value">${data.uninvoiced_order_count}</div>
      <div class="stat-sub">tracked, not yet invoiced</div>
    </div>
    <div class="stat" title="Returned ÷ (delivered + returned), across forward consignments that reached a final outcome. Return and exchange legs, in-flight parcels and pickup failures are excluded.">
      <div class="stat-label">Return rate</div>
      <div class="stat-value ${data.return_rate >= 30 ? 'is-accent' : ''}">${percent(data.return_rate)}</div>
      <div class="stat-sub">${data.settled_returned_count} returned of ${data.settled_count} settled</div>
    </div>`;
}

async function renderInvoices() {
  const query = state.search ? `?search=${encodeURIComponent(state.search)}` : '';
  const { data } = await api(`/api/invoices${query}`);

  if (data.length === 0) {
    els.panel.innerHTML = emptyState(
      state.search ? 'No invoices match that search' : 'No invoices yet',
      state.search
        ? 'Try a different invoice id, consignment id or merchant order id.'
        : 'Pathao assigns an <code>invoice_id</code> to a consignment once it has been billed. Track your orders, then press <strong>Sync from Pathao</strong> — invoices appear here as soon as Pathao attaches one.',
    );
    return;
  }

  els.panel.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Invoice</th>
          <th>Orders</th>
          <th>Breakdown</th>
          <th class="num">Return rate</th>
          <th class="num">Collected</th>
          <th class="num">Delivery fee</th>
          <th class="num">Net payable</th>
          <th>Last update</th>
        </tr>
      </thead>
      <tbody>
        ${data
          .map(
            (invoice) => `
          <tr class="is-clickable" data-invoice="${esc(invoice.invoice_id)}">
            <td class="mono">${esc(invoice.invoice_id)}</td>
            <td class="num">${invoice.order_count}</td>
            <td>
              <div class="chip-row">
                ${invoice.delivered_count ? `<span class="chip chip-ok">${invoice.delivered_count} delivered</span>` : ''}
                ${invoice.in_transit_count ? `<span class="chip chip-warn">${invoice.in_transit_count} in transit</span>` : ''}
                ${invoice.returned_count ? `<span class="chip chip-danger">${invoice.returned_count} returned</span>` : ''}
              </div>
            </td>
            <td class="num">
              ${rateChip(invoice.return_rate, invoice.settled_count)}
              <div class="sub">${invoice.settled_returned_count} of ${invoice.settled_count} settled</div>
            </td>
            <td class="num">${money(invoice.total_collected)}</td>
            <td class="num">${money(invoice.total_delivery_fee)}</td>
            <td class="num"><strong>${money(invoice.net_payable)}</strong></td>
            <td class="muted">${when(invoice.last_updated_at)}</td>
          </tr>`,
          )
          .join('')}
      </tbody>
    </table>`;

  els.panel.querySelectorAll('tr[data-invoice]').forEach((row) => {
    row.addEventListener('click', () => openInvoice(row.dataset.invoice));
  });
}

/** `showInvoice` is off inside the invoice drawer, where every row shares one. */
function orderTable(orders, { showInvoice = true } = {}) {
  return `
    <table>
      <thead>
        <tr>
          <th>Consignment</th>
          <th>Recipient</th>
          <th>Status</th>
          <th class="num">Collect</th>
          <th class="num">Fee</th>
          ${showInvoice ? '<th>Invoice</th>' : ''}
          <th>Updated</th>
        </tr>
      </thead>
      <tbody>
        ${orders
          .map(
            (order) => `
          <tr>
            <td>
              <div class="mono">${esc(order.consignment_id)}</div>
              ${order.merchant_order_id ? `<div class="sub">order ${esc(order.merchant_order_id)}</div>` : ''}
            </td>
            <td>
              ${esc(order.recipient_name || '—')}
              ${order.recipient_phone ? `<div class="sub mono">${esc(order.recipient_phone)}</div>` : ''}
            </td>
            <td>${statusChip(order.order_status_slug || order.order_status)}</td>
            <td class="num">${money(order.amount_to_collect)}</td>
            <td class="num">${money(order.delivery_fee)}</td>
            ${
              showInvoice
                ? `<td class="mono">${order.invoice_id ? esc(order.invoice_id) : '<span class="muted">—</span>'}</td>`
                : ''
            }
            <td class="muted">${when(order.pathao_updated_at || order.last_synced_at)}</td>
          </tr>`,
          )
          .join('')}
      </tbody>
    </table>`;
}

async function renderOrders({ invoiced }) {
  const params = new URLSearchParams();
  if (state.search) params.set('search', state.search);
  if (invoiced !== undefined) params.set('invoiced', String(invoiced));
  const { data } = await api(`/api/orders?${params}`);

  if (data.length === 0) {
    els.panel.innerHTML =
      invoiced === false
        ? emptyState(
            'Nothing awaiting an invoice',
            'Every tracked consignment already carries an invoice id — or nothing is tracked yet.',
          )
        : emptyState(
            'No tracked orders',
            'Create an order through <code>POST /api/orders</code>, or press <strong>Track a consignment</strong> to pull in one that was created elsewhere.',
          );
    return;
  }

  els.panel.innerHTML = orderTable(data);
}

async function openInvoice(invoiceId) {
  const { data } = await api(`/api/invoices/${encodeURIComponent(invoiceId)}`);
  els.drawerTitle.textContent = `Invoice ${data.invoice_id}`;
  els.drawerContent.innerHTML = `
    <section class="stats">
      <div class="stat">
        <div class="stat-label">Consignments</div>
        <div class="stat-value">${data.order_count}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Collected</div>
        <div class="stat-value">${money(data.total_collected)}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Delivery fees</div>
        <div class="stat-value">${money(data.total_delivery_fee)}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Net payable</div>
        <div class="stat-value is-accent">${money(data.net_payable)}</div>
      </div>
      <div class="stat" title="Returned ÷ (delivered + returned) within this invoice. Return and exchange legs, in-flight parcels and pickup failures are excluded.">
        <div class="stat-label">Return rate</div>
        <div class="stat-value">${percent(data.return_rate)}</div>
        <div class="stat-sub">
          ${data.settled_returned_count} returned, ${data.settled_delivered_count} delivered
        </div>
      </div>
    </section>
    <div class="panel">${orderTable(data.orders, { showInvoice: false })}</div>`;
  els.drawer.hidden = false;
}

async function render() {
  els.panel.innerHTML = '<div class="empty">Loading…</div>';
  try {
    await renderStats();
    if (state.tab === 'invoices') await renderInvoices();
    else if (state.tab === 'unbilled') await renderOrders({ invoiced: false });
    else await renderOrders({});
  } catch (error) {
    els.panel.innerHTML = emptyState('Could not load data', esc(error.message));
  }
}

// ------------------------------------------------------------------- events

els.syncBtn.addEventListener('click', async () => {
  els.syncBtn.disabled = true;
  els.syncBtn.textContent = 'Syncing…';
  try {
    const { data } = await api('/api/sync', { method: 'POST', body: JSON.stringify({}) });
    const failed = data.failures.length;
    flash(
      `Checked ${data.checked} consignment(s): ${data.updated} updated, ${data.newlyInvoiced} newly invoiced` +
        (failed ? `, ${failed} failed.` : '.'),
      failed ? 'is-error' : 'is-ok',
    );
    await render();
  } catch (error) {
    flash(error.message, 'is-error');
  } finally {
    els.syncBtn.disabled = false;
    els.syncBtn.textContent = 'Sync from Pathao';
  }
});

els.importAllBtn.addEventListener('click', async () => {
  els.importAllBtn.disabled = true;
  els.importAllBtn.textContent = 'Importing…';
  try {
    const { data } = await api('/api/orders/import-all', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    flash(
      `Imported ${data.fetched} order(s) across ${data.pages} page(s) — ${data.invoiced} already invoiced.`,
    );
    await render();
  } catch (error) {
    flash(error.message, 'is-error');
  } finally {
    els.importAllBtn.disabled = false;
    els.importAllBtn.textContent = 'Import all from Pathao';
  }
});

els.importBtn.addEventListener('click', async () => {
  const input = prompt(
    'Consignment id(s) to track, comma-separated.\n' +
      'Pathao returns no amounts for an existing consignment, so add them as\n' +
      'id:collect:fee if you want it valued on its invoice — e.g. DT1234:900:80',
  );
  if (!input) return;

  const entries = input
    .split(',')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [id, collect, fee] = chunk.split(':').map((part) => part.trim());
      if (!collect && !fee) return id;
      return {
        consignment_id: id,
        ...(collect ? { amount_to_collect: Number(collect) } : {}),
        ...(fee ? { delivery_fee: Number(fee) } : {}),
      };
    });

  try {
    const { meta } = await api('/api/orders/import', {
      method: 'POST',
      body: JSON.stringify({ consignment_ids: entries }),
    });
    flash(
      `Tracked ${meta.imported} consignment(s)` + (meta.failed ? `, ${meta.failed} failed.` : '.'),
      meta.failed ? 'is-error' : 'is-ok',
    );
    await render();
  } catch (error) {
    flash(error.message, 'is-error');
  }
});

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((other) => other.classList.remove('is-active'));
    tab.classList.add('is-active');
    state.tab = tab.dataset.tab;
    render();
  });
});

let searchTimer;
els.search.addEventListener('input', (event) => {
  clearTimeout(searchTimer);
  const value = event.target.value.trim();
  searchTimer = setTimeout(() => {
    state.search = value;
    render();
  }, 250);
});

els.drawer.addEventListener('click', (event) => {
  if (event.target.hasAttribute('data-close')) els.drawer.hidden = true;
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') els.drawer.hidden = true;
});

// --------------------------------------------------------------------- boot

api('/api/health')
  .then(({ base_url: baseUrl, tracked_orders: tracked }) => {
    els.baseUrl.textContent = `${baseUrl} · ${tracked} order(s) tracked`;
  })
  .catch(() => {
    els.baseUrl.textContent = 'server unreachable';
  });

render();
