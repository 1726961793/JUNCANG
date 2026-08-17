// ==================== 巴法云配置 ====================
const BEMFA_CONFIG = {
    userId: '2daa242c1aec4c6da3cc425d6398293e',
    topic: 'juncang006',
    // MQTT over WebSocket 连接地址
    mqttUrl: 'wss://bemfa.com:9504/wss',
    setTopic: 'juncang006/set',
    stateTopic: 'juncang006/state'
};

// ==================== 全局变量 ====================
let currentMode = 'AUTO';
let isManualMode = false;
let mqttClient = null;
let mqttConnected = false;
let reconnectAttempts = 0;
const MAX_RECONNECT = 10;

// ==================== DOM 引用 ====================
const $ = id => document.getElementById(id);
const logEl = $('log');

// ==================== 日志函数 ====================
function log(msg, isError = false) {
    const time = new Date().toLocaleTimeString();
    const lines = logEl.textContent.split('\n');
    if (lines.length > 100) {
        lines.splice(0, 20);
    }
    logEl.textContent = lines.join('\n') + '\n[' + time + '] ' + (isError ? '❌' : '✅') + msg;
    logEl.scrollTop = logEl.scrollHeight;
}

// ==================== 更新连接状态 ====================
function updateConnectionStatus(connected) {
    if (connected) {
        $('badge').textContent = '已连接';
        $('badge').className = 'badge on';
        $('mqttStatus').textContent = 'MQTT:✅';
        $('remoteStatus').textContent = '状态: ✅ 已连接';
        $('remoteStatus').style.color = '#48bb78';
    } else {
        $('badge').textContent = '离线';
        $('badge').className = 'badge off';
        $('mqttStatus').textContent = 'MQTT:❌';
        $('remoteStatus').textContent = '状态: ❌ 已断开';
        $('remoteStatus').style.color = '#fc8181';
    }
}

// ==================== 更新继电器显示 ====================
function updateRelays(relay) {
    const names = ['cool', 'fan', 'humi', 'heat'];
    const icons = ['❄️', '🌀', '💦', '🔥'];
    names.forEach((n, i) => {
        const el = $('r-' + n);
        if (!el) return;
        const on = relay && relay[i] === 1;
        el.className = 'relay-item ' + (on ? 'on' : 'off');
        const statusEl = el.querySelector('.status');
        if (statusEl) {
            statusEl.textContent = on ? '● 开启' : '○ 关闭';
        }
        const iconEl = el.querySelector('.icon');
        if (iconEl) {
            iconEl.textContent = on ? icons[i] + '🔥' : icons[i];
        }
    });
}

// ==================== 更新界面数据 ====================
function updateUI(data) {
    if (!data) return;
    
    if (data.temp !== undefined) $('st').textContent = data.temp.toFixed(1);
    if (data.humi !== undefined) $('sh').textContent = data.humi.toFixed(1);
    if (data.co2 !== undefined) $('sc').textContent = data.co2;

    const sensorOk = data.sensorValid !== undefined ? data.sensorValid : true;
    $('sensorStatus').textContent = sensorOk ? '传感器:✅' : '传感器:❌';

    if (data.tMin !== undefined) {
        $('tMin').value = data.tMin;
        $('tMax').value = data.tMax;
        $('hMin').value = data.hMin;
        $('hMax').value = data.hMax;
        $('cMin').value = data.cMin;
        $('cMax').value = data.cMax;
    }

    if (data.mode) {
        currentMode = data.mode;
        isManualMode = (currentMode === 'MANUAL');
        $('modeDisplay').textContent = currentMode;
        $('modeBadge').textContent = currentMode;
        $('modeBadge').className = 'mode-badge ' + (isManualMode ? 'manual' : 'auto');
    }

    if (data.relay) {
        updateRelays(data.relay);
    }

    $('lastUpdate').textContent = new Date().toLocaleTimeString();
}

// ==================== 发送指令 ====================
function sendCommand(command) {
    log('📡 发送指令: ' + command);

    if (!mqttConnected || !mqttClient) {
        log('❌ MQTT 未连接，指令发送失败', true);
        return false;
    }

    mqttClient.publish(BEMFA_CONFIG.setTopic, command, { qos: 0 });
    log('✅ 指令已发送');
    $('remoteStatus').textContent = '状态: 指令已发送 ' + new Date().toLocaleTimeString();
    return true;
}

// ==================== 控制继电器 ====================
function controlRelay(relay, state) {
    if (!isManualMode) {
        log('⚠️ 请先切换到手动模式', true);
        alert('请先切换到手动模式！');
        return;
    }
    sendCommand('M:' + relay + ',' + state);
}

// ==================== 切换模式 ====================
function setMode(mode) {
    sendCommand(mode);
    setTimeout(() => sendCommand('STATUS'), 500);
}

// ==================== 设置参数 ====================
function setParams() {
    const tMin = $('tMin').value;
    const tMax = $('tMax').value;
    const hMin = $('hMin').value;
    const hMax = $('hMax').value;
    const cMin = $('cMin').value;
    const cMax = $('cMax').value;

    if (parseFloat(tMin) >= parseFloat(tMax)) {
        alert('温度下限必须小于上限！');
        return;
    }
    if (parseFloat(hMin) >= parseFloat(hMax)) {
        alert('湿度下限必须小于上限！');
        return;
    }
    if (parseInt(cMin) >= parseInt(cMax)) {
        alert('CO₂下限必须小于上限！');
        return;
    }

    log('📤 设置参数...');
    sendCommand('T:' + tMin + ',' + tMax);
    setTimeout(() => sendCommand('H:' + hMin + ',' + hMax), 300);
    setTimeout(() => sendCommand('C:' + cMin + ',' + cMax), 600);
    setTimeout(() => sendCommand('STATUS'), 1000);
}

