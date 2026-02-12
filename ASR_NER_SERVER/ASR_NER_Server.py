import os
import shutil
import time
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
import uvicorn

# Import the refactored engine from asr_ner.py
# Make sure asr_ner.py is in the same directory or PYTHONPATH
try:
    from asr_ner import ASR_NER_Engine
except ImportError:
    print("Error: Could not import ASR_NER_Engine from asr_ner.py")
    print("Please make sure asr_ner.py is in the same directory.")
    exit(1)

app = FastAPI(title="ASR NER Server", description="API for ASR and NER processing using Qwen-ASR and HanLP")

# --- CONFIGURATION ---
# Set to True to test connection & upload without loading AI models
MOCK_MODE = False 
# ---------------------

# Enable CORS for frontend access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins
    allow_credentials=True,
    allow_methods=["*"],  # Allows all methods
    allow_headers=["*"],  # Allows all headers
)

# Global engine instance
engine = None

class Segment(BaseModel):
    start: float
    end: float
    text: str
    name: str
    start_idx: int
    end_idx: int

class TranscribeResponse(BaseModel):
    filename: str
    duration: float
    segments: List[Segment]
    full_text: str

@app.on_event("startup")
async def startup_event():
    global engine
    if MOCK_MODE:
        print("!!! RUNNING IN MOCK MODE !!!")
        print("AI Models will NOT be loaded. Returns dummy data for testing.")
        return

    print("Initializing ASR_NER_Engine...")
    engine = ASR_NER_Engine()
    print("ASR_NER_Engine initialized successfully.")

@app.get("/health")
async def health_check():
    if MOCK_MODE:
        return {"status": "ok", "model": "mocked"}
    
    if engine:
        return {"status": "ok", "model": "loaded"}
    else:
        return {"status": "error", "model": "not_loaded"}

@app.post("/transcribe", response_model=TranscribeResponse)
async def transcribe_audio(file: UploadFile = File(...)):
    if not MOCK_MODE and not engine:
        raise HTTPException(status_code=503, detail="Server is still initializing")

    # Save uploaded file temporarily
    temp_dir = "temp_uploads"
    os.makedirs(temp_dir, exist_ok=True)
    temp_path = os.path.join(temp_dir, file.filename)
    
    try:
        with open(temp_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        print(f"Received file: {file.filename}, saved to {temp_path}")
        
        if MOCK_MODE:
            # Simulate processing delay
            time.sleep(1)
            return TranscribeResponse(
                filename=file.filename,
                duration=12.5,
                segments=[
                    Segment(start=1.0, end=2.5, text="[00:01.000 - 00:02.500]", name="測試人員"),
                    Segment(start=5.0, end=6.2, text="[00:05.000 - 00:06.200]", name="王小明")
                ],
                full_text="這是一個測試回傳的逐字稿內容，因為目前處於 Mock 模式，所以沒有真正執行辨識。"
            )

        # Run processing
        # Note: process_file returns (final_results, cc_text, output_info)
        # final_results is list of (start, end, time_str, name, start_idx, end_idx)
        final_results, cc_text, output_info = engine.process_file(temp_path)
        
        # Format response
        segments = []
        for start_time, end_time, time_str, name, start_idx, end_idx in final_results:
            segments.append(Segment(
                start=start_time,
                end=end_time,
                text=time_str,
                name=name,
                start_idx=start_idx,
                end_idx=end_idx
            ))
            
        return TranscribeResponse(
            filename=file.filename,
            duration=output_info.get('total_duration', 0.0),
            segments=segments,
            full_text=cc_text
        )

    except Exception as e:
        print(f"Error processing file: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
        
    finally:
        # Cleanup temp file
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except:
                pass

if __name__ == "__main__":
    # Host needs to be 0.0.0.0 to allow external access if needed, but 127.0.0.1 is safer for local
    # Port 8000
    uvicorn.run(app, host="0.0.0.0", port=8000)
