// ==================== 配置 ====================
const DEVICE_IP = '192.168.1.100';  // 局域网IP（用于局域网模式）
const API_BASE = 'http://' + DEVICE_IP;

// 巴法云配置
const BEMFA_CONFIG = {
    userId: '2daa242c1aec4c6da3cc425d6398293e',
    topic: 'juncang006',
    wsUrl: 'wss://mqtt.bemfa.com/mqtt'
};

// ==================== 巴法云WebSocket MQTT ====================
let bemfaWs = null;
let bemfaConnected = false;

function connectBemfa() {
    try {
        bemfaWs = new WebSocket(BEMFA_CONFIG.wsUrl);
        
        bemfaWs.onopen = function() {
            log('🌐 连接巴法云...');
            const connectMsg = {
                type: 'connect',
                userId: BEMFA_CONFIG.userId,
                topic: BEMFA_CONFIG.topic
            };
            bemfaWs.send(JSON.stringify(connectMsg));
        };

        bemfaWs.onmessage = function(event) {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'connected') {
                    bemfaConnected = true;
                    log('✅ 巴法云连接成功');
                    $('remoteStatus').textContent = '状态: 已连接 ' + new Date().toLocaleTimeString();
                }
                if (data.type === 'message') {
                    log('📩 收到远程消息: ' + data.payload);
                    // 消息可能是状态更新
                    if (data.payload === 'STATUS') {
                        // 请求状态
                    }
                }
            } catch (e) {
                log('解析消息失败: ' + e.message, true);
            }
        };

        bemfaWs.onclose = function() {
            bemfaConnected = false;
            log('⚠️ 巴法云断开，5秒后重连', true);
            $('remoteStatus').textContent = '状态: 已断开';
            setTimeout(connectBemfa, 5000);
        };

        bemfaWs.onerror = function(error) {
            log('❌ 巴法云错误: ' + error.message, true);
        };
    } catch (e) {
        log('❌ 连接巴法云失败: ' + e.message, true);
    }
}

// ==================== 发送远程指令 ====================
function sendRemoteCommand(command) {
    log('📡 发送指令: ' + command);
    
    if (bemfaConnected && bemfaWs) {
        const msg = {
            type: 'publish',
            topic: BEMFA_CONFIG.topic + '/set',
            payload: command
        };
        bemfaWs.send(JSON.stringify(msg));
        log('✅ 指令已通过巴法云发送');
        $('remoteStatus').textContent = '状态: 指令已发送 ' + new Date().toLocaleTimeString();
        return;
    }
    
    // 降级方案：通过局域网ESP32转发
    log('⚠️ 巴法云未连接，尝试通过局域网控制...', true);
    apiFetch('/mqtt?cmd=' + encodeURIComponent(command))
        .then(data => {
            if (data && data.success) {
                log('✅ 局域网转发成功');
            } else {
                log('❌ 局域网转发失败', true);
            }
        });
}

// ==================== 页面初始化 ====================
document.addEventListener('DOMContentLoaded', function() {
    // ... 现有初始化代码 ...
    
    // 连接巴法云
    connectBemfa();
    
    log('🚀 系统启动');
    log('🌐 远程控制已启用');
});