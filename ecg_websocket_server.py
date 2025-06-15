import asyncio
import json
import time
import websockets
import numpy as np
from collections import deque
from bleak import BleakScanner, BleakClient

class ECGWebSocketServer:
    """ECG WebSocket Server - Keeps your exact Polar H10 connection code"""
    
    # Same exact Polar H10 constants from your working code
    PMD_SERVICE_UUID = "fb005c80-02e7-f387-1cad-8acd2d8df0c8"
    PMD_CHAR1_UUID = "fb005c81-02e7-f387-1cad-8acd2d8df0c8"
    PMD_CHAR2_UUID = "fb005c82-02e7-f387-1cad-8acd2d8df0c8"
    DEVICE_INFORMATION_SERVICE = "0000180a-0000-1000-8000-00805f9b34fb"
    MANUFACTURER_NAME_UUID = "00002a29-0000-1000-8000-00805f9b34fb"
    MODEL_NBR_UUID = "00002a24-0000-1000-8000-00805f9b34fb"
    BATTERY_SERVICE_UUID = "0000180f-0000-1000-8000-00805f9b34fb"
    BATTERY_LEVEL_UUID = "00002a19-0000-1000-8000-00805f9b34fb"
    REQ_STREAM = bytearray([0x01, 0x02])
    REQ_ECG = bytearray([0x01, 0x00])
    START_STREAM = bytearray([0x02, 0x00, 0x00, 0x01, 0x82, 0x00, 0x01, 0x01, 0x0E, 0x00])
    ECG_SAMPLING_FREQ = 130
    
    def __init__(self):
        self.client = None
        self.ecg_data = deque(maxlen=15600)  # Store ECG samples
        self.ecg_times = deque(maxlen=15600)  # Store timestamps
        self.start_time = time.time()
        self.stream_ready = False
        self.is_connected = False
        self.websocket_clients = set()  # Connected WebSocket clients
        
    async def scan_and_connect(self):
        """Same exact connection code from your working script"""
        print("🔍 Scanning for Polar devices...")
        devices = await BleakScanner.discover(timeout=15)
        
        for device in devices:
            if device.name and "Polar" in device.name:
                print(f"✅ Found: {device.name}")
                try:
                    self.client = BleakClient(device, timeout=30.0, 
                                            winrt={"use_cached_services": False})
                    await self.client.connect()
                    await asyncio.sleep(2)
                    await self.get_device_info()
                    self.is_connected = True
                    await self.broadcast_status()
                    return True
                except Exception as e:
                    print(f"❌ Connection failed: {e}")
                    continue
        return False
    
    async def get_device_info(self):
        """Same exact device info code"""
        try:
            model = await self.client.read_gatt_char(self.MODEL_NBR_UUID)
            battery = await self.client.read_gatt_char(self.BATTERY_LEVEL_UUID)
            print(f"📱 Connected: {''.join(map(chr, model))} ({battery[0]}% battery)")
        except Exception as e:
            print(f"❌ Device info error: {e}")
    
    def pmd_control_callback(self, sender, data):
        """Same exact callback"""
        if len(data) >= 2 and data[0] == 0xF0 and data[1] == 0x01:
            self.stream_ready = True
            asyncio.create_task(self.send_start_command())
    
    async def send_start_command(self):
        """Same exact start command"""
        try:
            await self.client.write_gatt_char(self.PMD_CHAR1_UUID, self.START_STREAM, response=True)
        except Exception as e:
            print(f"❌ Start failed: {e}")
    
    def ecg_data_callback(self, sender, data):
        """Same exact ECG data parsing + WebSocket broadcast"""
        if len(data) != 229:
            return
        
        try:
            if len(self.ecg_data) == 0:
                self.start_time = time.time()
            samples_extracted = 0
            current_time = time.time() - self.start_time
            
            new_samples = []
            new_times = []
            
            for i in range(10, len(data), 3):
                if i + 2 < len(data):
                    ecg_raw = int.from_bytes(data[i:i+3], 'little', signed=True)
                    sample_time = current_time + (samples_extracted / self.ECG_SAMPLING_FREQ)
                    
                    self.ecg_data.append(ecg_raw)
                    self.ecg_times.append(sample_time)
                    
                    new_samples.append(ecg_raw)
                    new_times.append(sample_time)
                    samples_extracted += 1
            
            # Send new data to WebSocket clients
            if new_samples:
                asyncio.create_task(self.broadcast_ecg_data(new_samples, new_times))
                
        except Exception as e:
            print(f"❌ ECG error: {e}")
    
    async def start_ecg_stream(self):
        """Same exact ECG stream setup"""
        try:
            await self.client.start_notify(self.PMD_CHAR1_UUID, self.pmd_control_callback)
            await asyncio.sleep(1)
            await self.client.write_gatt_char(self.PMD_CHAR1_UUID, self.REQ_STREAM, response=True)
            await asyncio.sleep(1)
            await self.client.write_gatt_char(self.PMD_CHAR1_UUID, self.REQ_ECG, response=True)
            await asyncio.sleep(2)
            await self.client.start_notify(self.PMD_CHAR2_UUID, self.ecg_data_callback)
            
            for i in range(10):
                if self.stream_ready:
                    break
                await asyncio.sleep(1)
            
            print("✅ ECG streaming active!")
            return True
        except Exception as e:
            print(f"❌ ECG setup failed: {e}")
            return False
    
    async def disconnect(self):
        """Disconnect from device"""
        try:
            if self.client and self.client.is_connected:
                await self.client.disconnect()
            self.is_connected = False
            await self.broadcast_status()
            print("👋 Disconnected")
        except Exception as e:
            print(f"❌ Disconnect error: {e}")
    
    # WebSocket methods
    async def register_client(self, websocket):
        """Register new WebSocket client"""
        self.websocket_clients.add(websocket)
        print(f"📱 Client connected. Total clients: {len(self.websocket_clients)}")
        
        # Send current status to new client
        await self.send_to_client(websocket, {
            "type": "status",
            "connected": self.is_connected,
            "timestamp": time.time()
        })
    
    async def unregister_client(self, websocket):
        """Unregister WebSocket client"""
        self.websocket_clients.discard(websocket)
        print(f"📱 Client disconnected. Total clients: {len(self.websocket_clients)}")
    
    async def send_to_client(self, websocket, data):
        """Send data to specific client"""
        try:
            await websocket.send(json.dumps(data))
        except websockets.exceptions.ConnectionClosed:
            await self.unregister_client(websocket)
    
    async def broadcast_ecg_data(self, samples, times):
        """Broadcast ECG data to all clients"""
        if not self.websocket_clients:
            return
        
        message = {
            "type": "ecg_data",
            "samples": samples,
            "times": times,
            "timestamp": time.time()
        }
        
        # Send to all connected clients
        disconnected_clients = set()
        for client in self.websocket_clients:
            try:
                await client.send(json.dumps(message))
            except websockets.exceptions.ConnectionClosed:
                disconnected_clients.add(client)
        
        # Remove disconnected clients
        for client in disconnected_clients:
            await self.unregister_client(client)
    
    async def broadcast_status(self):
        """Broadcast connection status to all clients"""
        if not self.websocket_clients:
            return
        
        message = {
            "type": "status",
            "connected": self.is_connected,
            "timestamp": time.time()
        }
        
        for client in self.websocket_clients:
            await self.send_to_client(client, message)
    
    async def handle_client_message(self, websocket, message):
        """Handle messages from WebSocket clients"""
        try:
            data = json.loads(message)
            command = data.get("command")
            
            if command == "connect":
                print("📡 Received connect command from client")
                if not self.is_connected:
                    self.start_time = time.time()  # Reset timer
                    self.ecg_data.clear()  # ADD THIS
                    self.ecg_times.clear()  # ADD THIS
                    success = await self.scan_and_connect()
                    if success:
                        await self.start_ecg_stream()
                    else:
                        await self.send_to_client(websocket, {
                            "type": "error",
                            "message": "Failed to connect to Polar H10"
                        })
                        
            elif command == "disconnect":
                print("📡 Received disconnect command from client")
                await self.disconnect()
                
            elif command == "status":
                await self.send_to_client(websocket, {
                    "type": "status", 
                    "connected": self.is_connected,
                    "timestamp": time.time()
                })
                
        except json.JSONDecodeError:
            await self.send_to_client(websocket, {
                "type": "error", 
                "message": "Invalid JSON"
            })
    
    async def websocket_handler(self, websocket):
        """Handle WebSocket connections"""
        await self.register_client(websocket)
        try:
            async for message in websocket:
                await self.handle_client_message(websocket, message)
        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            await self.unregister_client(websocket)

# Global ECG server instance
ecg_server = ECGWebSocketServer()

async def main():
    """Start WebSocket server"""
    print("🫀 ECG WebSocket Server Starting...")
    print("📡 Listening on ws://localhost:8765")
    print("🔗 Next.js frontend can connect to this server")
    
    # Start WebSocket server
    server = await websockets.serve(
        ecg_server.websocket_handler, 
        "localhost", 
        8765,
        ping_interval=20,
        ping_timeout=10
    )
    
    print("✅ WebSocket server running!")
    print("💡 Waiting for Next.js frontend to connect...")
    
    # Keep server running
    await server.wait_closed()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n👋 Server stopped by user")
    except Exception as e:
        print(f"❌ Server error: {e}")