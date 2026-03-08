#!/usr/bin/env python
"""
Guardian Net - Fall and Voice Detection Only
Runs Fall and Voice detection simultaneously without gesture detection
"""

# Suppress OpenCV warnings at the very top
import os
os.environ['OPENCV_LOG_LEVEL'] = 'ERROR'
os.environ['OPENCV_VIDEOIO_DEBUG'] = '0'

import cv2
cv2.setLogLevel(0)  # Suppress OpenCV logs

import numpy as np
import time
import threading
import queue
import sys
import warnings
from datetime import datetime
warnings.filterwarnings('ignore')

# Add the current directory to path and import our integration module
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from guardian_integration import GuardianAlertSender

# ==================== FALL DETECTION IMPORTS ====================
from ultralytics import YOLO
from collections import deque

# ==================== VOICE DETECTION IMPORTS ====================
import speech_recognition as sr
import json
import re
import winsound

# ==================== SHARED ALERT QUEUE ====================
alert_queue = queue.Queue()

# ==================== FALL DETECTION CLASS ====================
class UnifiedFallDetector:
    def __init__(self, alert_sender, shared_state):
        print("   📹 Initializing Fall Detection...")
        self.alert_sender = alert_sender
        self.shared_state = shared_state
        self.pose_model = YOLO('yolov8n-pose.pt')
        
        self.state = "MONITORING"
        self.total_falls = 0
        self.consecutive_fall_frames = 0
        self.consecutive_stand_frames = 0
        self.fall_start_time = 0
        
        self.fall_confidence_threshold = 0.65
        self.required_fall_frames = 5
        self.required_stand_frames = 8
        
        self.fall_confidence_history = deque(maxlen=8)
        self.pose_history = deque(maxlen=10)
        
        self.last_alert_time = 0
        self.alert_cooldown = 30
        self.running = True
        self.frame_queue = queue.Queue(maxsize=2)
        
        print("   ✅ Fall Detection Ready")

    def calculate_fall_confidence(self, keypoints, frame_shape):
        if keypoints is None or len(keypoints) == 0:
            return 0.0
        
        confidence_scores = []
        keypoints = keypoints[0]
        
        if len(keypoints) >= 13:
            left_shoulder = keypoints[5]
            right_shoulder = keypoints[6]
            left_hip = keypoints[11]
            right_hip = keypoints[12]
            
            if (left_shoulder[2] > 0.2 and right_shoulder[2] > 0.2 and 
                left_hip[2] > 0.2 and right_hip[2] > 0.2):
                
                shoulder_center = (left_shoulder[:2] + right_shoulder[:2]) / 2
                hip_center = (left_hip[:2] + right_hip[:2]) / 2
                
                dx = hip_center[0] - shoulder_center[0]
                dy = hip_center[1] - shoulder_center[1]
                
                angle = np.degrees(np.arctan2(abs(dx), abs(dy))) if abs(dy) > 0.001 else 90.0
                angle_confidence = max(0.0, min(1.0, (angle - 30) / 60.0))
                confidence_scores.append(angle_confidence * 0.5)
        
        if len(keypoints) >= 17:
            valid_points = [kp for kp in keypoints if kp[2] > 0.2]
            if len(valid_points) >= 4:
                y_coords = [kp[1] for kp in valid_points]
                x_coords = [kp[0] for kp in valid_points]
                
                height = max(y_coords) - min(y_coords)
                width = max(x_coords) - min(x_coords)
                
                if width > 0 and height > 0:
                    aspect_ratio = height / width
                    if aspect_ratio < 1.0:
                        aspect_confidence = 1.0
                    elif aspect_ratio < 2.0:
                        aspect_confidence = 1.5 - (aspect_ratio / 2.0)
                    else:
                        aspect_confidence = 0.0
                    confidence_scores.append(aspect_confidence * 0.3)
        
        if len(keypoints) >= 17:
            ankle_indices = [15, 16]
            head_indices = [3, 4]
            
            valid_ankles = [keypoints[i] for i in ankle_indices if keypoints[i][2] > 0.2]
            valid_head = [keypoints[i] for i in head_indices if keypoints[i][2] > 0.2]
            
            if valid_ankles and valid_head:
                ankle_y = max([kp[1] for kp in valid_ankles])
                ground_confidence = min(1.0, ankle_y * 1.5)
                confidence_scores.append(ground_confidence * 0.2)
        
        return float(min(1.0, sum(confidence_scores))) if confidence_scores else 0.0

    def calculate_stand_confidence(self, keypoints):
        if keypoints is None or len(keypoints) == 0:
            return 0.0
        
        stand_scores = []
        keypoints = keypoints[0]
        
        if len(keypoints) >= 13:
            left_shoulder = keypoints[5]
            right_shoulder = keypoints[6]
            left_hip = keypoints[11]
            right_hip = keypoints[12]
            
            if (left_shoulder[2] > 0.2 and right_shoulder[2] > 0.2 and 
                left_hip[2] > 0.2 and right_hip[2] > 0.2):
                
                shoulder_center = (left_shoulder[:2] + right_shoulder[:2]) / 2
                hip_center = (left_hip[:2] + right_hip[:2]) / 2
                
                dx = hip_center[0] - shoulder_center[0]
                dy = hip_center[1] - shoulder_center[1]
                
                angle = np.degrees(np.arctan2(abs(dx), abs(dy))) if abs(dy) > 0.001 else 90.0
                
                if angle < 25:
                    stand_confidence = 1.0
                elif angle < 45:
                    stand_confidence = 1.0 - ((angle - 25) / 20.0)
                else:
                    stand_confidence = 0.0
                
                stand_scores.append(stand_confidence)
        
        if len(keypoints) >= 17:
            valid_points = [kp for kp in keypoints if kp[2] > 0.2]
            if len(valid_points) >= 4:
                height = max([kp[1] for kp in valid_points]) - min([kp[1] for kp in valid_points])
                stand_scores.append(min(1.0, height * 2.0) * 0.5)
        
        return float(np.mean(stand_scores)) if stand_scores else 0.0

    def update_state_machine(self, fall_confidence, stand_confidence):
        current_time = time.time()
        
        if self.state == "MONITORING":
            if fall_confidence > self.fall_confidence_threshold:
                self.consecutive_fall_frames += 1
                self.fall_confidence_history.append(fall_confidence)
                
                if (self.consecutive_fall_frames >= self.required_fall_frames and 
                    np.mean(self.fall_confidence_history) > self.fall_confidence_threshold):
                    
                    self.state = "FALL_DETECTED"
                    self.fall_start_time = current_time
                    self.total_falls += 1
                    self.consecutive_stand_frames = 0
                    
                    # Queue alert
                    if current_time - self.last_alert_time > self.alert_cooldown:
                        self.last_alert_time = current_time
                        message = f"🚨 Fall detected with {fall_confidence:.1%} confidence!"
                        alert_queue.put(("fall", message, float(fall_confidence)))
                        
                        print(f"\n🔥 FALL DETECTED! (Confidence: {fall_confidence:.2f})")
            else:
                self.consecutive_fall_frames = max(0, self.consecutive_fall_frames - 2)
        
        elif self.state == "FALL_DETECTED":
            if stand_confidence > 0.7:
                self.consecutive_stand_frames += 1
                if self.consecutive_stand_frames >= self.required_stand_frames:
                    self.state = "MONITORING"
                    self.consecutive_fall_frames = 0
                    self.fall_confidence_history.clear()
                    print("   ✅ Person stood up")
            elif current_time - self.fall_start_time > 30:
                self.state = "MONITORING"
                self.consecutive_fall_frames = 0
                self.fall_confidence_history.clear()

    def process_frame(self, frame):
        processing_frame = cv2.resize(frame, (640, 480))
        results = self.pose_model(processing_frame, verbose=False, conf=0.5, imgsz=320)
        
        fall_confidence = 0.0
        stand_confidence = 0.0
        keypoints = None
        
        if results and results[0].keypoints is not None:
            keypoints = results[0].keypoints.data.cpu().numpy()
            if len(keypoints) > 0:
                fall_confidence = self.calculate_fall_confidence(keypoints, frame.shape)
                stand_confidence = self.calculate_stand_confidence(keypoints)
        
        self.update_state_machine(fall_confidence, stand_confidence)
        
        # Update shared state for display
        self.shared_state['fall'] = {
            'state': self.state,
            'confidence': fall_confidence,
            'total': self.total_falls
        }
        
        return fall_confidence, stand_confidence, keypoints

    def fall_detection_loop(self):
        """Fall detection loop with better camera handling"""
        cap = None
        
        # Try camera indices
        for camera_index in [0, 1]:
            cap = cv2.VideoCapture(camera_index)
            if cap.isOpened():
                ret, test_frame = cap.read()
                if ret and test_frame is not None:
                    print(f"   ✅ Fall camera found at index {camera_index}")
                    break
                else:
                    cap.release()
                    cap = None
        
        if cap is None:
            print("   ❌ Cannot open camera for fall detection")
            self.running = False
            return
            
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

        error_count = 0
        
        while self.running:
            try:
                ret, frame = cap.read()
                if not ret or frame is None:
                    error_count += 1
                    if error_count > 10:
                        print("   ⚠️ Fall camera lost")
                        break
                    time.sleep(0.1)
                    continue
                
                error_count = 0
                self.process_frame(frame)
                
                # Put frame in queue for display
                if not self.frame_queue.full():
                    self.frame_queue.put(frame.copy())
                    
            except Exception as e:
                print(f"   ⚠️ Fall error: {e}")
                time.sleep(0.5)

        cap.release()
        print("   👋 Fall detection stopped")

    def stop(self):
        self.running = False


