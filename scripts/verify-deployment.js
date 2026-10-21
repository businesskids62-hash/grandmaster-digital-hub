// Deployment verification script
async function verify() {
  const routes = [
    'https://grandmaster-digital-hub.vercel.app/',
    'https://grandmaster-digital-hub.vercel.app/grandmaster',
    'https://grandmaster-digital-hub.vercel.app/grandmaster/',
    'https://grandmaster-digital-hub.vercel.app/kids',
    'https://grandmaster-digital-hub.vercel.app/api/health'
  ];

  console.log('--- TESTING PUBLIC PRODUCTION ENDPOINTS ---');
  for (const url of routes) {
    try {
      const res = await fetch(url);
      const text = await res.text();
      const isHtml = (res.headers.get('content-type') || '').includes('text/html');
      const isJson = (res.headers.get('content-type') || '').includes('application/json');
      const hasRoot = text.includes('id="root"');
      console.log(`[${res.status}] ${url} | Content-Type: ${res.headers.get('content-type')} | HTML with #root: ${hasRoot}`);
      if (isJson) {
        console.log('   JSON Response:', text);
      }
    } catch (e) {
      console.error(`Error requesting ${url}:`, e.message);
    }
  }

  // Also test /api/chat
  try {
    const chatRes = await fetch('https://grandmaster-digital-hub.vercel.app/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hello' })
    });
    const chatJson = await chatRes.json();
    console.log(`[${chatRes.status}] https://grandmaster-digital-hub.vercel.app/api/chat | Body:`, chatJson);
  } catch (e) {
    console.error('Error requesting /api/chat:', e.message);
  }
}

verify();
