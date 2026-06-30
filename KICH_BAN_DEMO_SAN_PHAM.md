# Kịch bản demo Smart Alert — trải nghiệm người dùng phổ thông

Thời lượng mục tiêu: 6–7 phút. Chỉ demo các tính năng quan trọng.

## Định hướng trình bày

- Khoảng 80% thời lượng tập trung vào lợi ích của người dân: biết sự cố, xem camera, nghe cảnh báo, hỏi chatbot, tìm đường an toàn và gửi thông tin.
- Khoảng 20% thời lượng cuối nói về giá trị cho đơn vị vận hành và tiềm năng đầu tư.
- Không trình bày sản phẩm như một dashboard kỹ thuật. Hãy kể câu chuyện của một người chuẩn bị ra đường và muốn biết khu vực nào đang nguy hiểm.

## Chuẩn bị trước khi quay

1. Mở `http://localhost:3000/?city=hanoi` và nhấn `Ctrl + Shift + R`.
2. Đóng tab detector cũ nếu còn mở.
3. Nhấn **Đặt lại** để số cảnh báo trở về 0–0–0.
4. Kiểm tra loa máy tính và bảo đảm tab Chrome không bị tắt tiếng.
5. Thu nhỏ các tab không liên quan và bật chế độ toàn màn hình.

## Cách sử dụng kịch bản khi quay

Mỗi phần bên dưới đều có hai mục:

- **Thao tác:** những gì bạn cần bấm hoặc chỉ trên màn hình.
- **Lời nói:** nội dung bạn đọc trong lúc thực hiện thao tác.

Không nên vừa nói vừa di chuyển chuột liên tục. Hãy nói hết một ý ngắn, thực hiện thao tác, chờ giao diện phản hồi rồi mới nói tiếp.

### Diễn tập một lần trước khi quay

1. Chọn nguồn **Hà Nội** trong danh sách camera.
2. Kiểm tra ba camera mô phỏng nằm đầu danh sách.
3. Nhấn **Đặt lại** trong khu vực **Mô phỏng camera**.
4. Xác nhận các bộ đếm Cháy, Ngập và Ùn tắc đều bằng 0.
5. Nhấn **Im lặng** và kiểm tra có nghe câu “Đã bật cảnh báo bằng giọng nói”.
6. Nhấn **Chạy cả 3**, chờ dòng trạng thái chuyển thành “Hoàn tất · 3 sự cố đã kích hoạt cảnh báo”.
7. Kiểm tra ba bộ đếm đều bằng 1 và ba camera đổi màu.
8. Nhấn **Đặt lại** lần nữa để trả hệ thống về trạng thái ban đầu trước khi bấm quay.

## Hướng dẫn demo từng bước

### Bước 1 — Mở đúng màn hình

**Bạn làm:**

1. Truy cập `http://localhost:3000/?city=hanoi`.
2. Nhấn `Ctrl + Shift + R` để tải phiên bản mới nhất.
3. Chọn mục **Camera** ở thanh điều hướng dọc bên trái.
4. Nhấn **Đặt lại** nếu trên góc phải đang có số cảnh báo khác 0.

**Kết quả cần thấy:** Bản đồ Hà Nội, ba camera mô phỏng ở đầu danh sách và ba bộ đếm sự cố đều bằng 0.

### Bước 2 — Giới thiệu bản đồ camera

**Bạn làm:**

1. Đưa chuột lên tổng số camera ở góc trên bên phải.
2. Chỉ vào các marker camera trên bản đồ.
3. Không mở camera ngay; để người xem quan sát tổng thể trong 2–3 giây.

**Bạn nói:** Phần “Giới thiệu giải pháp” trong kịch bản.

### Bước 3 — Demo người dân đóng góp camera

**Bạn làm:**

1. Nhấn nút **Đóng góp camera** phía trên danh sách camera.
2. Chỉ lần lượt vào tên camera, vị trí, đường dẫn hình ảnh và lựa chọn quyền riêng tư.
3. Không cần nhập hoặc gửi dữ liệu trong video gọi vốn.
4. Đóng cửa sổ để trở lại bản đồ.

