import cv2
import numpy as np
from ultralytics import YOLO
import time
from collections import deque
import warnings
import os
import sys

# Add the current directory to path and import our integration module
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from guardian_integration import GuardianAlertSender

warnings.filterwarnings('ignore')

class GuardianFallDetector:
    def __init__(self, patient_id=1):
        print("\n" + "="*70)
        print("🚀 GUARDIAN NET - FALL DETECTION SYSTEM")
        print("="*70)
        
        print("Loading YOLOv8 Pose Estimation...")
        self.pose_model = YOLO('yolov8n-pose.pt')
        
        # Guardian Net integration
        self.patient_id = patient_id
        self.alert_sender = GuardianAlertSender(patient_id=patient_id)
        
        # Test connection to server
        if self.alert_sender.test_connection():
            print("✅ Connected to Guardian Net server")
            print(f"📱 Patient ID: {patient_id}")
        else:
            print("⚠️  Cannot connect to Guardian Net server")
            print("   Alerts will be logged locally only")
        
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
        
        print("✅ Fall detection system ready!")
        print("📊 Using proven pose-based fall detection algorithms")
        print("="*70 + "\n")

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
        
        return min(1.0, sum(confidence_scores)) if confidence_scores else 0.0

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
        
        return np.mean(stand_scores) if stand_scores else 0.0

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
                    
                    # Send alert to Guardian Net
                    message = f"🚨 Fall detected with {fall_confidence:.1%} confidence!"
                    self.alert_sender.send_alert("fall", message, fall_confidence)
                    
                    print("\n" + "!"*50)
                    print(f"🚨 FALL DETECTED! (Confidence: {fall_confidence:.2f})")
                    print(f"   Total falls: {self.total_falls}")
                    print("!"*50 + "\n")
            else:
                self.consecutive_fall_frames = max(0, self.consecutive_fall_frames - 2)
        
        elif self.state == "FALL_DETECTED":
            if stand_confidence > 0.7:
                self.consecutive_stand_frames += 1
                if self.consecutive_stand_frames >= self.required_stand_frames:
                    self.state = "MONITORING"
                    self.consecutive_fall_frames = 0
                    self.fall_confidence_history.clear()
                    print("✅ Person has stood up - returning to monitoring")
            elif current_time - self.fall_start_time > 30:
                self.state = "MONITORING"
                self.consecutive_fall_frames = 0
                self.fall_confidence_history.clear()

    def process_frame_fast(self, frame):
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
        return fall_confidence, stand_confidence, keypoints

    def draw_results(self, frame, fall_confidence, stand_confidence, keypoints):
        color = (0, 255, 0) if self.state == "MONITORING" else (0, 0, 255)
        cv2.putText(frame, f"State: {self.state}", (20, 40),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, color, 2)
        
        # Add Guardian Net info
        cv2.putText(frame, f"Patient ID: {self.patient_id}", (20, 70),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
        
        cv2.putText(frame, f"Alerts Sent: {self.alert_sender.alert_count}", (20, 100),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)

def main():
    # CONFIGURATION - Change this to match your patient in the database
    PATIENT_ID = 1
    
    print("\n" + "-"*50)
    print(f"Guardian Net Integration")
    print(f"Patient ID: {PATIENT_ID}")
    print(f"Make sure this matches the patient in your database")
    print("-"*50 + "\n")
    
    detector = GuardianFallDetector(patient_id=PATIENT_ID)
    
    cap = cv2.VideoCapture(0)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

    if not cap.isOpened():
        print("❌ Cannot open camera")
        return

    print("\n🎥 Camera opened. Press 'q' to quit.\n")

    while True:
        ret, frame = cap.read()
        if not ret:
            break
        
        fall_conf, stand_conf, keypoints = detector.process_frame_fast(frame)
        detector.draw_results(frame, fall_conf, stand_conf, keypoints)
        cv2.imshow("Guardian Net - Fall Detection", frame)
        
        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

    cap.release()
    cv2.destroyAllWindows()
    
    print(f"\n📊 Session Summary:")
    print(f"   Total falls detected: {detector.total_falls}")
    print(f"   Alerts sent: {detector.alert_sender.alert_count}")
    print("\n👋 Goodbye!")

if __name__ == "__main__":
    main()