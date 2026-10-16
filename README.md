# VNU-LMS Auto Study

> Browser extension that auto-plays lessons on VNU LMS until each one meets its minimum study time, then moves to the next.
>
> *An unofficial Edge / Chrome extension for [lms.vnu.edu.vn](https://lms.vnu.edu.vn). The guide below is in Vietnamese because the tool is made for VNU students.*

Bạn là sinh viên VNU? Bạn đang đau khổ vì không có thời gian học hết các khóa/môn học phần chung trên LMS? Đây là giải pháp dành cho bạn, 1 công cụ giúp bạn treo máy và tự động chuyển tiếp bài học khi đã hoàn thành.

---

## Mục lục

- [Tính năng](#tính-năng)
- [Yêu cầu](#yêu-cầu)
- [Cài đặt](#cài-đặt)
- [Cập nhật lên bản mới](#cập-nhật-lên-bản-mới)
- [Hướng dẫn sử dụng](#hướng-dẫn-sử-dụng)
- [Giải thích giao diện](#giải-thích-giao-diện)
- [Mẹo để chạy ổn định](#mẹo-để-chạy-ổn-định)
- [Câu hỏi thường gặp và xử lý lỗi](#câu-hỏi-thường-gặp-và-xử-lý-lỗi)
- [Cách hoạt động](#cách-hoạt-động)
- [Quyền riêng tư và bảo mật](#quyền-riêng-tư-và-bảo-mật)
- [Giới hạn](#giới-hạn)
- [Lịch sử phiên bản](#lịch-sử-phiên-bản)
- [Lưu ý](#lưu-ý)

---

## Tính năng

- **Quét khóa học bằng một nút bấm:** lấy danh sách bài, số phút yêu cầu và số phút bạn đã học trực tiếp từ hệ thống LMS.
- **Tự học hết hàng đợi:** mở từng bài, treo đủ giờ, chuyển bài, không cần bạn thao tác.
- **Hỗ trợ mọi loại bài cần thời gian:** video, PDF, bài đọc, trang hoạt động.
- **Xử lý video:** tự tắt tiếng, tự phát lại khi bị dừng, tự tua về đầu nếu video mở ra ở gần cuối.
- **Xác nhận với server:** sau mỗi bài, tool kiểm tra lại trên LMS. Nếu chưa đủ thì học thêm phần còn thiếu.
- **Tự bỏ qua bài không làm được:** quiz, Zoom, bài tập, bài chưa đến ngày mở được liệt kê riêng để bạn làm tay.
- **Theo dõi tiến độ:** popup có đồng hồ đếm ngược, danh sách bài và nhật ký. Trên trang có nhãn trạng thái, và biểu tượng extension hiện số phút còn lại.
- **Tự chạy tiếp:** nếu trang bị tải lại giữa chừng, tool tự tiếp tục.
- **Kết hợp Extension:** Có khả năng kết hợp cùng Always active Window mà không bị conflict, extension vẫn hoạt động sau khi ẩn Tab.

## Yêu cầu

- Trình duyệt nhân Chromium: **Microsoft Edge**, **Google Chrome**, **Cốc Cốc**, Brave…
- Máy tính (Windows / macOS / Linux). Không dùng được trên điện thoại.
- Tài khoản đăng nhập được vào lms.vnu.edu.vn.

---

## Cài đặt

Extension chưa có trên cửa hàng tiện ích, nên bạn cài thủ công theo kiểu "Load unpacked". Làm một lần, mất khoảng 2 phút.

### Bước 1: Tải mã nguồn

- **Cách dễ nhất:** ở đầu trang repo, bấm nút xanh **Code**, chọn **Download ZIP**, rồi giải nén. Bạn sẽ có thư mục `VNU_LMS_Auto_Study-main`.
- **Hoặc dùng git:**
  ```bash
  git clone https://github.com/kamureii/VNU_LMS_Auto_Study.git
  ```

> ⚠️ Để thư mục ở **một chỗ cố định**, ví dụ `D:\Tools\VNU_LMS_Auto_Study`. Trình duyệt đọc extension trực tiếp từ thư mục này, nên nếu xóa hoặc di chuyển thư mục thì extension sẽ hỏng.

### Bước 2: Nạp extension vào trình duyệt

**Microsoft Edge**
1. Gõ `edge://extensions` vào thanh địa chỉ rồi Enter.
2. Bật **Developer mode** (Chế độ dành cho nhà phát triển) ở thanh bên trái, góc dưới.
3. Bấm **Load unpacked** (Tải tiện ích đã giải nén).
4. Chọn thư mục vừa giải nén. Đó là thư mục **chứa trực tiếp file `manifest.json`**, không phải thư mục cha bên ngoài.

**Google Chrome / Cốc Cốc / Brave**
1. Gõ `chrome://extensions` (Cốc Cốc: `coccoc://extensions`).
2. Bật **Developer mode** ở góc trên bên phải.
3. Bấm **Load unpacked** rồi chọn thư mục như trên.

### Bước 3: Ghim biểu tượng

Bấm biểu tượng mảnh ghép 🧩 trên thanh công cụ, tìm **VNU LMS Auto Study** rồi bấm ghim 📌 để biểu tượng luôn hiện ra.

### Bước 4: Tải lại trang LMS

Nếu đang mở sẵn trang LMS, hãy bấm **F5** để extension gắn vào trang.

> 💡 Edge hoặc Chrome có thể hiện thông báo *"Tắt các tiện ích ở chế độ nhà phát triển"* mỗi lần mở trình duyệt. Thông báo này bình thường với extension cài thủ công. Bấm **Giữ lại** hoặc đóng thông báo đi, **đừng** bấm Tắt.

---

## Cập nhật lên bản mới

1. Tải bản mới (Download ZIP hoặc `git pull`), giải nén **đè lên thư mục cũ**.
2. Mở `edge://extensions` (hoặc `chrome://extensions`), bấm nút **Reload ⟳** trên thẻ của extension.
3. **F5** lại trang LMS.

Xem số phiên bản trên thẻ extension, hoặc trong file `manifest.json`.

---

## Hướng dẫn sử dụng

### 1. Mở trang lớp học

Đăng nhập LMS, vào lớp cần học. Đường dẫn phải có dạng:

```
https://lms.vnu.edu.vn/learn/lop-hoc/chi-tiet/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

### 2. Quét khóa học

Bấm biểu tượng extension, rồi bấm **Quét**. Sau vài giây, danh sách bài hiện ra, phía trên có dòng tổng kết, ví dụ:

```
9 bài cần học (~14:00) · 18 xong · 12 làm tay · 110 chưa mở
```

👉 **Lần đầu dùng**, nên mở tab **Tiến trình học tập** trên LMS và so với danh sách này để chắc tool đọc đúng.

### 3. Bắt đầu

Bấm **Bắt đầu**. Từ lúc này tool sẽ:

1. Mở bài đầu tiên trong hàng đợi.
2. Treo đủ thời gian còn thiếu, cộng thêm một khoảng đệm nhỏ.
3. Rời bài để LMS lưu thời gian, rồi kiểm tra bài đã hoàn thành chưa.
4. Chuyển sang bài tiếp theo, cho đến khi hết hàng đợi.

Khi xong, trình duyệt hiện thông báo kèm tổng kết.

### 4. Dừng

Bấm **Dừng** trong popup hoặc trên nhãn xanh ở góc dưới bên trái trang. Thời gian đã học tới lúc dừng vẫn được LMS ghi nhận. Lần sau bấm **Bắt đầu**, tool chỉ học phần còn thiếu.

### 5. Làm phần còn lại bằng tay

Các bài có nhãn **Làm tay** (quiz, Zoom, bài tập) và **Chưa mở** (chưa đến ngày) tool không làm. Bạn tự làm những bài này.

Tool đoán loại bài dựa trên dữ liệu LMS nên đôi khi có thể nhầm. Bạn tự chỉnh được ngay trong danh sách của popup:

- Bài bị đánh **Làm tay** hoặc **Lỗi** nhưng thật ra chỉ cần xem (ví dụ video): bấm **Học bài này** để đưa vào hàng đợi.
- Bài **Chờ học** mà bạn muốn tự làm: bấm **Bỏ qua**.

Lựa chọn của bạn được nhớ cho lớp đó, kể cả khi bấm Quét lại. Bạn đổi được cả khi tool đang chạy.

---

## Giải thích giao diện

### Popup

| Thành phần | Ý nghĩa |
|---|---|
| Nhãn trạng thái (góc phải) | `Chưa quét` · `Sẵn sàng` · `Đang chạy` · `Đã dừng` · `Hoàn tất` · `Lỗi` |
| Khung **Đang học** | Tên bài hiện tại và thời gian còn lại |
| **Quét** | Lấy lại danh sách bài và thời gian mới nhất |
| **Bắt đầu** | Quét rồi chạy hàng đợi |
| **Dừng** | Dừng sau thao tác hiện tại |
| Dòng tổng kết | Số bài cần học (và tổng thời gian ước tính), đã xong, làm tay, chưa mở, lỗi |
| *Hiện cả bài đã xong* | Mặc định danh sách ẩn bài đã xong. Tích vào để xem tất cả |
| **Cài đặt** | Xem [bảng bên dưới](#cài-đặt-trong-popup) |
| **Nhật ký** | 40 dòng log gần nhất, dùng để gỡ lỗi |

### Trạng thái từng bài

| Nhãn | Ý nghĩa |
|---|---|
| 🔵 **Chờ học** | Nằm trong hàng đợi, sẽ được treo. Dòng nhỏ hiện `đã học / yêu cầu` phút |
| 🟢 **Đang học** | Tool đang mở bài này |
| 🟢 **Xong** | LMS đã ghi nhận hoàn thành, hoặc đã đủ số phút |
| 🟠 **Làm tay** | Quiz / Zoom / bài tập, hoặc bài có điều kiện hoàn thành không phải thời gian |
| 🟠 **Chưa mở** | Chưa tới ngày mở bài, có ghi ngày mở |
| 🔴 **Lỗi** | Không mở được hoặc chưa hoàn thành sau nhiều lần thử. Xem lý do ở dòng nhỏ |

### Nhãn trên trang và biểu tượng

- **Nhãn xanh ở góc dưới bên trái trang:** `Auto Study • <tên bài> • còn 03:25`, kèm nút **Dừng**. Nhãn chuyển sang màu đỏ khi có lỗi.
- **Số trên biểu tượng extension:** số phút còn lại của bài hiện tại. Dấu `!` nghĩa là có lỗi.

### Cài đặt trong popup

| Mục | Mặc định | Ý nghĩa |
|---|---|---|
| Thời gian đệm mỗi bài | 60 giây | Thời gian treo thêm ngoài số phút còn thiếu. Tool dùng số lớn hơn giữa giá trị này và 10% thời gian còn thiếu, để bù sai số làm tròn của LMS |
| Số lần thử lại | 2 | Nếu bài chưa hoàn thành sau lần treo đầu, tool học thêm tối đa bấy nhiêu lần |
| Tắt tiếng video | Bật | Video chạy không có tiếng |

---

## Mẹo để chạy ổn định

| Nên | Vì sao |
|---|---|
| ✅ Kéo tab LMS ra **một cửa sổ riêng**, có thể thu nhỏ cửa sổ đó | Bạn vẫn dùng trình duyệt bình thường ở cửa sổ khác. LMS vẫn tính giờ khi tab chạy nền |
| ✅ **Tắt "ngủ tab" cho LMS** | Edge tự cho tab nền "ngủ" sau một thời gian, tool sẽ bị dừng giữa chừng. Xem cách tắt bên dưới |
| ✅ Cắm sạc và tắt chế độ ngủ của máy | Máy ngủ thì trình duyệt cũng dừng |
| ❌ Không mở cùng một lớp ở nhiều tab | Hai tab cùng điều khiển một lớp sẽ giẫm chân nhau |
| ❌ Không click vào trang LMS khi tool đang chạy | Click sang bài khác làm tool phải mở lại bài |

**Tắt ngủ tab trên Edge:** vào `edge://settings/system`, mục **Sleeping tabs** → *Never put these sites to sleep* → **Add**, nhập `lms.vnu.edu.vn`.

**Trên Chrome:** vào `chrome://settings/performance`, mục **Memory saver** → *Always keep these sites active* → **Add**, nhập `lms.vnu.edu.vn`.

---

## Câu hỏi thường gặp và xử lý lỗi

<details>
<summary><b>Popup báo "Chưa kết nối được với trang"</b></summary>

Extension chưa gắn vào trang, thường vì bạn vừa cài hoặc vừa cập nhật mà chưa tải lại trang. Bấm **F5** trang LMS rồi mở lại popup.
</details>

<details>
<summary><b>Popup báo "Không ở trang lớp"</b></summary>

Bạn phải ở đúng trang chi tiết lớp học, đường dẫn có dạng `…/learn/lop-hoc/chi-tiet/<mã lớp>`. Trang chủ hoặc trang danh sách lớp không dùng được.
</details>

<details>
<summary><b>"Phiên đăng nhập đã hết hạn"</b></summary>

LMS đã đăng xuất bạn. Đăng nhập lại, mở lại trang lớp, bấm **Bắt đầu**. Tool chỉ học tiếp phần còn thiếu.
</details>

<details>
<summary><b>Bài bị đánh "Lỗi: Không thấy … trong danh sách bài"</b></summary>

Tên bài trong dữ liệu LMS khác với tên hiển thị ở danh sách bên trái, hoặc bài nằm trong một chương bị ẩn. Tool bỏ qua bài đó và làm bài tiếp theo. Bạn tự mở bài đó và để đủ giờ.
</details>

<details>
<summary><b>Bài bị đánh "Lỗi" nhưng trên web đã "Đã hoàn thành"</b></summary>

Đôi khi LMS cập nhật trạng thái chậm. Bấm **Quét** lại, bài sẽ chuyển sang **Xong**.
</details>

<details>
<summary><b>Tool dừng với thông báo "LMS không ghi nhận thời gian"</b></summary>

Sau khi treo, số phút trên server không tăng chút nào. Tool dừng hẳn để bạn kiểm tra, tránh treo vô ích cả hàng đợi. Nguyên nhân hay gặp:

- LMS thay đổi cách tính giờ, hoặc server đang lỗi.
- Bài đó có điều kiện hoàn thành khác (không phải thời gian).

Thử tự mở bài đó vài phút xem LMS có cộng giờ không. Nếu tự mở cũng không được cộng thì lỗi nằm ở LMS.
</details>

<details>
<summary><b>Đang chạy thì tool tự dừng hoặc đứng yên</b></summary>

- Tab có thể đã bị trình duyệt cho "ngủ". Xem [Mẹo để chạy ổn định](#mẹo-để-chạy-ổn-định).
- Máy có thể đã vào chế độ ngủ.
- Mở popup → **Nhật ký** để xem dòng lỗi cuối cùng.
</details>

<details>
<summary><b>Tôi đóng tab giữa chừng thì sao?</b></summary>

Thời gian học tới lúc đóng vẫn được LMS lưu. Mở lại trang lớp rồi bấm **Bắt đầu** để học tiếp. Nếu bạn mở lại trong vòng 10 phút, tool tự chạy tiếp sau khoảng 8 giây.
</details>

<details>
<summary><b>Có dùng được cho nhiều lớp cùng lúc không?</b></summary>

Nên chạy **một lớp một lúc**. Mỗi tab giữ trạng thái của lớp đang mở. Khi một lớp xong, mở lớp tiếp theo rồi bấm Quét và Bắt đầu.
</details>

<details>
<summary><b>Xem log chi tiết ở đâu?</b></summary>

Ngoài **Nhật ký** trong popup, bạn có thể mở DevTools (**F12**) → tab **Console**, rồi gõ `[LMS Auto]` vào ô lọc.
</details>

**Báo lỗi:** tạo một [Issue](https://github.com/kamureii/VNU_LMS_Auto_Study/issues), kèm phiên bản extension, trình duyệt, mô tả lỗi và các dòng cuối trong **Nhật ký**.
⚠️ Đừng dán token, cookie hay file HAR/JSON xuất từ DevTools vào Issue. Những thứ này chứa thông tin đăng nhập của bạn.

---

## Cách hoạt động

Phần này dành cho bạn nào muốn đọc hoặc sửa code.

```
lms-auto-study/
├── manifest.json          # Manifest V3
├── background.js          # Service worker: badge và thông báo
├── content/
│   ├── page-hook.js       # Chạy trong ngữ cảnh trang: gọi API (GET) và nghe khi app mở bài
│   └── runner.js          # Bộ điều phối: quét, hàng đợi, mở bài, giữ video, đếm giờ, xác nhận
├── popup/                 # Giao diện popup
└── icons/
```

1. **Quét.** Tool gọi 2 API có sẵn của LMS (chỉ đọc):
   - `LmsClassContent/frGetByClassId/{classId}`: cây bài học. Trường `mincore` là số phút tối thiểu.
   - `LmsClass/FrUserJoinClassNew/{classId}`: thời gian đã học (`learnTime`) và cờ hoàn thành (`isFinish`) của từng bài.
2. **Lập hàng đợi.** Hàng đợi gồm các bài chưa hoàn thành, có yêu cầu thời gian và đã mở. Bài tương tác và bài chưa mở được tách riêng.
3. **Mở bài** bằng cách click thật trong danh sách bên trái, tự mở các chương đang thu gọn. Tool biết bài đã tải xong nhờ nghe request `LmsClassContent/FrGetById/{id}` mà app gửi khi mở bài.
4. **Treo.** Thời gian treo bằng số phút còn thiếu cộng khoảng đệm, được đếm theo đồng hồ thật nên vẫn đúng khi tab chạy nền. Video được giữ chạy liên tục và không bao giờ chạm điểm kết thúc.
5. **Chốt và xác nhận.** LMS tính giờ qua một kết nối SignalR giữ mở trong lúc bạn ở trong bài, và **lưu thời gian khi kết nối đó đóng**. Vì vậy hết giờ, tool chuyển sang tab *Tiến trình học tập*, rồi hỏi lại server mỗi 5 giây (tối đa 60 giây) cho tới khi bài được xác nhận hoàn thành.

## Quyền riêng tư và bảo mật

- Extension **chỉ chạy trên `lms.vnu.edu.vn`** và chỉ xin các quyền `storage` và `notifications`.
- **Không gửi dữ liệu đi đâu khác.** Mọi request đều gửi tới chính LMS, và đều là **GET**: chỉ đọc, không ghi.
- **Không tự gửi thời gian học giả lên server.** Thời gian vẫn do LMS tự đo trong lúc trang bài học mở.
- **Không lưu mật khẩu, không tự đăng nhập.** Header xác thực mà trang đang dùng chỉ được giữ trong bộ nhớ của tab để gọi API đọc, không ghi ra ổ đĩa.
- Trạng thái hàng đợi lưu trong `chrome.storage.local` trên máy bạn.

Mã nguồn ngắn và có chú thích, bạn có thể tự đọc để kiểm tra.

## Giới hạn

- Được viết theo giao diện và API của LMS tại thời điểm **tháng 10/2026**. LMS thay đổi thì tool có thể hỏng cho tới khi được cập nhật.
- **Không** làm quiz, không vào Zoom, không nộp bài tập hay bình luận thảo luận.
- Cần giữ tab LMS mở và máy không ngủ trong suốt thời gian chạy.
- Chưa có trên Chrome Web Store / Edge Add-ons.

## Lưu ý

- Đây là dự án **không chính thức**, không liên quan tới Đại học Quốc gia Hà Nội hay đơn vị vận hành LMS.
- LMS ghi lại nhật ký truy cập chi tiết. Hãy tự tìm hiểu quy định của trường và học phần về việc dùng công cụ tự động. **Bạn tự chịu trách nhiệm khi sử dụng.**
- Tool chỉ giúp đủ điều kiện thời gian. Kiến thức cho bài kiểm tra vẫn là việc của bạn 📚