**Kết quả cần nhấn mạnh:** Camera do người dân cung cấp phải qua bước gửi thông tin và kiểm duyệt, không tự động công khai ngay.

### Bước 4 — Chứng minh video được dùng như camera

**Bạn làm:**

1. Trong danh sách bên trái, tìm **Camera mô phỏng — Sự cố cháy**.
2. Nhấn nút hình tam giác ở cuối dòng camera.
3. Chờ video xuất hiện và phát khoảng 3–5 giây.
4. Chỉ vào nhãn **Nguồn camera mô phỏng** để người xem hiểu đây là video ghi sẵn.
5. Đóng cửa sổ video.

**Kết quả cần thấy:** Video phát trực tiếp trong cửa sổ camera giống như một luồng camera thông thường.

### Bước 5 — Bật đọc cảnh báo

**Bạn làm:**

1. Tìm nút **Im lặng** trên thanh công cụ phía trên bản đồ.
2. Nhấn một lần.
3. Dừng nói để khán giả nghe câu xác nhận.

**Kết quả cần nghe:** “Đã bật cảnh báo bằng giọng nói.” Nút đổi thành **Đọc cảnh báo**.

### Bước 6 — Kích hoạt nhận diện AI

**Bạn làm:**

1. Tìm khu vực **Mô phỏng camera** ở cột bên trái.
2. Nhấn **Chạy cả 3** đúng một lần.
3. Không bấm thêm nút trong lúc hệ thống đang xử lý.
4. Chỉ vào dòng trạng thái để người xem thấy hệ thống đang quét từng camera.
5. Tiếp tục nói phần mô tả quy trình AI trong lúc chờ.

**Kết quả cần chờ:**

- Dòng trạng thái hiển thị “Hoàn tất · 3 sự cố đã kích hoạt cảnh báo”.
- Bộ đếm phía trên chuyển thành 1 Cháy, 1 Ngập, 1 Ùn tắc.
- Ba camera mô phỏng đổi thành ba màu cảnh báo.
- Thông báo nổi xuất hiện ở góc màn hình.
- Khu vực **Sự cố đang theo dõi** hiển thị sự cố mới nhất.
- Hệ thống đọc cảnh báo bằng tiếng Việt.

Nếu muốn video ngắn hơn, bạn có thể chỉ bấm **Cháy** thay vì **Chạy cả 3**. Khi đó chỉ cần chờ bộ đếm Cháy tăng từ 0 lên 1.

### Bước 7 — Demo chatbot cho người dùng

**Bạn làm:**

1. Giữ nguyên ba sự cố đang hoạt động trên bản đồ.
2. Nhấn biểu tượng hội thoại hình tròn ở góc dưới bên phải.
3. Nhập: **“Hiện tại đang có những sự cố nào?”** rồi nhấn **Gửi**.
4. Chờ chatbot liệt kê các cảnh báo cháy, ngập và ùn tắc hiện tại.
5. Nhập tiếp: **“Chỉ đường từ Hồ Hoàn Kiếm đến Lăng Chủ tịch Hồ Chí Minh”**.
6. Chờ hệ thống vẽ tuyến đường, điểm A, điểm B và các bước di chuyển trên bản đồ.
7. Chỉ vào phần trả lời của chatbot và các camera nằm gần tuyến đường.
8. Đóng chatbot sau khi trình bày xong để tiếp tục demo.

**Kết quả cần thấy:**

- Chatbot trả lời bằng tiếng Việt và sử dụng dữ liệu cảnh báo đang hoạt động.
- Khi hỏi đường, bản đồ hiển thị tuyến đi và hướng dẫn từng chặng.
- Nếu tuyến nhanh nhất đi qua vùng có sự cố, hệ thống có thể đề xuất tuyến thay thế an toàn hơn.
- Camera gần tuyến được giữ lại để người dùng kiểm tra tình hình thực tế.

