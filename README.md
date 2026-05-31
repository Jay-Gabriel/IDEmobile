# IDEmobile (Mobile Antigravity)

Mobile Antigravity là một môi trường phát triển (IDE) và Terminal tích hợp di động, cho phép lập trình, chạy lệnh thực tế và tương tác với AI Agent trực tiếp trên các thiết bị di động.

## 🏗️ Kiến trúc hệ thống
Hệ thống được thiết kế theo mô hình Client-Server:
1. **Backend (Workspace Engine):** Chạy trên Node.js/Express. Phục vụ static web IDE (Monaco Editor & Xterm.js), tích hợp AI Agent qua Google Gemini SDK và điều phối Terminal PTY.
2. **Frontend (Mobile Client):** Viết bằng React Native (Expo) làm WebView container để load mượt mà giao diện từ backend.

## 🚀 Hướng dẫn khởi chạy nhanh

### 1. Cấu hình Backend
1. Di chuyển vào thư mục backend:
   ```bash
   cd backend
   ```
2. Cấu hình các biến môi trường trong file `.env`:
   ```env
   PORT=3000
   OPENAI_API_KEY=AIzaSy... (Gemini API Key)
   USE_NODE_PTY=false
   ```
3. Cài đặt thư viện và chạy chế độ dev:
   ```bash
   npm install
   npm run dev
   ```

### 2. Cấu hình Mobile App
1. Di chuyển vào thư mục mobile:
   ```bash
   cd mobile
   ```
2. Cài đặt các thư viện:
   ```bash
   npm install
   ```
3. Khởi chạy Expo:
   ```bash
   npx expo start
   ```
