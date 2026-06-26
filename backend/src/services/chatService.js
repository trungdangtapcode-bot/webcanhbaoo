const alertService = require('./alertService');
const { getHcmCameras } = require('./hcmCameraService');

const AI_REQUEST_TIMEOUT_MS = Number(process.env.CHAT_AI_TIMEOUT_MS || 12000);

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

function cleanLocation(value) {
  return String(value || '')
    .replace(/^[\s"'“”‘’]+|[\s"'“”‘’.!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function trimRouteNoise(value) {
  return cleanLocation(value)
    .replace(/^(toi|tôi|minh|mình|em|anh|chi|chị|ban|bạn)\s+(muon|muốn|can|cần|di|đi)\s+/i, '')
    .replace(/^(hay|hãy|vui long|vui lòng)\s+/i, '')
    .replace(/^(chi duong|chỉ đường|dan duong|dẫn đường|tim duong|tìm đường|duong di|đường đi)\s+/i, '')
    .replace(/^(den|đến|toi|tới)\s+/i, '')
    .trim();
}

function summarizeAlerts(activeAlerts) {
  if (!activeAlerts.length) {
    return 'Hiện chưa có cảnh báo giao thông đang hoạt động trên hệ thống.';
  }

  const labelByType = {
    traffic_jam: 'tắc đường',
    fire: 'hỏa hoạn',
    flood: 'ngập lụt',
  };

  const items = activeAlerts.slice(0, 5).map((alert) => {
    const type = labelByType[alert.event_type] || alert.event_type || 'sự cố';
    return `${type} tại ${alert.camera_name || alert.camera_id || 'một camera'}`;
  });

  const suffix = activeAlerts.length > items.length ? ` và ${activeAlerts.length - items.length} cảnh báo khác` : '';
  return `Đang có ${activeAlerts.length} cảnh báo: ${items.join('; ')}${suffix}.`;
}

function buildGeneralReply(message, activeAlerts) {
  const normalized = normalizeText(message);

  if (/^(hi|hello|hey|xin chao|chao|alo|test)\b/.test(normalized)) {
    return 'Xin chào! Bạn có thể hỏi tình hình giao thông hoặc nhập kiểu: "chỉ đường từ Quận 1 đến Quận 7".';
  }

  if (/(su co|canh bao|ket xe|tac duong|ngap|chay|hoa hoan|giao thong)/.test(normalized)) {
    return summarizeAlerts(activeAlerts);
  }

  return 'Tôi có thể giúp bạn xem cảnh báo giao thông hoặc lập tuyến đường. Bạn thử nhập: "chỉ đường từ Quận 1 đến Quận 7".';
}

function parseRouteLocally(message, forceRoute = false) {
  const normalized = normalizeText(message).replace(/\s+/g, ' ');

  const fromToMatch = normalized.match(/(?:^|\s)(?:tu)\s+(.+?)\s+(?:den|toi|sang|qua)\s+(.+)$/);
  if (fromToMatch) {
    return {
      intent: 'routing',
      start: cleanLocation(fromToMatch[1]),
      end: cleanLocation(fromToMatch[2]),
    };
  }

  const toFromMatch = normalized.match(/(?:^|\s)(?:den|toi)\s+(.+?)\s+(?:tu)\s+(.+)$/);
  if (toFromMatch) {
    return {
      intent: 'routing',
      start: cleanLocation(toFromMatch[2]),
      end: cleanLocation(toFromMatch[1]),
    };
  }

  const looksLikeRoute =
    forceRoute ||
    /\b(chi duong|dan duong|tim duong|duong di|lo trinh|di den|di toi|den|toi)\b/.test(normalized);

  if (!looksLikeRoute) return null;

  const destinationMatch = normalized.match(
    /(?:chi duong|dan duong|tim duong|duong di|lo trinh|di den|di toi|den|toi)\s+(.+)$/
  );

  const end = trimRouteNoise(destinationMatch?.[1] || normalized);
  if (!end) return null;

  return { intent: 'routing', start: null, end };
}

function parseMessageLocally(message, activeAlerts, forceRoute = false) {
  const route = parseRouteLocally(message, forceRoute);
  if (route) return route;

  const normalized = normalizeText(message);
  const isKnownGeneral =
    /^(hi|hello|hey|xin chao|chao|alo|test)\b/.test(normalized) ||
    /(su co|canh bao|ket xe|tac duong|ngap|chay|hoa hoan|giao thong)/.test(normalized);

  if (isKnownGeneral) {
    return {
      intent: 'general',
      reply: buildGeneralReply(message, activeAlerts),
    };
  }

  return null;
}

function safeJsonFromModel(content) {
  let text = String(content || '').trim();

  if (text.startsWith('```json')) {
    text = text.replace(/^```json/, '').replace(/```$/, '').trim();
  } else if (text.startsWith('```')) {
    text = text.replace(/^```/, '').replace(/```$/, '').trim();
  }

  return JSON.parse(text);
}

async function parseMessageWithAI(message, alertSummary) {
  if (!process.env.OPENROUTER_API_KEY) return null;

  const prompt = `Bạn là Trợ lý AI Giao thông thông minh cho khu vực TP.HCM.
Dưới đây là danh sách các sự cố hiện tại trên hệ thống (nếu người dùng hỏi):
${alertSummary}

Nhiệm vụ: Phân tích tin nhắn của người dùng: "${message}"

Nếu người dùng muốn tìm đường đi (có đề cập điểm xuất phát và đích đến, HOẶC CHỈ CÓ ĐÍCH ĐẾN):
Trả về JSON: { "intent": "routing", "start": "Địa điểm xuất phát (nếu có, nếu không thì trả về null)", "end": "Địa điểm đến" }

Nếu người dùng hỏi vấn đề chung:
Trả về JSON: { "intent": "general", "reply": "Câu trả lời của bạn" }

LƯU Ý: CHỈ TRẢ VỀ DUY NHẤT 1 ĐỐI TƯỢNG JSON HỢP LỆ. KHÔNG GIẢI THÍCH THÊM.`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);

  try {
    const openRouterRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "Smart Alert Traffic",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || "deepseek/deepseek-chat-v3-0324",
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!openRouterRes.ok) {
      const errText = await openRouterRes.text();
      throw new Error(`OpenRouter API error: ${openRouterRes.status} ${errText}`);
    }

    const chatCompletion = await openRouterRes.json();
    const content = chatCompletion?.choices?.[0]?.message?.content;
    if (!content) throw new Error('OpenRouter returned an empty completion');

    return safeJsonFromModel(content);
  } finally {
    clearTimeout(timer);
  }
}

