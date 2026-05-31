// Script test kết nối Agent qua Socket.io
// Chạy: node test-agent.js
const { io } = require('socket.io-client');

const socket = io('http://localhost:3000');

socket.on('connect', () => {
  console.log('✅ Đã kết nối tới Workspace Server!');
  console.log('📤 Gửi yêu cầu cho Agent...\n');
  socket.emit('agent-prompt', 'Hãy viết hàm fibonacci vào file main.js');
});

socket.on('agent-stream', (data) => {
  if (data.type === 'status') {
    process.stdout.write(`\n🔄 [Status] ${data.content}`);
  } else if (data.type === 'text') {
    process.stdout.write(data.content);
  } else if (data.type === 'tool-start') {
    process.stdout.write(`\n🔧 [Tool] ${data.tool} - Input: ${JSON.stringify(data.input)}`);
  } else if (data.type === 'tool-end') {
    process.stdout.write(`\n✅ [Tool Done] ${data.tool} - Result: ${data.result?.substring(0, 100)}...`);
  } else if (data.type === 'error') {
    console.error(`\n❌ [Error] ${data.content}`);
  } else if (data.type === 'done') {
    console.log('\n\n✅ Agent đã hoàn thành!');
    process.exit(0);
  }
});

socket.on('connect_error', (err) => {
  console.error('❌ Lỗi kết nối:', err.message);
  process.exit(1);
});

// Timeout sau 60 giây
setTimeout(() => {
  console.log('\n⏱️ Timeout sau 60 giây.');
  process.exit(0);
}, 60000);
