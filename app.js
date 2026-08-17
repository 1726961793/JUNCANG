// ==================== 巴法云配置 ====================
const BEMFA_CONFIG = {
    userId: '2daa242c1aec4c6da3cc425d6398293e',
    topic: 'juncang006',
    mqttUrl: 'wss://bemfa.com:9504/wss',
    setTopic: 'juncang006/set',
    stateTopic: 'juncang006/state'
};

// ==================== 全局变量 ====================
let mqttClient = null;
let mqttConnected = false;
let currentMode = 'AUTO';
let isManualMode = false;

// ==================== DOM 引用 ====================
const $ = id => document.getElementById(id);
const logEl = $('log');

// ==================== 日志函数 ====================
function log(msg, isError = false) {
    const time = new Date().toLocaleTimeString();
    const lines = logEl.textContent.split('\n');
    if (lines.length > 100) lines.splice(0, 20);
    logEl.textContent = lines.join('\n') + '\n[' + time + '] ' + (isError ? '❌' : '✅') + msg;
    logEl.scrollTop = logEl.scrollHeight;
}

// ==================== 更新 UI ====================
function updateRelays(relay) {
    const names = ['cool', 'fan', 'humi', 'heat'];
    const icons = ['❄️', '🌀', '💦', '🔥'];
    names.forEach((n, i) => {
        const el = $('r-' + n);
        if (!el) return;
        const on = relay && relay[i] === 1;
        el.className = 'relay-item ' + (on ? 'on' : 'off');
        const statusEl = el.querySelector('.status');
        if (statusEl) statusEl.textContent = on ? '● 开启' : '○ 关闭';
        const iconEl = el.querySelector('.icon');
        if (iconEl) iconEl.textContent = on ? icons[i] + '🔥' : icons[i];
    });
}

function updateUI(data) {
    if (!data) {
        log('⚠️ 收到空数据', true);
        return;
    }
    
    log('📊 解析数据: ' + JSON.stringify(data));
    
    if (data.temp !== undefined) $('st').textContent = data.temp.toFixed(1);
    if (data.humi !== undefined) $('sh').textContent = data.humi.toFixed(1);
    if (data.co2 !== undefined) $('sc').textContent = data.co2;
    if (data.relay) updateRelays(data.relay);
    if (data.mode) {
        currentMode = data.mode;
        isManualMode = (currentMode === 'MANUAL');
        $('modeDisplay').textContent = currentMode;
        $('modeBadge').textContent = currentMode;
        $('modeBadge').className = 'mode-badge ' + (isManualMode ? 'manual' : 'auto');
    }
    if (data.tMin !== undefined) {
        $('tMin').value = data.tMin;
        $('tMax').value = data.tMax;
        $('hMin').value = data.hMin;
        $('hMax').value = data.hMax;
        $('cMin').value = data.cMin;
        $('cMax').value = data.cMax;
    }
    $('lastUpdate').textContent = new Date().toLocaleTimeString();
    const sensorOk = data.sensorValid !== undefined ? data.sensorValid : true;
    $('sensorStatus').textContent = sensorOk ? '传感器:✅' : '传感器:❌';
}

// ==================== 发送指令 ====================
function sendCommand(command) {
    if (!mqttConnected || !mqttClient) {
        log('⚠️ MQTT 未连接', true);
        return;
    }
    log('📡 发送: ' + command);
    mqttClient.publish(BEMFA_CONFIG.setTopic, command, { qos: 0 });
    $('remoteStatus').textContent = '状态: 已发送 ' + new Date().toLocaleTimeString();
}

// ==================== 控制函数 ====================
function controlRelay(relay, state) {
    if (!isManualMode) {
        log('⚠️ 请先切换到手动模式', true);
        alert('请先切换到手动模式！');
        return;
    }
    sendCommand('M:' + relay + ',' + state);
}

function setMode(mode) {
    sendCommand(mode);
    setTimeout(() => sendCommand('STATUS'), 800);
}

function setParams() {
    const tMin = $('tMin').value, tMax = $('tMax').value;
    const hMin = $('hMin').value, hMax = $('hMax').value;
    const cMin = $('cMin').value, cMax = $('cMax').value;
    if (parseFloat(tMin) >= parseFloat(tMax)) { alert('温度下限必须小于上限！'); return; }
    if (parseFloat(hMin) >= parseFloat(hMax)) { alert('湿度下限必须小于上限！'); return; }
    if (parseInt(cMin) >= parseInt(cMax)) { alert('CO₂下限必须小于上限！'); return; }
    sendCommand('T:' + tMin + ',' + tMax);
    setTimeout(() => sendCommand('H:' + hMin + ',' + hMax), 300);
    setTimeout(() => sendCommand('C:' + cMin + ',' + cMax), 600);
    setTimeout(() => sendCommand('STATUS'), 1000);
}

