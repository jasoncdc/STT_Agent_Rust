import os
import shutil
import time
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
import uvicorn

# --- BACKEND CONFIGURATION ---
#Select the backend to use:
# "transformers": Optimized for low idle VRAM usage (recommended for desktop/workstation)
# "vllm": Optimized for high throughput server usage (pre-allocates VRAM)
BACKEND_TYPE = "vllm" 
# -----------------------------

# --- MEMORY STRATEGY ---
# If True, model is loaded only when request comes, and released immediately after.
# Best for shared GPU servers (e.g., OCR usage).
# Trade-off: High latency per request (loading time).
LAZY_LOAD_MODEL = True
# -----------------------

try:
    if BACKEND_TYPE == "transformers":
        from asr_ner_transformers import ASR_NER_Engine
        print(f"Using Backend: TRANSFORMERS (asr_ner_transformers.py)")
    elif BACKEND_TYPE == "vllm":
        from asr_ner_vllm import ASR_NER_Engine
        print(f"Using Backend: vLLM (asr_ner_vllm.py)")
    else:
        raise ValueError(f"Unknown BACKEND_TYPE: {BACKEND_TYPE}")
except ImportError as e:
    print(f"Error importing backend '{BACKEND_TYPE}': {e}")
    print("Falling back to auto-detection...")
    try:
        from asr_ner_transformers import ASR_NER_Engine
        print("Fallback: Using Transformers Backend")
    except ImportError:
        try:
            from asr_ner_vllm import ASR_NER_Engine
            print("Fallback: Using vLLM Backend")
        except ImportError:
            print("CRITICAL ERROR: No ASR backend found!")
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

def release_engine():
    """Helper to release memory"""
    global engine
    if engine is not None:
        print("Releasing Engine and freeing VRAM...")
        try:
            # Try to call cleanup if available
            if hasattr(engine, 'cleanup'):
                engine.cleanup()
            elif hasattr(engine, 'model') and hasattr(engine.model, 'model') and hasattr(engine.model.model, 'get_model_executor'):
                 # Attempt vLLM cleanup if possible
                 try:
                     import gc
                     import torch
                     del engine.model
                     del engine
                     gc.collect()
                     torch.cuda.empty_cache()
                 except:
                     pass
        except Exception as e:
            print(f"Cleanup error: {e}")
            
        engine = None
        
        # Force GC and CUDA cache clear
        import gc
        import torch
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        print("Engine released.")

@app.on_event("startup")
async def startup_event():
    global engine
    if MOCK_MODE:
        print("!!! RUNNING IN MOCK MODE !!!")
        print("AI Models will NOT be loaded. Returns dummy data for testing.")
        return

    if LAZY_LOAD_MODEL:
        print("Lazy Loading Enabled: Model will NOT be loaded at startup.")
        print("Model will be loaded on-demand for each request.")
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
        status = "lazy_loaded" if LAZY_LOAD_MODEL else "not_loaded"
        return {"status": "ok", "model": status}

@app.post("/transcribe", response_model=TranscribeResponse)
async def transcribe_audio(file: UploadFile = File(...)):
    global engine
    
    # On-demand loading
    if not MOCK_MODE and not engine:
        print("Lazy Load: Initializing Engine for request...")
        try:
            engine = ASR_NER_Engine()
        except Exception as e:
            print(f"Failed to load engine: {e}")
            raise HTTPException(status_code=500, detail="Failed to load AI Model")

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
        
        # Lazy Load Cleanup: Release model immediately
        if LAZY_LOAD_MODEL and not MOCK_MODE:
            release_engine()

if __name__ == "__main__":
    # Host needs to be 0.0.0.0 to allow external access if needed, but 127.0.0.1 is safer for local
    # Port 8000
    uvicorn.run(app, host="0.0.0.0", port=8000)
