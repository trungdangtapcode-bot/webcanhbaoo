# 🚨 Smart Alert System — Hệ Thống Cảnh Báo Giao Thông Thông Minh

![Smart Alert System](https://img.shields.io/badge/Status-Active-brightgreen) ![Node.js](https://img.shields.io/badge/Node.js-20.x-green) ![Python](https://img.shields.io/badge/Python-3.11-blue) ![YOLOv8](https://img.shields.io/badge/AI-YOLOv8-orange)

**Smart Alert System** là một hệ thống giám sát và cảnh báo sự cố giao thông theo thời gian thực (Real-time). Hệ thống tự động phân tích hình ảnh từ các camera giao thông để phát hiện **Kẹt xe (Traffic Jam)**, **Ngập lụt (Flood)**, và **Cháy nổ (Fire)**.

---

## 🎯 1. Mục Tiêu Đồ Án

- Xây dựng một giải pháp phần mềm toàn diện giúp các cơ quan quản lý giao thông và người dân giám sát tình hình giao thông tự động, thay thế việc con người phải túc trực xem camera 24/7.
- Cung cấp các cảnh báo tức thời, chính xác bằng việc kết hợp các công nghệ AI tiên tiến (Computer Vision & Large Language Models) để loại bỏ cảnh báo giả.
- Thiết kế kiến trúc phần mềm tối ưu hiệu năng, có khả năng mở rộng (scale) lên hàng trăm camera bằng mô hình Microservices và Xử lý hàng đợi đồng thời (Concurrency).

---

## ⭐ 2. Tính Năng Nổi Bật

- **Phát hiện 3 loại sự cố chính:**
  - 🚗 **Kẹt xe:** Đếm số lượng xe và đo tốc độ di chuyển bằng luồng quang học (Optical flow).
  - 🌊 **Ngập lụt:** Phân tích dải màu, diện tích mặt nước và độ nhám bề mặt bằng hình học và HSV.
  - 🔥 **Cháy nổ:** Phát hiện hình dáng ngọn lửa và khói bốc lên.
- **Xác minh AI Đa Tầng:** Không chỉ dùng YOLO/OpenCV, hệ thống gửi hình ảnh sự cố lên **Groq/OpenRouter LLM (Llama/Nemotron)** để phân tích ngữ nghĩa, đảm bảo kết quả chính xác tuyệt đối.
- **Bản đồ Giám sát Real-time:** Hiển thị trực quan tình trạng các ngã tư trên bản đồ. Các điểm xảy ra sự cố sẽ tự động chuyển đỏ, nhấp nháy và phát âm thanh báo động mà không cần tải lại trang.
- **Chatbot AI Trợ lý:** Tích hợp AI hỏi đáp trực tiếp với người dùng về tình hình giao thông hiện tại ("Đường nào đang ngập?", "Ngã tư X có kẹt xe không?").
- **Tự động quét (Auto Scanner):** Dịch vụ chạy ngầm tự động lấy ảnh từ hệ thống camera công cộng TP.HCM và Hà Nội định kỳ để phân tích.
- **Kết nối Camera USB/Điện thoại:** Hỗ trợ dùng camera từ bất kỳ thiết bị cá nhân nào làm nguồn cấp dữ liệu (Webcam/Mobile Camera) để quét sự cố.

---

## 🛠️ 3. Công Nghệ Sử Dụng

Kiến trúc hệ thống được chia làm 3 phân hệ chính:

### Frontend (Giao diện hiển thị)
- **HTML5, CSS3, JavaScript (Vanilla):** Giúp ứng dụng siêu nhẹ, tải nhanh và không bị độ trễ so với các framework cồng kềnh.
- **Leaflet.js:** Render bản đồ tương tác.
- **Chart.js:** Vẽ biểu đồ thống kê mật độ giao thông.

### Backend (Máy chủ điều phối)
- **Node.js & Express.js:** Đảm bảo hiệu năng cao khi xử lý I/O không đồng bộ (non-blocking).
- **Socket.io:** Phát (broadcast) thông tin sự cố đến tất cả client trong vài mili-giây.
- **MongoDB:** Cơ sở dữ liệu NoSQL lưu trữ lịch sử sự kiện linh hoạt. Có cơ chế TTL tự động xóa dữ liệu cũ sau 7 ngày.

### AI Module (Máy chủ nhận diện)
- **Python 3:** Ngôn ngữ mạnh nhất cho hệ sinh thái AI.
- **YOLOv8 / YOLOv26:** Mô hình Deep Learning nhận diện vật thể (Object Detection) theo thời gian thực.
- **OpenCV:** Xử lý ảnh máy tính truyền thống (Computer Vision) phân tích màu sắc và hình học.
- **Groq / OpenRouter API:** Cung cấp LLM Vision cực mạnh đóng vai trò "Trọng tài" xác minh sự cố.

### DevOps
- **GitHub Actions:** Tự động hóa quá trình deploy (CI/CD) lên VPS.
- **PM2:** Quản lý tiến trình (Process Manager) giữ cho hệ thống luôn chạy 24/7.

---

## ⚙️ 4. Cơ Chế Vận Hành (Data Flow)

1. **Thu thập dữ liệu:** `multiCameraScannerService` tự động tải ảnh từ 12 camera công cộng mỗi 10 giây. Để tránh quá tải, hệ thống sử dụng thuật toán hàng đợi (Concurrency = 4) chia thành các batch để xử lý song song.
2. **Phát hiện cấp độ 1 (YOLO/OpenCV):** Hình ảnh được gửi tới server Python. YOLO khoanh vùng xe cộ/ngọn lửa. OpenCV phân tích dải màu nước ngập.
3. **Phát hiện cấp độ 2 (LLM Vision):** Nếu nghi ngờ có sự cố, hệ thống đóng gói ảnh dạng Base64 gửi lên Groq/OpenRouter. AI này sẽ trả lời YES/NO có thực sự là sự cố hay không (tránh tình trạng bóng áo đỏ bị nhận nhầm là lửa).
4. **Xác nhận qua thời gian (Temporal Confirmation):** Cần ít nhất 3 khung hình liên tiếp báo có sự cố thì hệ thống mới xác nhận (để loại bỏ nhiễu ngẫu nhiên).
5. **Cảnh báo (Real-time Alert):** Backend Node.js lưu sự cố vào MongoDB và dùng Socket.io đẩy cảnh báo thẳng xuống màn hình trình duyệt của tất cả người dùng đang theo dõi.

---

## 🚀 5. Hướng Dẫn Cài Đặt (Local Development)

### 5.1 Yêu cầu hệ thống
- Node.js >= 20.x
- Python >= 3.11
- MongoDB (Local hoặc Atlas)

### 5.2 Khởi động Backend
```bash
cd backend
npm install
# Tạo file .env từ .env.example và điền các API Key (MongoDB, Groq/OpenRouter)
cp .env.example .env
# Chạy Server
npm run dev
```
*Backend sẽ chạy ở địa chỉ `http://localhost:3000`*

### 5.3 Khởi động AI Module
```bash
cd ai_module
# Tạo môi trường ảo và cài đặt thư viện
python -m venv venv
venv\Scripts\activate  # Windows
# source venv/bin/activate # Linux/Mac
pip install -r requirements.txt
# Chạy API Nhận diện
python detector_api.py
```
*AI API sẽ chạy ở địa chỉ `http://127.0.0.1:5055`*

### 5.4 Sử dụng
1. Mở trình duyệt truy cập: `http://localhost:3000` (Dashboard chính)
2. Truy cập: `http://localhost:3000/demo.html` (Giao diện dùng USB Camera để test nhận diện thực tế)

---

## 🛡️ Bản quyền
Dự án được xây dựng phục vụ mục đích nghiên cứu và học thuật.
