# 🛡️ Smart Alert System

Real-time dashboard for detecting **traffic jams**, **flooding**, and **fire** from IP cameras.

---

## System Requirements

| Component   | Version       | Purpose                        |
|-------------|---------------|--------------------------------|
| Node.js     | >= 20.x       | Backend API + Socket.io        |
| MongoDB     | >= 7.0        | Event & camera data store      |
| Redis       | >= 7.0        | Socket.io adapter (cluster)    |
| Python      | >= 3.11       | AI detection modules           |
| PM2         | >= 5.4        | Process manager (production)   |
| OpenCV      | >= 4.9        | Computer vision (Python)       |
| CUDA        | >= 12.0 (opt) | GPU acceleration for YOLOv8    |

---

## Project Structure

```
smart-alert-system/
├── backend/
│   ├── src/
│   │   ├── app.js                    # Express app + middleware
│   │   ├── server.js                 # HTTP + Socket.io + Redis
│   │   ├── routes/events.js          # POST/GET /api/events
│   │   ├── routes/cameras.js         # GET/POST /api/cameras
│   │   ├── controllers/eventController.js
│   │   ├── controllers/cameraController.js
│   │   ├── services/trafficService.js # Sliding window (120s)
│   │   ├── services/floodService.js   # State machine
│   │   ├── services/alertService.js   # Socket.io emit
│   │   ├── models/Event.js
│   │   ├── models/Camera.js
│   │   ├── middleware/auth.js         # JWT validation
│   │   └── config/database.js + redis.js
│   ├── scripts/
│   │   ├── seed.js                   # Seed demo cameras
│   │   └── create_device_token.js    # Generate JWT for camera
│   ├── ecosystem.config.js           # PM2 cluster config
│   └── package.json
├── frontend/
│   └── index.html                    # Dashboard (Leaflet + Socket.io)
├── ai_module/
│   ├── traffic_module.py
│   ├── fire_module.py
│   ├── flood_module.py
│   ├── requirements.txt
│   └── .env.example
└── README.md
```

---

## 🔍 Hướng dẫn Đánh giá Mã nguồn (Code Review)

Để hỗ trợ giáo viên và các nhà phát triển hiểu nhanh kiến trúc hệ thống, dự án tích hợp một **Bản đồ kiến trúc tương tác (Interactive Code Map)**.

1.  **Truy cập nhanh**: Sau khi khởi chạy Backend, truy cập: [http://localhost:3000/codegraph](http://localhost:3000/codegraph)
2.  **Tính năng**:
    *   Xem sơ đồ kết nối giữa các thành phần (Backend, AI, Frontend).
    *   Phân tích các tầng kiến trúc (Layers).
    *   Guided Tour: Chuyến tham quan mã nguồn theo từng bước quan trọng.
3.  **Công nghệ**: Bản đồ được tạo tự động bằng công cụ `Understand Anything`, giúp trực quan hóa cấu trúc thư mục và các mối quan hệ `imports`/`calls` trong dự án.

---

## Installation (Ubuntu 22.04+)

### 1. Install System Dependencies

```bash
# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Redis
sudo apt-get install -y redis-server
sudo systemctl enable redis-server
sudo systemctl start redis-server

# MongoDB (or use MongoDB Atlas)
# See: https://www.mongodb.com/docs/manual/tutorial/install-mongodb-on-ubuntu/

# Python 3.11
sudo apt-get install -y python3.11 python3.11-venv python3-pip

# PM2 (global)
sudo npm install -g pm2
```

### 2. Setup Backend

```bash
cd backend

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your MongoDB URI, Redis URL, API_SECRET,
# JWT_SECRET, and GROQ_API_KEY for the chatbot
nano .env
```

### 3. Seed Database

```bash
cd backend
npm run seed
```

Expected output:
```
✅ Connected to MongoDB
   📷 Seeded: CAM_001 — Nguyễn Huệ — Lê Lợi
   📷 Seeded: CAM_002 — Điện Biên Phủ — Hai Bà Trưng
   📷 Seeded: CAM_003 — Bình Triệu Bridge
✅ Seeded 3 cameras successfully
```

### 4. Generate Device Tokens

```bash
cd backend
node scripts/create_device_token.js CAM_001
node scripts/create_device_token.js CAM_002
node scripts/create_device_token.js CAM_003
```

Copy the generated JWT tokens to each AI module's `.env` file.

### 5. Setup AI Modules (Python)

```bash
cd ai_module

# Create virtual environment
python3.11 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env with camera ID, RTSP URL, backend URL, and JWT token
nano .env
```

---

## Running

### Backend (Development)

```bash
cd backend
npm run dev
```

### Backend (Production with PM2)

```bash
cd backend
npm start       # starts PM2 cluster
pm2 logs        # view logs
pm2 status      # view process status
npm run stop    # stop all
```

### AI Modules

```bash
cd ai_module
source venv/bin/activate

# Run each module in separate terminals or use PM2/screen
python traffic_module.py
python fire_module.py
python flood_module.py
```

### Open Dashboard

Navigate to: **http://localhost:3000**

The dashboard will:
- Show a dark-themed Leaflet map centered on Ho Chi Minh City
- Display camera markers (🟢 = normal)
- Listen for real-time alerts via Socket.io
- Play audio beep and blink markers on alert

---

## API Endpoints

| Method | Endpoint        | Auth     | Description              |
|--------|-----------------|----------|--------------------------|
| GET    | /api/health     | None     | Health check             |
| GET    | /api/cameras    | None     | List all cameras         |
| POST   | /api/cameras    | None     | Create/update camera     |
| GET    | /api/events     | None     | Query events             |
| POST   | /api/events     | JWT      | Submit detection event   |

### POST /api/events payload

```json
{
  "camera_id": "CAM_001",
  "event_type": "traffic_jam",
  "confidence": 0.85,
  "vehicle_count": 12,
  "avg_speed": 2.3,
  "water_ratio": null,
  "image_base64": "<base64-jpeg>",
  "timestamp": "2026-05-10T03:00:00Z"
}
```

---

## Architecture

```
┌──────────────┐     POST /api/events     ┌──────────────────┐
│  IP Camera   │◄──── RTSP ────►│ AI Module (Python) │────────►│  Node.js Backend │
│  (RTSP)      │                │ YOLOv8 / OpenCV    │  JWT    │  Express+Socket  │
└──────────────┘                └────────────────────┘         └────────┬─────────┘
                                                                        │ Socket.io
                                                                        ▼
                                                               ┌────────────────┐
                                                               │  Web Dashboard  │
                                                               │  Leaflet + SIO  │
                                                               └────────────────┘
```

---

## License

MIT