**Nếu không vẽ được đường:**

- Kiểm tra kết nối Internet vì dữ liệu định tuyến sử dụng dịch vụ bản đồ.
- Nhập rõ cả điểm xuất phát và điểm đến, không chỉ nhập một địa danh.
- Có thể dùng câu dự phòng: **“Chỉ đường từ Hồ Gươm, Hà Nội đến Lăng Bác, Hà Nội”**.

### Bước 8 — Mở danh sách cảnh báo

**Bạn làm:**

1. Nhấn mục **Cảnh báo** trên thanh điều hướng dọc bên trái.
2. Chỉ vào ba thẻ cảnh báo vừa được tạo.
3. Nhấn biểu tượng camera nhỏ trên một cảnh báo để mở ảnh phát hiện.
4. Đóng ảnh và thử các bộ lọc **Cháy**, **Ngập**, **Ùn tắc**.
5. Mở danh sách trạng thái và cho người xem thấy các lựa chọn Mới, Đang xử lý, Đã xác minh, Cảnh báo sai và Đã xử lý.

**Kết quả cần nhấn mạnh:** Người dùng có thông tin rõ ràng để tự bảo vệ mình; đồng thời đơn vị vận hành vẫn có thể xác minh và quản lý toàn bộ vòng đời cảnh báo.

### Bước 9 — Demo cảnh báo gần người dùng

**Bạn làm:**

1. Nhấn mục **Gần tôi** trên thanh điều hướng.
2. Chỉ vào các bán kính 500 mét, 3 km, 5 km và 10 km.
3. Không cần cấp lại quyền vị trí nếu trình duyệt đã cho phép.
4. Không cần chờ một sự cố mới trong phần này; chỉ giải thích cơ chế lọc theo vị trí.

### Bước 10 — Demo báo cáo từ cộng đồng

**Bạn làm:**

1. Quay lại mục **Camera**.
2. Nhấn **Gửi báo cáo khẩn cấp**.
3. Chỉ vào loại sự cố, camera hoặc vị trí và phần ghi chú.
4. Không gửi báo cáo thật trong lúc quay.
5. Đóng cửa sổ.

### Bước 11 — Demo thống kê

**Bạn làm:**

1. Nhấn mục **Thống kê** ở thanh điều hướng.
2. Chỉ vào tổng số sự cố, loại phổ biến, camera nhiều sự cố và biểu đồ theo thời gian.
3. Chuyển thử giữa 24 giờ và 7 ngày nếu dữ liệu hiển thị ổn định.

### Bước 12 — Kết thúc video

**Bạn làm:**

1. Quay lại mục **Camera** hoặc **Bản đồ**.
2. Để màn hình hiển thị ba marker sự cố và ba bộ đếm 1–1–1.
3. Đọc phần kết luận dành cho nhà đầu tư.
4. Sau khi nói xong mới nhấn **Đặt lại** nếu muốn kết thúc ở trạng thái bình thường.

## Xử lý nhanh khi demo gặp lỗi

- **Không thấy ba camera mô phỏng:** chọn nguồn Hà Nội và nhấn `Ctrl + Shift + R`.
- **Bộ đếm đã khác 0 trước khi quay:** nhấn **Đặt lại** và chờ 1–2 giây.
- **Không nghe giọng đọc:** kiểm tra tab Chrome có bị tắt tiếng không, tăng âm lượng máy và bấm lại nút **Đọc cảnh báo**.
- **Nút Chạy cả 3 đang bị mờ:** hệ thống vẫn đang xử lý; không tải lại trang, hãy chờ dòng trạng thái hoàn tất.
- **Không thấy thông báo nổi:** mở mục **Cảnh báo** để kiểm tra cảnh báo đã được ghi nhận hay chưa.
- **Video chưa phát:** đóng cửa sổ camera, mở lại và chờ 2–3 giây.
- **Camera ngoài bản đồ:** tắt bộ lọc **Gần tôi** hoặc nhấn nút hiển thị toàn bộ camera.

