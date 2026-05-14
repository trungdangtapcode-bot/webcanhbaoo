const express = require('express');
const router = express.Router();
const https = require('https');
const Event = require('../models/Event');
const { authMiddleware } = require('../middleware/auth');

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/chatbot/ask
// Body: { message: "Có cháy ở đâu trong 24h qua?" }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/ask', authMiddleware, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'message is required' });
    }

    // Lấy 30 sự kiện gần nhất làm context
    const recentEvents = await Event.find({})
      .sort({ timestamp: -1 })
      .limit(30)
      .select('event_type level location timestamp is_resolved confidence metadata camera_id')
      .lean();

    const contextText = recentEvents.map(e => {
      const ts = new Date(e.timestamp).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
      const loc = e.location?.address || `(${e.location?.lat?.toFixed(4)}, ${e.location?.lng?.toFixed(4)})`;
      const levelName = e.level === 3 ? 'Khẩn cấp' : e.level === 2 ? 'Cảnh báo' : 'Thông tin';
      const status = e.is_resolved ? 'Đã xử lý' : 'Chưa xử lý';
      return `[${ts}] ${e.event_type.toUpperCase()} | Cấp ${e.level} (${levelName}) | Địa điểm: ${loc} | Camera: ${e.camera_id} | ${status}`;
    }).join('\n');

    const systemPrompt = `Bạn là AI hỗ trợ ứng phó thiên tai và sự cố của hệ thống Smart Alert System.
Nhiệm vụ: Phân tích dữ liệu sự cố thực tế và trả lời câu hỏi của operator một cách ngắn gọn, chính xác, bằng tiếng Việt.
Khi đề xuất hành động, ưu tiên sự an toàn và tốc độ ứng phó.
Không bịa đặt thông tin ngoài dữ liệu được cung cấp.

DỮ LIỆU SỰ CỐ HIỆN TẠI (${recentEvents.length} sự kiện gần nhất):
${contextText || '(Chưa có sự kiện nào được ghi nhận)'}`;

    const GROQ_KEY = process.env.GROQ_API_KEY;
    const GROQ_MODEL = process.env.GROQ_MODEL || 'llama3-8b-8192';

    // ── Nếu không có API key → fallback response ────────────────────────────
    if (!GROQ_KEY) {
      const fallback = generateFallbackResponse(message, recentEvents);
      return res.json({ reply: fallback, source: 'fallback' });
    }

    // ── Gọi Groq Chat Completions API ───────────────────────────────────────
    const groqPayload = JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
      max_completion_tokens: 512,
      temperature: 0.3,
    });

    const groqRes = await fetchJson('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GROQ_KEY}`,
      },
      body: groqPayload,
    });

    const reply = groqRes?.choices?.[0]?.message?.content || 'Không thể tạo phản hồi.';
    res.json({ reply, source: 'groq', model: GROQ_MODEL });
  } catch (err) {
    console.error('[Chatbot] Error:', err);
    res.status(500).json({ error: 'Chatbot service error: ' + err.message });
  }
});

// ── Helper: Simple fetch wrapper ────────────────────────────────────────────
function fetchJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const reqOptions = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    };

    const req = https.request(reqOptions, (resp) => {
      let data = '';
      resp.on('data', chunk => { data += chunk; });
      resp.on('end', () => {
        let parsed = data;
        try { parsed = JSON.parse(data); } catch {}

        if (resp.statusCode < 200 || resp.statusCode >= 300) {
          const detail = parsed?.error?.message || data || resp.statusMessage;
          reject(new Error(`Groq API error (${resp.statusCode}): ${detail}`));
          return;
        }

        resolve(parsed);
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

// ── Fallback: Phân tích cơ bản không cần AI ─────────────────────────────────
function generateFallbackResponse(message, events) {
  const msg = message.toLowerCase();
  const fires = events.filter(e => e.event_type === 'fire');
  const floods = events.filter(e => e.event_type === 'flood');
  const traffics = events.filter(e => e.event_type === 'traffic_jam');
  const critical = events.filter(e => e.level === 3 && !e.is_resolved);

  if (msg.includes('cháy') || msg.includes('fire')) {
    if (fires.length === 0) return '✅ Không có sự cố hỏa hoạn nào được ghi nhận gần đây.';
    const last = fires[0];
    const loc = last.location?.address || 'Vị trí chưa xác định';
    return `🔥 Phát hiện ${fires.length} sự cố hỏa hoạn. Gần nhất tại: ${loc} (${new Date(last.timestamp).toLocaleString('vi-VN')}).${critical.length > 0 ? ` ⚠️ Có ${critical.length} sự cố khẩn cấp chưa xử lý!` : ''}`;
  }
  if (msg.includes('lũ') || msg.includes('ngập') || msg.includes('flood')) {
    if (floods.length === 0) return '✅ Không có sự cố ngập lụt nào được ghi nhận gần đây.';
    return `🌊 Phát hiện ${floods.length} sự cố ngập lụt trong dữ liệu gần nhất. Cần kiểm tra và ứng phó kịp thời.`;
  }
  if (msg.includes('giao thông') || msg.includes('traffic') || msg.includes('ùn tắc')) {
    if (traffics.length === 0) return '✅ Không có sự cố ùn tắc giao thông gần đây.';
    return `🚗 Ghi nhận ${traffics.length} điểm ùn tắc giao thông. Đề xuất điều tiết giao thông tại các điểm này.`;
  }
  if (msg.includes('tổng') || msg.includes('thống kê') || msg.includes('bao nhiêu')) {
    return `📊 Thống kê: Tổng ${events.length} sự kiện gần nhất | 🔥 Hỏa hoạn: ${fires.length} | 🌊 Lũ lụt: ${floods.length} | 🚗 Giao thông: ${traffics.length} | ⚠️ Chưa xử lý: ${events.filter(e => !e.is_resolved).length}`;
  }
  if (msg.includes('khẩn cấp') || msg.includes('nguy hiểm')) {
    if (critical.length === 0) return '✅ Hiện tại không có sự cố khẩn cấp (Level 3) nào chưa được xử lý.';
    return `🚨 Có ${critical.length} sự cố khẩn cấp (Level 3) chưa xử lý! Cần ứng phó ngay lập tức.`;
  }

  return `Xin chào! Tôi có thể giúp bạn:\n• Tra cứu sự cố hỏa hoạn, lũ lụt, giao thông\n• Xem thống kê và tình trạng chung\n• Kiểm tra các sự cố khẩn cấp chưa xử lý\n\n💡 Lưu ý: Để có câu trả lời thông minh hơn, hãy cấu hình GROQ_API_KEY trong file .env`;
}

module.exports = router;