// ==================== 恢复默认 ====================
function resetDefault() {
    if (!confirm('确认恢复出厂设置？')) return;
    log('↺ 恢复默认参数...');
    sendCommand('RST');
    setTimeout(() => sendCommand('STATUS'), 500);
}

// ==================== MQTT 连接（使用 MQTT.js） ====================
function connectMqtt() {
    if (reconnectAttempts >= MAX_RECONNECT) {
        log('⚠️ 重连次数过多，停止重连', true);
        return;
    }

    try {
        log('🌐 连接巴法云 MQTT...');
        $('remoteStatus').textContent = '状态: ⏳ 连接中...';

        // 使用与 MQTTX 相同的配置
        const options = {
            clientId: BEMFA_CONFIG.userId,
            username: '',      // 留空
            password: '',      // 留空
            keepalive: 60,
            clean: true,
            protocolVersion: 4,  // MQTT 3.1.1
            reconnectPeriod: 0,  // 手动控制重连
            connectTimeout: 15000,
            resubscribe: true,
            // 针对巴法云的特殊设置
            properties: {
                sessionExpiryInterval: 0,
                receiveMaximum: 65535,
                maximumPacketSize: 65535
            }
        };

        log('📡 Client ID: ' + options.clientId);
        log('📡 MQTT 版本: 3.1.1');

        mqttClient = mqtt.connect(BEMFA_CONFIG.mqttUrl, options);

        mqttClient.on('connect', function(connack) {
            mqttConnected = true;
            reconnectAttempts = 0;
            log('✅ 巴法云 MQTT 连接成功！');
            updateConnectionStatus(true);

            // 订阅状态主题
            mqttClient.subscribe(BEMFA_CONFIG.stateTopic, { qos: 0 }, function(err) {
                if (err) {
                    log('❌ 订阅失败: ' + err.message, true);
                } else {
                    log('📡 订阅主题: ' + BEMFA_CONFIG.stateTopic);
                }
            });

            // 请求一次状态
            setTimeout(function() {
                sendCommand('STATUS');
            }, 1000);
        });

        mqttClient.on('message', function(topic, message) {
            try {
                const payload = message.toString();
                log('📩 收到消息: ' + payload.substring(0, 100));
                
                if (topic === BEMFA_CONFIG.stateTopic) {
                    try {
                        const jsonData = JSON.parse(payload);
                        updateUI(jsonData);
                        log('📊 数据已更新');
                    } catch (e) {
                        // 忽略解析错误
                    }
                }
            } catch (e) {
                log('处理消息失败: ' + e.message, true);
            }
        });

        mqttClient.on('error', function(error) {
            log('❌ MQTT 错误: ' + error.message, true);
        });

        mqttClient.on('close', function() {
            mqttConnected = false;
            log('⚠️ MQTT 断开连接', true);
            updateConnectionStatus(false);
            
            reconnectAttempts++;
            if (reconnectAttempts < MAX_RECONNECT) {
                const delay = Math.min(5000 * reconnectAttempts, 30000);
                log('🔄 ' + delay/1000 + '秒后重连 (第' + reconnectAttempts + '次)');
                setTimeout(connectMqtt, delay);
            } else {
                log('⚠️ 重连次数已达上限', true);
            }
        });

        mqttClient.on('reconnect', function() {
            log('🔄 正在重连...');
        });

        mqttClient.on('offline', function() {
            log('⚠️ MQTT 离线', true);
        });

    } catch (e) {
        log('❌ 连接失败: ' + e.message, true);
        reconnectAttempts++;
        setTimeout(connectMqtt, 5000);
    }
}

// ==================== 页面初始化 ====================
document.addEventListener('DOMContentLoaded', function() {
    // 按钮事件
    $('autoBtn').addEventListener('click', function() {
        setMode('AUTO');
    });
    $('manualBtn').addEventListener('click', function() {
        setMode('MANUAL');
    });

    // 回车触发应用
    document.querySelectorAll('.param-row input').forEach(function(input) {
        input.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                setParams();
            }
        });
    });

    log('🚀 系统启动');
    log('🌐 MQTT 地址: ' + BEMFA_CONFIG.mqttUrl);

    // 检查 MQTT.js 是否加载
    if (typeof mqtt === 'undefined') {
        log('❌ MQTT.js 库未加载，请检查网络', true);
        return;
    }

    // 延迟连接 MQTT
    setTimeout(connectMqtt, 1000);

    // 每10秒自动刷新状态
    setInterval(function() {
        if (mqttConnected) {
            sendCommand('STATUS');
        }
    }, 10000);

    window.onerror = function(msg) {
        log('错误: ' + msg, true);
        return false;
    };
});

// ==================== 暴露全局函数 ====================
window.controlRelay = controlRelay;
window.setMode = setMode;
window.setParams = setParams;
window.resetDefault = resetDefault;
window.sendCommand = sendCommand;