## 0:00–0:30 — Vấn đề của người dùng bình thường

**Thao tác:** Mở màn hình bản đồ tổng quan, chưa bấm vào camera.

**Lời nói:**

“Trước khi ra đường, một người bình thường thường không biết tuyến phía trước đang ngập, ùn tắc hay có sự cố cháy. Các thông tin này nằm rải rác ở nhiều nguồn và thường đến quá muộn để người dùng thay đổi kế hoạch.”

“Smart Alert giúp người dân biết điều gì đang xảy ra quanh mình, xem camera để kiểm chứng và chọn cách di chuyển an toàn hơn.”

## 0:30–1:00 — Giới thiệu giải pháp

**Thao tác:** Di chuyển chuột trên bản đồ và chỉ vào số lượng camera ở góc trên.

**Lời nói:**

“Đây là màn hình chính của Smart Alert. Người dùng chỉ cần mở một bản đồ duy nhất để xem camera và ba nhóm sự cố ảnh hưởng trực tiếp đến cuộc sống hằng ngày: cháy, ngập lụt và ùn tắc giao thông.”

“Smart Alert tự động đưa camera có dấu hiệu bất thường lên trước, vì vậy người dùng không phải tự mở và kiểm tra từng camera.”

## 1:00–1:40 — Điểm khác biệt: người dân đóng góp camera

**Thao tác:** Nhấn **Đóng góp camera**, cho người xem thấy biểu mẫu rồi đóng lại.

**Lời nói:**

“Điểm quan trọng nhất của sản phẩm là mạng lưới camera không chỉ phụ thuộc vào hạ tầng công cộng.”

“Người dân, cửa hàng, chung cư hoặc doanh nghiệp có thể tự nguyện đóng góp camera của mình. Họ cung cấp vị trí và đường dẫn hình ảnh; dữ liệu sẽ được kiểm duyệt trước khi xuất hiện trên hệ thống.”

“Mỗi camera được đóng góp giúp lấp thêm một điểm mù. Khi số người tham gia tăng, chúng ta có thể hình thành một mạng lưới camera cộng đồng rất lớn mà không phải tự đầu tư toàn bộ phần cứng.”

“Đây cũng là hiệu ứng mạng của Smart Alert: càng nhiều camera tham gia, khả năng phát hiện sớm càng tốt, và giá trị của hệ thống đối với cộng đồng càng cao.”

## 1:40–2:10 — Camera trên bản đồ

**Thao tác:** Chỉ vào ba camera mô phỏng nằm đầu danh sách. Nhấn nút phát của một camera để mở video, sau đó đóng video.

**Lời nói:**

“Mỗi camera xuất hiện giống một nguồn camera bình thường: có vị trí, trạng thái hoạt động và video để người dùng kiểm tra trước khi di chuyển.”

“Trong bản demo này, tôi sử dụng ba video sự cố có giấy phép và phát lại chúng như ba camera mô phỏng. Các khung hình vẫn được gửi qua cùng một quy trình nhận diện và cảnh báo của hệ thống.”

## 2:10–2:30 — Bật cảnh báo bằng giọng nói

**Thao tác:** Nhấn nút **Im lặng** và chờ hệ thống đọc câu xác nhận.

**Lời nói:**

“Người dùng không cần liên tục nhìn vào màn hình. Khi bật chế độ đọc, hệ thống sẽ thông báo sự cố bằng tiếng Việt.”

**Tạm dừng để hệ thống đọc:** “Đã bật cảnh báo bằng giọng nói.”

## 2:30–3:25 — Demo AI phát hiện ba sự cố

**Thao tác:** Nhấn **Chạy cả 3**. Trong lúc hệ thống xử lý, chỉ vào trạng thái quét. Khi hoàn tất, chỉ vào ba bộ đếm và ba marker đổi màu.

**Lời nói:**

