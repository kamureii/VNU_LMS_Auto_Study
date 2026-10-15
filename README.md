# VNU LMS Auto Study

Extension cho Edge/Chrome. Nó tự mở từng bài trên lms.vnu.edu.vn, treo đủ số phút yêu cầu rồi chuyển sang bài tiếp theo.

## Cài đặt (Edge)

1. Giải nén thư mục `lms-auto-study` ra một chỗ cố định, vì Edge đọc trực tiếp từ thư mục này.
2. Mở `edge://extensions`, bật **Developer mode** (góc trái dưới).
3. Bấm **Load unpacked** rồi chọn thư mục `lms-auto-study`.
4. Ghim biểu tượng extension lên thanh công cụ cho tiện.
5. **Tải lại (F5)** những tab LMS đang mở để extension gắn vào trang.

## Sử dụng

1. Mở trang lớp học `https://lms.vnu.edu.vn/learn/lop-hoc/chi-tiet/<id-lớp>`.
2. Bấm biểu tượng extension, chọn **Quét**. Danh sách hiện ra gồm:
   - **Chờ học**: bài sẽ được treo, kèm số phút đã học / số phút yêu cầu.
   - **Làm tay**: quiz, Zoom, bài tập. Tool bỏ qua những bài này.
   - **Chưa mở**: bài chưa tới ngày mở.
   
   Nên so danh sách này với tab *Tiến trình học tập* ở lần chạy đầu để chắc tool đọc đúng.
3. Bấm **Bắt đầu**. Góc trái dưới trang sẽ hiện nhãn xanh cho biết bài đang học và thời gian còn lại. Biểu tượng extension hiện số phút còn lại của bài hiện tại.
4. Có thể bấm **Dừng** trên nhãn hoặc trong popup bất cứ lúc nào.

Tab LMS có thể để chạy nền. Đừng đóng tab và đừng để máy ngủ.

## Cách tool hoạt động

- Tool đọc danh sách bài và thời gian đã học qua chính API của LMS, chỉ dùng lệnh GET:
  - `frGetByClassId`: lấy danh sách bài, trường `mincore` là số phút tối thiểu.
  - `FrUserJoinClassNew`: lấy `learnTime` và `isFinish` của từng bài.
- Tool mở bài bằng cách click trong danh sách bên trái, giống người dùng thật. Video được tắt tiếng và giữ ở trạng thái phát; nếu video hết trước khi đủ giờ thì phát lại từ đầu.
- LMS chỉ **chốt thời gian khi rời bài**, tức là khi kết nối SignalR đóng. Vì vậy sau mỗi bài, tool chuyển sang tab *Tiến trình học tập*, chờ vài giây rồi kiểm tra `isFinish`:
  - Chưa đủ: tool học thêm phần còn thiếu, tối đa 2 lần (có thể chỉnh trong Cài đặt).
  - Thời gian không tăng chút nào: tool dừng hẳn để bạn kiểm tra.
- Nếu trang bị tải lại giữa chừng, tool tự chạy tiếp sau 8 giây (chỉ khi lần lưu cuối cách đó dưới 10 phút).

## Cài đặt trong popup

| Mục | Mặc định | Ý nghĩa |
|---|---|---|
| Thời gian đệm | 60 giây | Cộng thêm vào mỗi bài để bù sai số làm tròn |
| Số lần thử lại | 2 | Số lần học thêm nếu bài chưa được tính hoàn thành |
| Tắt tiếng video | Bật | |

## Gỡ lỗi

- **Popup báo "Chưa kết nối được với trang"**: tải lại trang LMS (F5).
- **"Không thấy bài … trong danh sách"**: tên bài trong API khác với tên hiển thị ở sidebar. Tool bỏ qua bài đó và làm bài tiếp theo.
- **"Phiên đăng nhập đã hết hạn"**: đăng nhập lại, mở lại trang lớp, bấm Bắt đầu.
- Mở DevTools (F12) → Console và lọc theo `[LMS Auto]` để xem log chi tiết.
