/**
 * Notion → HTML 在庫同期スクリプト
 * Cars☆Fukuoka 在庫管理
 *
 * Notion DBから公開=trueの車両データを取得し、
 * index.html の在庫セクションを自動更新する。
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const DATABASE_ID = '0ff931cef8054106877d286c32241c76';
const HTML_FILE = path.join(__dirname, '..', 'index.html');

// ─── Notion API ───

function notionRequest(endpoint, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname: 'api.notion.com',
      path: endpoint,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_API_KEY}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(body));
        } else {
          reject(new Error(`Notion API error ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function fetchInventory() {
  const res = await notionRequest(`/v1/databases/${DATABASE_ID}/query`, {
    filter: {
      property: '公開',
      checkbox: { equals: true },
    },
    sorts: [
      { property: '並び順', direction: 'ascending' },
    ],
  });

  return res.results.map((page) => {
    const p = page.properties;
    return {
      name: p['車名']?.title?.[0]?.plain_text || '',
      year: p['年式']?.rich_text?.[0]?.plain_text || '',
      mileage: p['走行距離']?.rich_text?.[0]?.plain_text || '',
      displacement: p['排気量']?.rich_text?.[0]?.plain_text || '',
      color: p['カラー']?.rich_text?.[0]?.plain_text || '',
      restoration: p['修復歴']?.select?.name || 'なし',
      transmission: p['ミッション']?.select?.name || 'AT',
      price: p['価格']?.number || 0,
      badge: p['バッジ']?.select?.name || 'なし',
      imageUrl: p['画像URL']?.url || '',
      note: p['備考']?.rich_text?.[0]?.plain_text || '',
    };
  });
}

// ─── HTML生成 ───

function formatPrice(num) {
  if (!num) return 'ASK';
  const man = Math.floor(num / 10000);
  return man.toLocaleString();
}

function badgeColor(badge) {
  switch (badge) {
    case '人気': return 'var(--accent)';
    case '希少': return '#ffb400';
    case 'カスタム済': return '#9382ff';
    default: return '';
  }
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function generateCard(car) {
  const badgeHtml = car.badge && car.badge !== 'なし'
    ? `<span class="inv-badge" style="background:${badgeColor(car.badge)}">${escapeHtml(car.badge)}</span>`
    : '';

  const imgHtml = car.imageUrl
    ? `<img src="${escapeHtml(car.imageUrl)}" alt="${escapeHtml(car.name)}" loading="lazy" style="width:100%;height:100%;object-fit:cover;">`
    : `<span style="color:var(--text-muted);font-size:0.85rem;">画像準備中</span>`;

  const specs = [car.year, car.mileage, car.displacement, car.color, car.note]
    .filter(Boolean)
    .join(' / ');

  const priceDisplay = car.price
    ? `<span class="inv-price">${formatPrice(car.price)}<small>万円(税込)</small></span>`
    : `<span class="inv-price">ASK</span>`;

  return `<div class="card inv-card fade-in">
<div class="inv-img" style="position:relative;">
${imgHtml}
${badgeHtml}
</div>
<div class="inv-info">
<h3>${escapeHtml(car.name)}</h3>
<p>${escapeHtml(specs)}</p>
<div class="inv-meta">
<div class="inv-specs">
<span>修復歴：${escapeHtml(car.restoration)}</span>
<span>ミッション：${escapeHtml(car.transmission)}</span>
<span>総額（税込）</span>
</div>
${priceDisplay}
</div>
</div>
</div>`;
}

function generateInventoryHtml(cars) {
  if (cars.length === 0) {
    return `<div style="text-align:center;padding:40px 0;color:var(--text-muted);">
<p>現在、在庫情報を準備中です。<br>お気軽にお問い合わせください。</p>
</div>`;
  }
  return cars.map(generateCard).join('\n');
}

// ─── HTML差し替え ───

function updateHtml(html, inventoryHtml) {
  // <!--INVENTORY_START--> と <!--INVENTORY_END--> の間を置換
  const startMarker = '<!--INVENTORY_START-->';
  const endMarker = '<!--INVENTORY_END-->';

  const startIdx = html.indexOf(startMarker);
  const endIdx = html.indexOf(endMarker);

  if (startIdx === -1 || endIdx === -1) {
    console.error('ERROR: Inventory markers not found in HTML.');
    console.error('Please add <!--INVENTORY_START--> and <!--INVENTORY_END--> markers around the inventory cards in index.html');
    process.exit(1);
  }

  return html.substring(0, startIdx + startMarker.length) +
    '\n' + inventoryHtml + '\n' +
    html.substring(endIdx);
}

// ─── メイン ───

async function main() {
  if (!NOTION_API_KEY) {
    console.error('ERROR: NOTION_API_KEY environment variable is not set.');
    process.exit(1);
  }

  console.log('Fetching inventory from Notion...');
  const cars = await fetchInventory();
  console.log(`Found ${cars.length} published vehicles.`);

  const inventoryHtml = generateInventoryHtml(cars);

  console.log('Reading index.html...');
  let html = fs.readFileSync(HTML_FILE, 'utf-8');

  console.log('Updating inventory section...');
  html = updateHtml(html, inventoryHtml);

  fs.writeFileSync(HTML_FILE, html, 'utf-8');
  console.log('index.html updated successfully!');
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
