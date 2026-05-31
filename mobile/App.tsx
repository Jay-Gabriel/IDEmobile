import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
  ScrollView,
  Modal
} from 'react-native';
import { WebView } from 'react-native-webview';
import io, { Socket } from 'socket.io-client';

interface ToolLog {
  id: string;
  name: string;
  input: string;
  output?: string;
  status: 'running' | 'done' | 'error';
}

interface Message {
  id: string;
  role: 'user' | 'agent' | 'system';
  content: string;
  timestamp: Date;
  status?: string;
  tools?: ToolLog[];
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'chat' | 'workspace'>('chat');
  const [serverUrl, setServerUrl] = useState<string>('http://192.168.1.100:3000');
  const [isEditingIp, setIsEditingIp] = useState<boolean>(false);
  const [tempUrl, setTempUrl] = useState<string>('http://192.168.1.100:3000');
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [inputText, setInputText] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [activeStatus, setActiveStatus] = useState<string>('');

  const socketRef = useRef<Socket | null>(null);
  const flatListRef = useRef<FlatList>(null);

  // Initialize Socket.io Connection
  useEffect(() => {
    console.log(`Connecting to server: ${serverUrl}`);
    const socket = io(serverUrl, {
      transports: ['websocket'],
      autoConnect: true,
      forceNew: true
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setIsConnected(true);
      console.log('Socket connected successfully!');
      setMessages(prev => [
        ...prev,
        {
          id: `sys-${Date.now()}`,
          role: 'system',
          content: `Kết nối thành công tới máy chủ: ${serverUrl}`,
          timestamp: new Date()
        }
      ]);
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
      console.log('Socket disconnected.');
    });

    // Handle streaming data from AI Agent
    socket.on('agent-stream', (data: { type: string; content?: string; tool?: string; input?: any; result?: string }) => {
      setIsStreaming(true);

      setMessages(prev => {
        const updated = [...prev];
        // Find if there is an active stream message in the end
        let lastMsg = updated[updated.length - 1];

        if (!lastMsg || lastMsg.role !== 'agent') {
          // Create new agent message
          lastMsg = {
            id: `agent-${Date.now()}`,
            role: 'agent',
            content: '',
            timestamp: new Date(),
            tools: []
          };
          updated.push(lastMsg);
        }

        switch (data.type) {
          case 'text':
            if (data.content) {
              lastMsg.content += data.content;
            }
            break;

          case 'status':
            if (data.content) {
              setActiveStatus(data.content);
              lastMsg.status = data.content;
            }
            break;

          case 'tool-start':
            if (data.tool) {
              const toolInputStr = typeof data.input === 'string' 
                ? data.input 
                : JSON.stringify(data.input, null, 2);
                
              const newTool: ToolLog = {
                id: `tool-${Date.now()}`,
                name: data.tool,
                input: toolInputStr,
                status: 'running'
              };
              lastMsg.tools = [...(lastMsg.tools || []), newTool];
            }
            break;

          case 'tool-end':
            if (data.tool && lastMsg.tools) {
              lastMsg.tools = lastMsg.tools.map(t => {
                if (t.name === data.tool && t.status === 'running') {
                  return {
                    ...t,
                    status: data.result?.startsWith('Error') ? 'error' : 'done',
                    output: data.result
                  };
                }
                return t;
              });
            }
            break;

          case 'error':
            if (data.content) {
              lastMsg.content += `\n[Lỗi: ${data.content}]\n`;
            }
            break;

          case 'done':
            setIsStreaming(false);
            setActiveStatus('');
            break;
        }

        return updated;
      });
    });

    return () => {
      socket.disconnect();
    };
  }, [serverUrl]);