# ==================== VOICE DETECTION CLASS ====================
class UnifiedVoiceDetector:
    def __init__(self, alert_sender, shared_state):
        print("   🎤 Initializing Voice Detection...")
        self.alert_sender = alert_sender
        self.shared_state = shared_state
        
        self.recognizer = sr.Recognizer()
        self.microphone = sr.Microphone()
        self.is_listening = True
        self.emergency_count = 0
        
        # Default keywords
        self.keywords = {
            'english': ['help', 'emergency', 'accident', 'fall', 'fell', 'hurt', 'pain', 'save', 'please help', 'help me'],
            'malayalam': ['സഹായം', 'അടിയന്തരം', 'അപകടം', 'വീഴ്ച', 'വീണു', 'വേദന'],
            'hindi': ['मदद', 'आपातकाल', 'दुर्घटना', 'गिर गया', 'चोट', 'दर्द']
        }
        
        self.supported_languages = ['en-IN', 'ml-IN', 'hi-IN']
        self.current_language = 'en-IN'
        
        self.last_alert_time = 0
        self.alert_cooldown = 15
        self.running = True
        self.listening_status = "Listening"
        
        # Calibrate microphone
        print("   🔊 Calibrating microphone...")
        with self.microphone as source:
            try:
                self.recognizer.adjust_for_ambient_noise(source, duration=1)
                print("   ✅ Microphone calibrated")
            except Exception as e:
                print(f"   ⚠️ Calibration error: {e}")
        
        print("   ✅ Voice Detection Ready")

    def detect_language(self, text):
        if re.search(r'[\u0D00-\u0D7F]', text):
            return 'malayalam'
        elif re.search(r'[\u0900-\u097F]', text):
            return 'hindi'
        else:
            return 'english'

    def check_emergency_keywords(self, text):
        text_lower = text.lower()
        found_keywords = []
        
        for lang, words in self.keywords.items():
            for word in words:
                if word.lower() in text_lower:
                    found_keywords.append(word)
        
        return found_keywords

    def transcribe_speech(self, audio):
        try:
            text = self.recognizer.recognize_google(audio, language=self.current_language)
            return text, True
        except:
            for lang in self.supported_languages:
                if lang != self.current_language:
                    try:
                        text = self.recognizer.recognize_google(audio, language=lang)
                        return text, True
                    except:
                        continue
            return None, False

    def voice_detection_loop(self):
        print("\n   🎤 Listening for voice commands...")
        
        with self.microphone as source:
            while self.running:
                try:
                    self.recognizer.adjust_for_ambient_noise(source, duration=0.3)
                    
                    try:
                        audio = self.recognizer.listen(source, timeout=1, phrase_time_limit=3)
                        
                        text, success = self.transcribe_speech(audio)
                        
                        if success and text:
                            print(f"   🗣️ Heard: '{text[:30]}...'")
                            
                            # Check for emergency keywords
                            keywords = self.check_emergency_keywords(text)
                            
                            if keywords and (time.time() - self.last_alert_time) > self.alert_cooldown:
                                self.last_alert_time = time.time()
                                self.emergency_count += 1
                                message = f"🚨 Voice emergency! Keywords: {', '.join(keywords)}"
                                alert_queue.put(("voice", message))
                                print(f"   🚨 Voice emergency detected! (Total: {self.emergency_count})")
                                
                                # Play sound
                                try:
                                    winsound.Beep(1000, 500)
                                except:
                                    pass
                            
                            self.listening_status = "Heard speech"
                        else:
                            self.listening_status = "Listening"
                    
                    except sr.WaitTimeoutError:
                        self.listening_status = "Listening"
                        continue
                        
                except Exception as e:
                    self.listening_status = "Error"
                    time.sleep(0.5)
                
                # Update shared state
                self.shared_state['voice'] = {
                    'status': self.listening_status,
                    'total': self.emergency_count
                }

    def stop(self):
        self.running = False


