/**
 * Demo test script — sends sample alerts to the backend to verify
 * Socket.io broadcasting and dashboard display.
 */
require('dotenv').config();
const jwt = require('jsonwebtoken');

const BACKEND = `http://localhost:${process.env.PORT || 3000}/api/events`;
const token = jwt.sign({ camera_id: 'CAM_001' }, process.env.API_SECRET, { expiresIn: '1h' });

const testEvents = [
  {
    camera_id: 'CAM_001',
    event_type: 'fire',
    confidence: 0.92,
    timestamp: new Date().toISOString(),
  },
  {
    camera_id: 'CAM_002',
    event_type: 'flood',
    confidence: 0.75,
    water_ratio: 0.35,
    timestamp: new Date().toISOString(),
  },
  {
    camera_id: 'CAM_003',
    event_type: 'traffic_jam',
    confidence: 0.80,
    vehicle_count: 15,
    avg_speed: 2.1,
    timestamp: new Date().toISOString(),
  },
];

async function sendEvent(event) {
  const res = await fetch(BACKEND, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(event),
  });
  const data = await res.json();
  console.log(`[${event.event_type}] ${event.camera_id} →`, data);
}

async function main() {
  console.log('🧪 Sending test alerts...\n');
  for (const event of testEvents) {
    await sendEvent(event);
    await new Promise(r => setTimeout(r, 1500)); // delay between alerts
  }
  console.log('\n✅ All test alerts sent. Check the dashboard!');
}

main().catch(console.error);
