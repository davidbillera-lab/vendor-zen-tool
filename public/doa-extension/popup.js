const SUPABASE_URL = 'https://mwspcagajlkanpfdbuqc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im13c3BjYWdhamxrYW5wZmRidXFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU0MDc5MDMsImV4cCI6MjA4MDk4MzkwM30.4vLWGmxgUZAUZtX-o5SGEz_2R8uRiI-Se-5ssf3xwfc';

let accessToken = null;
let currentBatchId = null;
let pendingLots = [];
let currentLotIndex = 0;
let totalLots = 0;

// DOM elements
const loginSection = document.getElementById('login-section');
const batchSection = document.getElementById('batch-section');
const fillSection = document.getElementById('fill-section');

async function supabaseRequest(path, options = {}) {
  const headers = {
    'apikey': SUPABASE_ANON_KEY,
    'Content-Type': 'application/json',
    ...options.headers,
  };
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }
  const res = await fetch(`${SUPABASE_URL}${path}`, { ...options, headers });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// Initialize
async function init() {
  const stored = await chrome.storage.local.get(['accessToken', 'refreshToken']);
  if (stored.accessToken) {
    accessToken = stored.accessToken;
    try {
      // Verify token is still valid
      await supabaseRequest('/rest/v1/la_batches?select=id&limit=1');
      showBatchSection();
    } catch {
      // Token expired, try refresh
      if (stored.refreshToken) {
        try {
          const data = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
            method: 'POST',
            headers: { 'apikey': SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: stored.refreshToken }),
          }).then(r => r.json());
          if (data.access_token) {
            accessToken = data.access_token;
            await chrome.storage.local.set({ accessToken: data.access_token, refreshToken: data.refresh_token });
            showBatchSection();
            return;
          }
        } catch {}
      }
      showLoginSection();
    }
  } else {
    showLoginSection();
  }
}

function showLoginSection() {
  loginSection.classList.add('show');
  batchSection.classList.remove('show');
  fillSection.classList.remove('show');
}

async function showBatchSection() {
  loginSection.classList.remove('show');
  batchSection.classList.add('show');
  fillSection.classList.remove('show');
  await loadBatches();
}

function showFillSection() {
  loginSection.classList.remove('show');
  batchSection.classList.remove('show');
  fillSection.classList.add('show');
  updateFillUI();
}

// Login
document.getElementById('login-btn').addEventListener('click', async () => {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const btn = document.getElementById('login-btn');
  btn.textContent = 'Connecting...';
  btn.disabled = true;

  try {
    const data = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }).then(r => r.json());

    if (data.access_token) {
      accessToken = data.access_token;
      await chrome.storage.local.set({ accessToken: data.access_token, refreshToken: data.refresh_token });
      showBatchSection();
    } else {
      alert('Login failed: ' + (data.error_description || data.msg || 'Invalid credentials'));
    }
  } catch (err) {
    alert('Connection error: ' + err.message);
  } finally {
    btn.textContent = 'Connect to ResaleHub';
    btn.disabled = false;
  }
});

// Load batches with denver platform tag
async function loadBatches() {
  const select = document.getElementById('batch-select');
  select.innerHTML = '<option value="">Loading...</option>';
  try {
    const batches = await supabaseRequest('/rest/v1/la_batches?select=id,name,lot_count,platforms&is_active=eq.true&order=created_at.desc');
    const denverBatches = batches.filter(b => b.platforms && b.platforms.includes('denver'));
    select.innerHTML = denverBatches.length
      ? denverBatches.map(b => `<option value="${b.id}">${b.name} (${b.lot_count} lots)</option>`).join('')
      : '<option value="">No Denver batches found</option>';
  } catch (err) {
    select.innerHTML = '<option value="">Error loading batches</option>';
  }
}