function resetDefault() {
    if (!confirm('确认恢复出厂设置？')) return;
    sendCommand('RST');
    setTimeout(() => sendCommand('STATUS'), 500);
}

// ==================== MQTT 连接 ====================
function connectMqtt() {
    if (mqttClient && mqttConnected) {
        log('MQTT 已连接');
        return;
    }

    try {
        log('🌐 连接巴法云 MQTT...');
        $('remoteStatus').textContent = '状态: ⏳ 连接中...';

        const options = {
            clientId: BEMFA_CONFIG.userId,
            username: '',
            password: '',
            keepalive: 60,
            clean: true,
            protocolVersion: 4,
            reconnectPeriod: 0,
            connectTimeout: 15000
        };

        log('📡 Client ID: ' + options.clientId);
        log('📡 地址: ' + BEMFA_CONFIG.mqttUrl);

        mqttClient = mqtt.connect(BEMFA_CONFIG.mqttUrl, options);

        mqttClient.on('connect', function(connack) {
            mqttConnected = true;
            log('✅ MQTT 连接成功！');
            $('mqttStatus').textContent = 'MQTT:✅';
            $('badge').textContent = '已连接';
            $('badge').className = 'badge on';
            $('remoteStatus').textContent = '状态: ✅ 已连接';
            $('remoteStatus').style.color = '#48bb78';

            // 订阅状态主题
            mqttClient.subscribe(BEMFA_CONFIG.stateTopic, { qos: 0 }, function(err) {
                if (err) {
                    log('❌ 订阅失败: ' + err.message, true);
                } else {
                    log('📡 订阅: ' + BEMFA_CONFIG.stateTopic);
                }
            });

            // 订阅通配符，查看所有消息（调试用）
            mqttClient.subscribe('juncang006/#', { qos: 0 }, function(err) {
                if (!err) {
                    log('📡 订阅: juncang006/# (调试模式)');
                }
            });

            // 请求状态
            setTimeout(() => sendCommand('STATUS'), 500);
        });

        mqttClient.on('message', function(topic, message) {
            try {
                const payload = message.toString();
                log('📩 [' + topic + '] ' + payload);
                
                // 显示在状态栏
                $('mqttStatus').textContent = 'MQTT:📩';
                
                if (topic === BEMFA_CONFIG.stateTopic) {
                    try {
                        const data = JSON.parse(payload);
                        updateUI(data);
                        log('📊 数据已更新');
                    } catch (e) {
                        log('⚠️ JSON解析失败: ' + e.message, true);
                    }
                }
            } catch (e) {
                log('⚠️ 处理消息失败: ' + e.message, true);
            }
        });

        mqttClient.on('error', function(error) {
            log('❌ MQTT 错误: ' + error.message, true);
        });

        mqttClient.on('close', function() {
            mqttConnected = false;
            log('⚠️ MQTT 断开', true);
            $('mqttStatus').textContent = 'MQTT:❌';
            $('badge').textContent = '离线';
            $('badge').className = 'badge off';
            $('remoteStatus').textContent = '状态: ❌ 已断开';
            $('remoteStatus').style.color = '#fc8181';
            setTimeout(connectMqtt, 5000);
        });

        mqttClient.on('offline', function() {
            log('⚠️ MQTT 离线', true);
        });

    } catch (e) {
        log('❌ 连接失败: ' + e.message, true);
        setTimeout(connectMqtt, 5000);
    }
}

// ==================== 页面初始化 ====================
document.addEventListener('DOMContentLoaded', function() {
    $('autoBtn').addEventListener('click', () => setMode('AUTO'));
    $('manualBtn').addEventListener('click', () => setMode('MANUAL'));
    document.querySelectorAll('.param-row input').forEach(input => {
        input.addEventListener('keypress', function(e) { if (e.key === 'Enter') setParams(); });
    });

    log('🚀 系统启动');
    log('🌐 地址: ' + BEMFA_CONFIG.mqttUrl);
    log('📡 私钥: ' + BEMFA_CONFIG.userId);
    log('📡 主题: ' + BEMFA_CONFIG.topic);

    if (typeof mqtt === 'undefined') {
        log('❌ MQTT.js 未加载', true);
        return;
    }

    connectMqtt();

    // 每15秒请求状态
    setInterval(() => {
        if (mqttConnected) sendCommand('STATUS');
    }, 15000);

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