// Haversine formula to calculate distance between two coordinates in meters
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // metres
  const p1 = lat1 * Math.PI/180;
  const p2 = lat2 * Math.PI/180;
  const dp = (lat2-lat1) * Math.PI/180;
  const dl = (lon2-lon1) * Math.PI/180;
  const a = Math.sin(dp/2) * Math.sin(dp/2) +
            Math.cos(p1) * Math.cos(p2) *
            Math.sin(dl/2) * Math.sin(dl/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

async function geocode(locationStr) {
  try {
    const params = new URLSearchParams({
      q: locationStr,
      format: 'json',
      limit: '1',
      addressdetails: '1',
      countrycodes: 'vn',
      'accept-language': 'vi',
    });
    const url = `https://nominatim.openstreetmap.org/search?${params.toString()}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'SmartAlertSystem/1.0 (+local routing assistant)' }});
    const data = await res.json();
    if (!data || data.length === 0) return null;
    return {
      lat: parseFloat(data[0].lat),
      lng: parseFloat(data[0].lon),
      name: data[0].display_name
    };
  } catch (err) {
    console.error('Geocoding error:', err);
    return null;
  }
}

async function getRoutes(startCoords, endCoords) {
  try {
    const url = `http://router.project-osrm.org/route/v1/driving/${startCoords.lng},${startCoords.lat};${endCoords.lng},${endCoords.lat}?overview=full&geometries=geojson&alternatives=3`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) return null;
    return data.routes;
  } catch (err) {
    console.error('Routing error:', err);
    return null;
  }
}

function checkCollisions(routeCoords, activeAlerts) {
  const collidingAlerts = [];
  for (const alert of activeAlerts) {
    if (!alert.lat || !alert.lng) continue;
    for (const point of routeCoords) {
      const dist = getDistance(alert.lat, alert.lng, point[0], point[1]);
      if (dist <= 250) {
        if (!collidingAlerts.find(a => a.camera_id === alert.camera_id)) {
          collidingAlerts.push(alert);
        }
        break;
      }
    }
  }
  return collidingAlerts;
}

function findCamerasNearRoute(routeCoords, maxDistanceMeters = 260) {
  const cameras = getHcmCameras();
  const matches = [];

  for (const camera of cameras) {
    const lat = Number(camera.location?.lat);
    const lng = Number(camera.location?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    let bestDistance = Infinity;
    for (const point of routeCoords) {
      const distance = getDistance(lat, lng, point[0], point[1]);
      if (distance < bestDistance) bestDistance = distance;
      if (bestDistance <= maxDistanceMeters) break;
    }

    if (bestDistance <= maxDistanceMeters) {
      matches.push({
        camera_id: camera.camera_id,
        name: camera.name,
        lat,
        lng,
        distance_m: Math.round(bestDistance),
      });
    }
  }

  return matches
    .sort((a, b) => a.distance_m - b.distance_m)
    .slice(0, 120);
}

async function processChat(message, currentLocation, forceRoute) {
  try {
    const activeAlerts = alertService.getActiveAlerts();
    const alertSummary = activeAlerts.map(a => `- ${a.event_type} tại ${a.camera_name}`).join('\n') || "Không có sự cố nào.";

    let parsed = parseMessageLocally(message, activeAlerts, forceRoute);

    if (!parsed) {
      try {
        parsed = await parseMessageWithAI(message, alertSummary);
      } catch (aiError) {
        console.warn('[ChatService] AI parsing unavailable, using local fallback:', aiError.message);
      }
    }

    if (!parsed || typeof parsed !== 'object') {
      parsed = {
        intent: 'general',
        reply: buildGeneralReply(message, activeAlerts),
      };
    }

    if (forceRoute) {
      parsed.intent = 'routing';
      if (!parsed.end && !parsed.start) {
         parsed.end = message; // If AI failed to extract, assume the whole message is the destination
      }
    }

    // GENERAL INTENT
    if (parsed.intent === 'general' || (!parsed.start && !parsed.end)) {
      return { type: 'text', message: parsed.reply || "Xin chào, tôi có thể giúp gì cho bạn?" };
    }

    // ROUTING INTENT
    if (!parsed.end) {
      return { type: 'text', message: 'Vui lòng cung cấp điểm đến để tôi có thể chỉ đường cho bạn.' };
    }

    let startObj = null;
    if (parsed.start) {
      startObj = await geocode(parsed.start + ', Hồ Chí Minh');
    } else if (currentLocation && currentLocation.lat && currentLocation.lng) {
      startObj = { lat: currentLocation.lat, lng: currentLocation.lng, name: "Vị trí hiện tại của bạn" };
    }

    const endObj = await geocode(parsed.end + ', Hồ Chí Minh');

    if (!startObj) {
      return { type: 'text', message: 'Không thể xác định được điểm xuất phát. Vui lòng cho phép truy cập vị trí hoặc nhập rõ điểm xuất phát.' };
    }
    if (!endObj) {
      return { type: 'text', message: `Không tìm thấy tọa độ cho "${parsed.end}" trên bản đồ. Vui lòng nhập địa chỉ chi tiết hơn.` };
    }

    const routes = await getRoutes(startObj, endObj);
    if (!routes || routes.length === 0) {
      return { type: 'text', message: 'Hệ thống bản đồ không thể vẽ đường đi giữa 2 điểm này.' };
    }

    // Evaluate alternatives
    let bestRouteIndex = 0;
    let bestCollisions = [];
    let isAlternativeSuggested = false;

    for (let i = 0; i < routes.length; i++) {
      const coords = routes[i].geometry.coordinates.map(c => [c[1], c[0]]);
      const collisions = checkCollisions(coords, activeAlerts);
      
      if (i === 0) {
        bestRouteIndex = 0;
        bestCollisions = collisions;
        // If fastest route has 0 collisions, pick it and stop looking
        if (collisions.length === 0) break;
      } else {
        // If route 0 had collisions, but route i has fewer/no collisions, pick route i
        if (collisions.length < bestCollisions.length) {
          bestRouteIndex = i;
          bestCollisions = collisions;
          isAlternativeSuggested = true;
          if (collisions.length === 0) break;
        }
      }
    }

    const selectedRoute = routes[bestRouteIndex];
    const finalCoords = selectedRoute.geometry.coordinates.map(c => [c[1], c[0]]);
    const routeCameras = findCamerasNearRoute(finalCoords);

    let finalMessage = `Lộ trình từ **${startObj.name.split(',')[0]}** đến **${endObj.name.split(',')[0]}**.`;
    
    if (isAlternativeSuggested) {
      finalMessage = `⚠️ Đường đi tối ưu bị vướng sự cố giao thông, nên tôi đã tự động đề xuất **lộ trình thay thế an toàn hơn** cho bạn từ **${startObj.name.split(',')[0]}** đến **${endObj.name.split(',')[0]}**.`;
    }

    if (bestCollisions.length > 0) {
      const alertDescriptions = bestCollisions.map(a => {
        let type = a.event_type === 'traffic_jam' ? 'tắc đường' : a.event_type === 'fire' ? 'hỏa hoạn' : 'ngập lụt';
        return `${type} tại ${a.camera_name}`;
      }).join(', ');
      finalMessage += `\n\n⚠️ Mặc dù đã tìm đường vòng, nhưng lộ trình này vẫn đi qua khu vực có sự cố: ${alertDescriptions}. Bạn nhớ lái xe cẩn thận nhé!`;
    } else if (!isAlternativeSuggested) {
      finalMessage += `\n\n✅ Tuyến đường hiện tại thông thoáng, không có cảnh báo nào.`;
    }

    return {
      type: 'route',
      message: finalMessage,
      route: finalCoords,
      route_cameras: routeCameras,
      startPoint: [startObj.lat, startObj.lng],
      endPoint: [endObj.lat, endObj.lng]
    };

  } catch (error) {
    console.error('[ChatService] Error:', error);
    return { type: 'text', message: 'Đã có lỗi xảy ra khi gọi AI xử lý yêu cầu của bạn. Vui lòng thử lại sau.' };
  }
}

module.exports = {
  processChat
};