// Load batch lots
document.getElementById('load-batch-btn').addEventListener('click', async () => {
  currentBatchId = document.getElementById('batch-select').value;
  if (!currentBatchId) return;
  const btn = document.getElementById('load-batch-btn');
  btn.textContent = 'Loading lots...';
  btn.disabled = true;
  try {
    const lots = await supabaseRequest(
      `/rest/v1/denver_batch_rows?batch_id=eq.${currentBatchId}&order=lot_number.asc&select=*`
    );
    pendingLots = lots.filter(l => l.status === 'pending');
    totalLots = lots.length;
    currentLotIndex = 0;
    if (pendingLots.length === 0) {
      alert('No pending lots in this batch. All lots may already be completed.');
    } else {
      showFillSection();
    }
  } catch (err) {
    alert('Error loading lots: ' + err.message);
  } finally {
    btn.textContent = 'Load Batch';
    btn.disabled = false;
  }
});

// Update fill UI
function updateFillUI() {
  if (currentLotIndex >= pendingLots.length) {
    document.getElementById('fill-status').textContent = '🎉 All lots filled!';
    document.getElementById('fill-status').className = 'status connected';
    document.getElementById('fill-btn').disabled = true;
    document.getElementById('skip-btn').disabled = true;
    return;
  }
  const lot = pendingLots[currentLotIndex];
  document.getElementById('lot-num').textContent = lot.lot_number;
  document.getElementById('lot-title').textContent = (lot.title || '').substring(0, 40) + ((lot.title || '').length > 40 ? '...' : '');
  document.getElementById('lot-bid').textContent = '$' + (lot.starting_bid || 5);
  document.getElementById('lot-images').textContent = (lot.image_urls || []).length + ' photos';

  const completed = totalLots - pendingLots.length + currentLotIndex;
  const pct = Math.round((completed / totalLots) * 100);
  document.getElementById('progress-fill').style.width = pct + '%';
  document.getElementById('progress-text').textContent = `${completed} / ${totalLots} lots (${pendingLots.length - currentLotIndex} remaining)`;
  document.getElementById('fill-status').textContent = `Ready to fill Lot #${lot.lot_number}`;
  document.getElementById('fill-status').className = 'status info';
}

// Fill current lot
document.getElementById('fill-btn').addEventListener('click', async () => {
  if (currentLotIndex >= pendingLots.length) return;
  const lot = pendingLots[currentLotIndex];
  const btn = document.getElementById('fill-btn');
  btn.textContent = '⏳ Filling...';
  btn.disabled = true;

  try {
    // Send lot data to content script
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url.includes('denveronlineauctions.com/sub-admin/EditAuction')) {
      alert('Please navigate to a DOA EditAuction page first!');
      return;
    }

    const response = await chrome.tabs.sendMessage(tab.id, {
      action: 'fillLot',
      lot: {
        title: lot.title,
        description: lot.description || '',
        startingBid: lot.starting_bid || 5,
        lotNumber: lot.lot_number,
        imageUrls: lot.image_urls || [],
      }
    });

    if (response && response.success) {
      // Mark lot as completed in Supabase
      await supabaseRequest(`/rest/v1/denver_batch_rows?id=eq.${lot.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'completed' }),
      });
      document.getElementById('fill-status').textContent = `✓ Lot #${lot.lot_number} filled! Click "Save & Edit Next" on DOA, then fill next.`;
      document.getElementById('fill-status').className = 'status connected';
      currentLotIndex++;
      setTimeout(updateFillUI, 2000);
    } else {
      document.getElementById('fill-status').textContent = '⚠ Fill failed: ' + (response?.error || 'Unknown error');
      document.getElementById('fill-status').className = 'status disconnected';
    }
  } catch (err) {
    document.getElementById('fill-status').textContent = '⚠ Error: ' + err.message;
    document.getElementById('fill-status').className = 'status disconnected';
  } finally {
    btn.textContent = '⚡ Fill This Lot';
    btn.disabled = false;
  }
});

// Skip lot
document.getElementById('skip-btn').addEventListener('click', () => {
  currentLotIndex++;
  updateFillUI();
});

// Back to batches
document.getElementById('back-btn').addEventListener('click', () => {
  showBatchSection();
});

// Logout
document.getElementById('logout-btn').addEventListener('click', async () => {
  accessToken = null;
  await chrome.storage.local.remove(['accessToken', 'refreshToken']);
  showLoginSection();
});

init();