“Bây giờ tôi cho ba camera mô phỏng hoạt động cùng lúc: một camera có cháy, một camera có ngập lụt và một camera có ùn tắc.”

“Hệ thống đang lấy khung hình từ từng video và đưa qua bộ nhận diện. Khi một sự cố đạt điều kiện cảnh báo, kết quả được gửi ngay về dashboard qua kết nối thời gian thực.”

“Chúng ta có thể thấy ba phản ứng đồng thời: marker camera đổi màu theo loại sự cố, bộ đếm phía trên tăng lên, và camera mới nhất được đưa vào khu vực ‘Sự cố đang theo dõi’.”

“Thông báo không chỉ cho biết có sự cố, mà còn chỉ rõ loại sự cố, camera, thời gian và mức độ ưu tiên.”

**Tạm dừng để hệ thống đọc một cảnh báo.**

## 3:25–4:15 — Chatbot hỏi sự cố và tìm đường an toàn

**Thao tác:** Mở biểu tượng chatbot ở góc dưới bên phải. Hỏi “Hiện tại đang có những sự cố nào?”. Sau khi chatbot trả lời, hỏi tiếp “Chỉ đường từ Hồ Hoàn Kiếm đến Lăng Chủ tịch Hồ Chí Minh”.

**Lời nói:**

“Người dùng bình thường không cần hiểu các ký hiệu kỹ thuật trên dashboard. Họ có thể hỏi trực tiếp chatbot bằng tiếng Việt.”

“Ví dụ, tôi hỏi: hiện tại đang có những sự cố nào? Chatbot đọc trạng thái đang hoạt động của hệ thống và tóm tắt các khu vực có cháy, ngập hoặc ùn tắc.”

“Tôi cũng có thể yêu cầu chỉ đường bằng ngôn ngữ tự nhiên. Hệ thống không chỉ vẽ tuyến đi, mà còn so sánh tuyến đường với các cảnh báo đang có trên bản đồ.”

“Nếu tuyến nhanh nhất đi qua khu vực nguy hiểm, Smart Alert có thể đề xuất tuyến thay thế an toàn hơn và giữ lại các camera gần tuyến để người dùng kiểm tra trước khi di chuyển.”

“Đây là cách chúng tôi chuyển dữ liệu camera và AI thành một quyết định rất đơn giản cho người dùng: nên đi đường nào và nên tránh khu vực nào.”

## 4:15–4:50 — Người dùng xem chi tiết cảnh báo

**Thao tác:** Mở mục **Cảnh báo** ở thanh bên. Cuộn qua ba cảnh báo, bấm vào ảnh của một cảnh báo và thử bộ lọc Cháy/Ngập/Ùn tắc.

**Lời nói:**

“Trong danh sách cảnh báo, người dùng có thể xem ảnh tại thời điểm phát hiện và lọc nhanh theo cháy, ngập hoặc ùn tắc.”

“Mỗi cảnh báo có mức độ như Theo dõi, Cảnh báo, Nguy hiểm hoặc Khẩn cấp. Trạng thái xác minh giúp người dùng biết đây là cảnh báo mới, đang được kiểm tra hay đã được xử lý.”

“Nhờ vậy, người dùng không chỉ nhận một thông báo chung chung mà còn có hình ảnh, vị trí, thời gian và trạng thái xử lý.”

## 4:50–5:15 — Cảnh báo theo vị trí

**Thao tác:** Mở mục **Gần tôi**, cho thấy các lựa chọn bán kính 500 mét, 3 km, 5 km và 10 km.

**Lời nói:**

“Đối với người dân, Smart Alert có thể ưu tiên những sự cố thực sự liên quan đến vị trí hiện tại.”

“Người dùng chọn bán kính mong muốn. Nếu phía trước có ngập, cháy hoặc ùn tắc, hệ thống có thể gửi thông báo theo vị trí và đọc cảnh báo bằng giọng nói, đặc biệt hữu ích khi đang di chuyển.”

## 5:15–5:40 — Báo cáo từ cộng đồng