  // Send prompt to AI Agent
  const handleSend = () => {
    if (!inputText.trim() || !isConnected) return;

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: inputText,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMsg]);
    socketRef.current?.emit('agent-prompt', inputText);
    setInputText('');
    setIsStreaming(true);
    setActiveStatus('Đang gửi yêu cầu...');
  };

  // Scroll to bottom on new messages
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages]);

  // Parse message content for basic formatting
  const renderMessageContent = (text: string) => {
    const parts = [];
    const regex = /```([\s\S]*?)```/g;
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push({
          id: `${lastIndex}`,
          type: 'text',
          content: text.substring(lastIndex, match.index)
        });
      }
      parts.push({
        id: `code-${match.index}`,
        type: 'code',
        content: match[1]
      });
      lastIndex = regex.lastIndex;
    }

    if (lastIndex < text.length) {
      parts.push({
        id: `${lastIndex}`,
        type: 'text',
        content: text.substring(lastIndex)
      });
    }

    return parts.map(part => {
      if (part.type === 'code') {
        // Extract language and code
        const lines = part.content.split('\n');
        const firstLine = lines[0].trim();
        const codeText = lines.slice(1).join('\n');
        return (
          <View key={part.id} style={styles.codeBlock}>
            <View style={styles.codeHeader}>
              <Text style={styles.codeLangText}>{firstLine || 'code'}</Text>
            </View>
            <ScrollView horizontal style={styles.codeScroll}>
              <Text style={styles.codeText}>{codeText || part.content}</Text>
            </ScrollView>
          </View>
        );
      } else {
        return (
          <Text key={part.id} style={styles.messageText}>
            {part.content}
          </Text>
        );
      }
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0b0f19" />
      
      {/* Header Settings Bar */}
      <View style={styles.header}>
        <View style={styles.headerBrand}>
          <Text style={styles.headerBrandText}>Antigravity Mobile</Text>
          <View style={[styles.statusIndicator, isConnected ? styles.statusOnline : styles.statusOffline]} />
        </View>
        
        <TouchableOpacity 
          style={styles.connectionButton} 
          onPress={() => {
            setTempUrl(serverUrl);
            setIsEditingIp(true);
          }}
        >
          <Text style={styles.connectionButtonText} numberOfLines={1}>
            {serverUrl.replace('http://', '')}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Main Tab Area */}
      <View style={styles.mainContent}>
        {activeTab === 'chat' ? (
          <KeyboardAvoidingView 
            style={styles.tabContent}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
          >
            {/* Messages list */}
            <FlatList
              ref={flatListRef}
              data={messages}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.messageList}
              renderItem={({ item }) => (
                <View style={[
                  styles.messageBubbleContainer,
                  item.role === 'user' ? styles.bubbleUser : 
                  item.role === 'system' ? styles.bubbleSystem : styles.bubbleAgent
                ]}>
                  {item.role !== 'system' && (
                    <Text style={styles.messageRoleText}>
                      {item.role === 'user' ? 'You' : 'Antigravity Agent'}
                    </Text>
                  )}
                  
                  {/* Text / Code Content */}
                  <View style={styles.messageBubbleInner}>
                    {renderMessageContent(item.content)}
                  </View>

                  {/* Executing Tools Log */}
                  {item.tools && item.tools.length > 0 && (
                    <View style={styles.toolsContainer}>
                      <Text style={styles.toolsTitle}>Công cụ đã chạy:</Text>
                      {item.tools.map((tool) => (
                        <View key={tool.id} style={styles.toolItem}>
                          <View style={styles.toolHeader}>
                            <Text style={styles.toolNameText}>🛠️ {tool.name}</Text>
                            <View style={[
                              styles.toolBadge,
                              tool.status === 'running' ? styles.toolRunning :
                              tool.status === 'done' ? styles.toolDone : styles.toolError
                            ]}>
                              <Text style={styles.toolBadgeText}>
                                {tool.status === 'running' ? 'Đang chạy' :
                                 tool.status === 'done' ? 'Xong' : 'Lỗi'}
                              </Text>
                            </View>
                          </View>
                          {tool.input && (
                            <Text style={styles.toolInputText} numberOfLines={2}>
                              Input: {tool.input}
                            </Text>
                          )}
                        </View>
                      ))}
                    </View>
                  )}
                  
                  <Text style={styles.messageTimeText}>
                    {item.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </View>
              )}
              ListEmptyComponent={() => (
                <View style={styles.emptyContainer}>
                  <Text style={styles.emptyText}>Chào mừng bạn đến với Mobile Antigravity!</Text>
                  <Text style={styles.emptySubText}>Hãy nhập một yêu cầu để bắt đầu (Ví dụ: "Hãy tạo file app.js có chức năng cộng 2 số và chạy thử").</Text>
                </View>
              )}
            />

            {/* Streaming status display */}
            {isStreaming && (
              <View style={styles.streamStatusContainer}>
                <ActivityIndicator size="small" color="#6366f1" />
                <Text style={styles.streamStatusText}>{activeStatus || 'Agent đang phản hồi...'}</Text>
              </View>
            )}

            {/* Message input */}
            <View style={styles.inputContainer}>
              <TextInput
                style={styles.chatInput}
                value={inputText}
                onChangeText={setInputText}
                placeholder="Nhập yêu cầu cho AI Agent..."
                placeholderTextColor="#9ca3af"
                multiline
                maxHeight={100}
              />
              <TouchableOpacity 
                style={[styles.sendButton, (!inputText.trim() || !isConnected) && styles.sendButtonDisabled]} 
                onPress={handleSend}
                disabled={!inputText.trim() || !isConnected}
              >
                <Text style={styles.sendButtonText}>Gửi</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        ) : (
          /* Tab 2: Monaco Editor / Terminal Webview */
          <View style={styles.tabContent}>
            {isConnected ? (
              <WebView
                source={{ uri: serverUrl }}
                style={styles.webview}
                domStorageEnabled={true}
                javaScriptEnabled={true}
                originWhitelist={['*']}
                allowsFullscreenVideo={true}
                startInLoadingState={true}
                renderLoading={() => (
                  <View style={styles.webviewLoader}>
                    <ActivityIndicator size="large" color="#6366f1" />
                    <Text style={styles.webviewLoaderText}>Đang tải Monaco & Xterm.js...</Text>
                  </View>
                )}
              />
            ) : (
              <View style={styles.webviewErrorContainer}>
                <Text style={styles.webviewErrorText}>Chưa kết nối đến server!</Text>
                <Text style={styles.webviewErrorSubText}>Vui lòng kết nối server ở góc trên trước khi mở Workspace.</Text>
              </View>
            )}
          </View>
        )}
      </View>

      {/* Bottom Tabs Navigation */}
      <View style={styles.tabsContainer}>
        <TouchableOpacity 
          style={[styles.tabButton, activeTab === 'chat' && styles.tabButtonActive]}
          onPress={() => setActiveTab('chat')}
        >
          <Text style={[styles.tabButtonText, activeTab === 'chat' && styles.tabButtonTextActive]}>
            🤖 Agent Chat
          </Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[styles.tabButton, activeTab === 'workspace' && styles.tabButtonActive]}
          onPress={() => setActiveTab('workspace')}
        >
          <Text style={[styles.tabButtonText, activeTab === 'workspace' && styles.tabButtonTextActive]}>
            💻 Workspace
          </Text>
        </TouchableOpacity>
      </View>

      {/* Edit IP Server Modal */}
      <Modal
        visible={isEditingIp}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setIsEditingIp(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>Cấu hình Máy chủ Workspace</Text>
            <Text style={styles.modalSub}>Nhập địa chỉ IP và Port của backend server (Ví dụ: http://192.168.1.10:3000):</Text>
            
            <TextInput
              style={styles.modalInput}
              value={tempUrl}
              onChangeText={setTempUrl}
              placeholder="http://192.168.1.100:3000"
              placeholderTextColor="#9ca3af"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity 
                style={[styles.modalBtn, styles.modalBtnCancel]} 
                onPress={() => setIsEditingIp(false)}
              >
                <Text style={styles.modalBtnCancelText}>Hủy</Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={[styles.modalBtn, styles.modalBtnSave]} 
                onPress={() => {
                  if (tempUrl.trim()) {
                    setServerUrl(tempUrl.trim());
                    setIsEditingIp(false);
                  }
                }}
              >
                <Text style={styles.modalBtnSaveText}>Kết nối</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b0f19'
  },
  header: {
    height: 56,
    backgroundColor: '#111827',
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16
  },
  headerBrand: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  headerBrandText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 16
  },
  statusIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginLeft: 8
  },
  statusOnline: {
    backgroundColor: '#10b981'
  },
  statusOffline: {
    backgroundColor: '#ef4444'
  },
  connectionButton: {
    backgroundColor: '#1f2937',
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    maxWidth: 180
  },
  connectionButtonText: {
    color: '#e5e7eb',
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace'
  },
  mainContent: {
    flex: 1
  },
  tabContent: {
    flex: 1
  },
  messageList: {
    padding: 16,
    paddingBottom: 24
  },
  messageBubbleContainer: {
    maxWidth: '85%',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16
  },
  bubbleUser: {
    backgroundColor: '#4f46e5',
    alignSelf: 'flex-end',
    borderBottomRightRadius: 2
  },
  bubbleAgent: {
    backgroundColor: '#1f2937',
    borderWidth: 1,
    borderColor: '#374151',
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 2
  },
  bubbleSystem: {
    backgroundColor: 'rgba(55, 65, 81, 0.5)',
    alignSelf: 'center',
    maxWidth: '95%',
    borderRadius: 6
  },
  messageRoleText: {
    color: '#a5b4fc',
    fontSize: 11,
    fontWeight: 'bold',
    marginBottom: 4
  },
  messageBubbleInner: {
    marginVertical: 4
  },
  messageText: {
    color: '#f3f4f6',
    fontSize: 14,
    lineHeight: 20
  },
  messageTimeText: {
    color: '#9ca3af',
    fontSize: 9,
    alignSelf: 'flex-end',
    marginTop: 4
  },
  codeBlock: {
    backgroundColor: '#030712',
    borderRadius: 6,
    marginVertical: 6,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#374151'
  },
  codeHeader: {
    backgroundColor: '#1f2937',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#374151'
  },
  codeLangText: {
    color: '#9ca3af',
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace'
  },
  codeScroll: {
    padding: 8
  },
  codeText: {
    color: '#34d399',
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace'
  },
  toolsContainer: {
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#374151',
    paddingTop: 8
  },
  toolsTitle: {
    color: '#9ca3af',
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 4
  },
  toolItem: {
    backgroundColor: '#111827',
    borderRadius: 6,
    padding: 8,
    marginBottom: 6
  },
  toolHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2
  },
  toolNameText: {
    color: '#e5e7eb',
    fontSize: 12,
    fontWeight: '500'
  },
  toolBadge: {
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 4
  },
  toolRunning: {
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
    borderWidth: 1,
    borderColor: '#f59e0b'
  },
  toolDone: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    borderWidth: 1,
    borderColor: '#10b981'
  },
  toolError: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    borderWidth: 1,
    borderColor: '#ef4444'
  },
  toolBadgeText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: 'bold'
  },
  toolInputText: {
    color: '#9ca3af',
    fontSize: 10,
    marginTop: 2
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 20
  },
  emptyText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 8
  },
  emptySubText: {
    color: '#9ca3af',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18
  },
  streamStatusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1f2937',
    padding: 10,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#374151'
  },
  streamStatusText: {
    color: '#e5e7eb',
    fontSize: 12,
    marginLeft: 8
  },
  inputContainer: {
    flexDirection: 'row',
    padding: 12,
    backgroundColor: '#111827',
    borderTopWidth: 1,
    borderTopColor: '#1f2937',
    alignItems: 'center'
  },
  chatInput: {
    flex: 1,
    backgroundColor: '#1f2937',
    color: '#ffffff',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#374151',
    marginRight: 8
  },
  sendButton: {
    backgroundColor: '#6366f1',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center'
  },
  sendButtonDisabled: {
    backgroundColor: '#374151'
  },
  sendButtonText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 14
  },
  webview: {
    flex: 1
  },
  webviewLoader: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0b0f19',
    justifyContent: 'center',
    alignItems: 'center'
  },
  webviewLoaderText: {
    color: '#9ca3af',
    fontSize: 14,
    marginTop: 12
  },
  webviewErrorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#0b0f19'
  },
  webviewErrorText: {
    color: '#ef4444',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8
  },
  webviewErrorSubText: {
    color: '#9ca3af',
    fontSize: 13,
    textAlign: 'center'
  },
  tabsContainer: {
    height: 60,
    backgroundColor: '#111827',
    borderTopWidth: 1,
    borderTopColor: '#1f2937',
    flexDirection: 'row'
  },
  tabButton: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    borderBottomWidth: 3,
    borderBottomColor: 'transparent'
  },
  tabButtonActive: {
    borderBottomColor: '#6366f1'
  },
  tabButtonText: {
    color: '#9ca3af',
    fontSize: 14,
    fontWeight: '500'
  },
  tabButtonTextActive: {
    color: '#6366f1',
    fontWeight: 'bold'
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24
  },
  modalContainer: {
    backgroundColor: '#1f2937',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#374151',
    width: '100%',
    maxWidth: 400,
    padding: 20
  },
  modalTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8
  },
  modalSub: {
    color: '#9ca3af',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 16
  },
  modalInput: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 8,
    color: '#ffffff',
    fontSize: 14,
    padding: 10,
    marginBottom: 20,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace'
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12
  },
  modalBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center'
  },
  modalBtnCancel: {
    backgroundColor: '#374151'
  },
  modalBtnCancelText: {
    color: '#e5e7eb',
    fontSize: 14
  },
  modalBtnSave: {
    backgroundColor: '#6366f1'
  },
  modalBtnSaveText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold'
  }
});