# ==================== ALERT HANDLER THREAD ====================
def alert_handler(alert_sender):
    """Process alerts from queue and send to server"""
    print("\n📡 Alert handler started")
    while True:
        try:
            item = alert_queue.get(timeout=1)
            
            # Handle different alert formats
            if len(item) == 3:
                alert_type, message, confidence = item
                print(f"\n📱 Sending {alert_type} alert with confidence {confidence}...")
                alert_sender.send_alert(alert_type, message, confidence)
            elif len(item) == 2:
                alert_type, message = item
                print(f"\n📱 Sending {alert_type} alert...")
                alert_sender.send_alert(alert_type, message)
            else:
                print(f"❌ Unknown alert format: {item}")
                
        except queue.Empty:
            continue
        except Exception as e:
            print(f"❌ Alert error: {e}")


# ==================== DISPLAY THREAD ====================
def display_thread(fall_detector, shared_state):
    """Show combined video feed"""
    cv2.namedWindow("Guardian Net - Fall & Voice Detection", cv2.WINDOW_NORMAL)
    cv2.resizeWindow("Guardian Net - Fall & Voice Detection", 800, 600)
    
    # Initialize shared state defaults
    if 'voice' not in shared_state:
        shared_state['voice'] = {'status': 'Listening', 'total': 0}
    if 'fall' not in shared_state:
        shared_state['fall'] = {'state': 'MONITORING', 'confidence': 0, 'total': 0}
    
    while fall_detector.running:
        try:
            # Get frame from fall detector
            frame = fall_detector.frame_queue.get(timeout=1)
            display_frame = frame.copy()
            
            h, w = display_frame.shape[:2]
            
            # Title
            cv2.rectangle(display_frame, (0, 0), (w, 80), (0, 0, 0), -1)
            cv2.putText(display_frame, "GUARDIAN NET - FALL & VOICE DETECTION", (20, 30),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)
            
            # Fall Detection Status
            fall_state = shared_state.get('fall', {})
            color = (0, 255, 0) if fall_state.get('state') == "MONITORING" else (0, 0, 255)
            cv2.putText(display_frame, f"FALL: {fall_state.get('state', 'N/A')}", (20, 110),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)
            cv2.putText(display_frame, f"Conf: {fall_state.get('confidence', 0):.2f}", (20, 135),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
            
            # Voice Status
            voice_state = shared_state.get('voice', {})
            cv2.putText(display_frame, f"VOICE: {voice_state.get('status', 'Listening')}", (20, 165),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)
            
            # Stats
            cv2.putText(display_frame, f"Falls: {fall_state.get('total', 0)}", (w-200, 110),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1)
            cv2.putText(display_frame, f"Voice: {voice_state.get('total', 0)}", (w-200, 135),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1)
            
            # Instructions
            cv2.putText(display_frame, "Press 'q' to quit", (w-150, h-20),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
            
            cv2.imshow("Guardian Net - Fall & Voice Detection", display_frame)
            
            if cv2.waitKey(1) & 0xFF == ord('q'):
                fall_detector.running = False
                break
                
        except queue.Empty:
            continue
        except Exception as e:
            print(f"Display error: {e}")
            break
    
    cv2.destroyAllWindows()


# ==================== MAIN FUNCTION ====================
def main():
    print("\n" + "="*70)
    print("🚀 GUARDIAN NET - FALL & VOICE DETECTION ONLY")
    print("="*70)
    
    # Get patient ID
    try:
        patient_id = int(input("Enter patient ID (default: 1): ") or "1")
    except:
        patient_id = 1
    
    print(f"\n📱 Patient ID: {patient_id}")
    print("="*70)
    
    # Initialize alert sender
    alert_sender = GuardianAlertSender(patient_id=patient_id)
    
    # Test connection
    if alert_sender.test_connection():
        print("✅ Connected to Guardian Net server")
    else:
        print("⚠️  Cannot connect to server - alerts will be logged only")
    
    # Shared state between threads
    shared_state = {
        'voice': {'status': 'Starting...', 'total': 0},
        'fall': {'state': 'Starting...', 'confidence': 0, 'total': 0}
    }
    
    # Initialize detectors
    print("\n🔧 Initializing detectors...")
    fall_detector = UnifiedFallDetector(alert_sender, shared_state)
    voice_detector = UnifiedVoiceDetector(alert_sender, shared_state)
    
    print("\n" + "="*70)
    print("✅ ALL DETECTORS READY - Starting threads...")
    print("="*70)
    print("📹 Fall Detection: Camera")
    print("🎤 Voice Detection: Microphone")
    print("\nPress 'q' in video window to quit")
    print("="*70 + "\n")
    
    # Start threads
    fall_thread = threading.Thread(target=fall_detector.fall_detection_loop, daemon=True)
    voice_thread = threading.Thread(target=voice_detector.voice_detection_loop, daemon=True)
    alert_thread = threading.Thread(target=alert_handler, args=(alert_sender,), daemon=True)
    display_thread_handle = threading.Thread(target=display_thread, args=(fall_detector, shared_state), daemon=True)
    
    fall_thread.start()
    voice_thread.start()
    alert_thread.start()
    display_thread_handle.start()
    
    # Keep main thread alive
    try:
        while fall_detector.running:
            time.sleep(0.1)
    except KeyboardInterrupt:
        print("\n\n🛑 Stopping detectors...")
    
    # Cleanup
    fall_detector.stop()
    voice_detector.stop()
    
    print("\n📊 Final Summary:")
    print(f"   Falls detected: {fall_detector.total_falls}")
    print(f"   Voice emergencies: {voice_detector.emergency_count}")
    print(f"   Alerts sent: {alert_sender.alert_count}")
    print("\n👋 Goodbye!")


if __name__ == "__main__":
    main()