**Thao tác:** Nhấn **Gửi báo cáo khẩn cấp**, cho thấy lựa chọn loại sự cố và vị trí rồi đóng lại.

**Lời nói:**

“Ngoài dữ liệu camera, người dân cũng có thể chủ động gửi báo cáo khẩn cấp. Báo cáo được gắn với vị trí hiện tại hoặc camera gần nhất, giúp bổ sung bằng chứng cho hệ thống.”

“Khi AI, camera cộng đồng và báo cáo của người dân được kết hợp, độ phủ thông tin sẽ tốt hơn nhiều so với một nguồn dữ liệu đơn lẻ.”

## 5:40–6:00 — Thống kê xu hướng

**Thao tác:** Mở mục **Thống kê**, chỉ vào tổng số sự cố, loại phổ biến và camera có nhiều sự cố.

**Lời nói:**

“Người dùng có thể xem xu hướng sự cố theo thời gian; còn với đơn vị quản lý, dữ liệu này hỗ trợ xác định các điểm nóng cần ưu tiên.”

“Những thông tin này giúp xác định khu vực thường xuyên ngập, nút giao hay ùn tắc, hoặc camera liên tục ghi nhận bất thường để ưu tiên nguồn lực và lập kế hoạch hạ tầng.”

## 6:00–6:40 — Kết luận: giá trị cho người dùng và nhà đầu tư

**Thao tác:** Quay lại màn hình bản đồ có ba cảnh báo, sau đó nhấn **Đặt lại** ở cuối phần trình bày nếu muốn trở về trạng thái ban đầu.

**Lời nói:**

“Với một người dùng bình thường, Smart Alert trả lời ba câu hỏi rất thực tế: quanh tôi đang có chuyện gì, bằng chứng từ camera ở đâu, và tôi nên di chuyển như thế nào để an toàn hơn.”

“Smart Alert không chỉ là một mô hình nhận diện hình ảnh. Đây là nền tảng kết nối camera, AI, chatbot, người dân và đơn vị vận hành trong cùng một quy trình phản ứng sự cố.”

“Lợi thế mở rộng của chúng tôi nằm ở mạng lưới camera cộng đồng: mỗi người tham gia giúp tăng độ phủ mà không làm chi phí phần cứng tăng theo cùng tỷ lệ.”

“Sản phẩm có thể triển khai cho đô thị, khu công nghiệp, khu dân cư, trường học hoặc doanh nghiệp dưới dạng nền tảng giám sát và cảnh báo.”

“Khoản đầu tư tiếp theo sẽ được sử dụng để mở rộng hạ tầng xử lý video, nâng độ chính xác của mô hình, phát triển ứng dụng cho người dân và xây dựng quan hệ với các đơn vị quản lý camera.”

“Mục tiêu của Smart Alert là biến hàng triệu camera đang tồn tại thành một mạng lưới cảnh báo sớm, giúp cộng đồng phát hiện nhanh hơn và phản ứng trước khi sự cố trở nên nghiêm trọng.”

## Câu trả lời ngắn nếu nhà đầu tư hỏi về video mô phỏng

“Các video trong demo là dữ liệu ghi sẵn có giấy phép, được phát lại như nguồn camera mô phỏng. Mục đích là kiểm tra toàn bộ luồng từ lấy khung hình, nhận diện, tạo cảnh báo đến phản ứng của dashboard trong điều kiện chưa có sự cố thật xảy ra tại thời điểm trình bày.”

## Những điều không nên nói quá

- Không nói hệ thống đã thay thế hoàn toàn con người; cảnh báo quan trọng vẫn cần xác minh.
- Không gọi video mô phỏng là camera trực tiếp ngoài thực địa.
- Không khẳng định độ chính xác tuyệt đối nếu chưa có bộ số liệu kiểm định.
- Không nói mạng lưới đã có quy mô toàn quốc; hãy trình bày đó là khả năng mở rộng và tầm nhìn.
