# Original User Request

## Initial Request — 2026-06-30T12:36:34+07:00

Tối ưu giao diện và trải nghiệm video tin tức của ứng dụng Smart Alert System — một dashboard tactical theo dõi sự cố đô thị theo thời gian thực (kẹt xe, hỏa hoạn, lũ lụt, camera CCTV). Phần "Video" trong tab Tin tức cần được nâng cấp để hỗ trợ cuộn dọc kiểu TikTok/Reels — mượt mà, snap từng card, tự động phát khi vào viewport — cùng với đợt polish toàn diện về hiệu năng và trải nghiệm tổng thể của giao diện.

Working directory: /home/tuanhung/web2/webcanhbaoo
Integrity mode: development

---

## Context

- **Stack**: Vanilla HTML/CSS/JavaScript. Backend Express. Frontend: `frontend/index.html`, `frontend/css/style.css`, `frontend/js/app.js`.
- **Existing scroll-snap**: CSS `scroll-snap-type: y mandatory` đã có trên `.news-feed-overlay .news-list` nhưng chưa đủ — thiếu momentum, không có lazy-load iframe, không có chỉ báo tiến trình/pagination.
- **Video rendering**: Hàm `renderVideoNewsItems()` trong `app.js` render card thumbnail → user click → mở modal iframe YouTube.
- **TikTok target**: Thay vì click-to-modal, video tab cần chuyển sang chế độ fullscreen-per-card với YouTube iframe nhúng trực tiếp, chỉ load khi card active, cuộn bằng cử chỉ mượt mà (IntersectionObserver + scroll-snap).
- **Brand**: Professional, urgent, high-tech — dark mode tactical dashboard. Không dùng màu pastel/warm. Không dùng rounded lớn (>16px).

---

## Requirements

### R1. TikTok-style video feed trong tab Video
Khi người dùng chuyển sang tab "▶️ Video" trong mục Tin tức, danh sách video phải hiển thị theo chế độ cuộn dọc fullscreen-per-item (giống TikTok/Instagram Reels):
- Mỗi card chiếm toàn bộ chiều cao viewport của container (100dvh hoặc tương đương).
- CSS `scroll-snap-type: y mandatory` + `scroll-snap-align: start` đã có — cần đảm bảo hoạt động đúng và mượt mà trên mọi trình duyệt hiện đại.
- Iframe YouTube chỉ được inject (src set) khi card đó đang active (IntersectionObserver), và bị huỷ (src = '') khi card rời viewport để giải phóng bộ nhớ.
- Có nút điều hướng Prev/Next hoặc indicator (chấm tròn hoặc số) hiển thị vị trí hiện tại trong feed.

### R2. Smooth scroll & performance
- Scroll phải có momentum tự nhiên — sử dụng `scroll-behavior: smooth` + `overscroll-behavior: contain`, không giật cục.
- Lazy load thumbnail ảnh (thuộc tính `loading="lazy"` đã có — kiểm tra không bị break).
- Khi chưa có video nào load xong, hiển thị skeleton loader thay vì khoảng trống trắng.
- Keyboard navigation: phím mũi tên Lên/Xuống cuộn đến card kế tiếp khi feed đang focus.

### R3. UI polish tổng thể
Ngoài video feed, thực hiện một lượt polish UI cho toàn bộ giao diện:
- Kiểm tra và sửa các vấn đề về contrast (text phải ≥4.5:1 trên nền tương ứng).
- Cải thiện micro-animation: hover states trên card, transition vào/ra panel.
- Đảm bảo responsive hoạt động đúng trên mobile (viewport ≤480px và ≤820px).
- Không thay đổi layout lớn hay màu sắc thương hiệu — chỉ polish.

---

## Acceptance Criteria

### Video Feed (R1)
- [ ] Tab "Video" hiển thị các card full-height, cuộn snap dọc (không phải grid ngang).
- [ ] Cuộn đến một card → iframe YouTube của card đó được load và phát; cuộn đi → iframe bị clear (src = '').
- [ ] Có indicator hoặc nút nav Prev/Next.
- [ ] Hoạt động trên Chrome, Firefox, Safari (desktop và mobile).

### Performance (R2)
- [ ] Không có iframe YouTube nào bị load khi card nằm ngoài viewport.
- [ ] Skeleton loader hiển thị trong khi fetch video.
- [ ] Keyboard Up/Down điều hướng giữa các card khi feed có focus.

### Polish (R3)
- [ ] Không có regression UI so với trước — các tab khác (Camera, Cảnh báo, Thống kê) vẫn hoạt động đúng.
- [ ] Không có lỗi JavaScript console mới.
