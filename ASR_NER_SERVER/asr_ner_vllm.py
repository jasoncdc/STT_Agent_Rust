import torch
import os
# 強制使用離線模式，避免無法連上 HuggingFace 導致錯誤
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['HF_HOME'] = os.path.join(os.path.dirname(__file__), 'models')
os.environ['HANLP_HOME'] = os.path.join(os.path.dirname(__file__), 'models', '.hanlp')

import time
import opencc
import hanlp
from qwen_asr import Qwen3ASRModel

class ASR_NER_Engine:
    def __init__(self):
        print("正在初始化系統...")
        
        # 1. 初始化 Qwen3-ASR 模型 (0.6B)
        print("載入 ASR 模型 (Qwen3-ASR-0.6B)...")
        self.model = Qwen3ASRModel.LLM(
            model="Qwen/Qwen3-ASR-0.6B",
            gpu_memory_utilization=0.5,    # 0.3 仍不足以初始化 KV Cache，調高至 0.4 以確保穩定性
            max_model_len=4096,
            max_inference_batch_size=1,
            max_new_tokens=4096,
            forced_aligner="Qwen/Qwen3-ForcedAligner-0.6B",
            forced_aligner_kwargs=dict(
                dtype=torch.float32,
                device_map="cpu",
            ),
        )

        # 2. 初始化 HanLP 模型 (強制使用 CPU)
        print("載入 NER 模型 (HanLP)...")
        self.HanLP = hanlp.load(hanlp.pretrained.mtl.CLOSE_TOK_POS_NER_SRL_DEP_SDP_CON_ELECTRA_SMALL_ZH, devices=-1)

        # 3. 初始化繁簡轉換
        self.cc = opencc.OpenCC('s2t')

    def process_file(self, audio_file):
        print(f"Processing: {audio_file}")
        total_start_time = time.time()

        # --- ASR 轉錄 ---
        asr_start = time.time()
        print("步驟 1/3: 語音轉錄中 (含時間戳記)...")
        results = self.model.transcribe(
            audio=[audio_file],
            language=[None],
            return_time_stamps=True, # 開啟時間戳記
        )
        res = results[0]
        asr_end = time.time()
        asr_duration = asr_end - asr_start
        
        tc_text = res.text  # 直接使用原始轉錄文字 (簡體) 作為 HanLP 輸入

        # --- NER 人名識別 (全域掃描) ---
        hanlp_start = time.time()
        print(f"步驟 2/3: 人名識別中... (文字長度: {len(tc_text)} 字)")
        
        # 1. 先從全文找出所有可能是人名的詞 (建立白名單)
        potential_names = set()
        
        chunk_size = 500
        import math
        total_chunks = math.ceil(len(tc_text) / chunk_size)
        
        for chunk_idx in range(total_chunks):
            start_pos = chunk_idx * chunk_size
            end_pos = min((chunk_idx + 1) * chunk_size, len(tc_text))
            chunk_text = tc_text[start_pos:end_pos]
            
            # print(f"  正在分析第 {chunk_idx + 1}/{total_chunks} 部分...")
            
            try:
                doc = self.HanLP(chunk_text)
                if 'ner/msra' in doc:
                    for entity in doc['ner/msra']:
                        name = entity[0]
                        label = entity[1]
                        if label == 'PERSON':
                            if len(name) > 1 and all('\u4e00' <= char <= '\u9fff' for char in name):
                                potential_names.add(name)
            except Exception as e:
                print(f"  [Error] 分析第 {chunk_idx + 1} 部分時發生錯誤: {e}")
        
        hanlp_end = time.time()
        hanlp_duration = hanlp_end - hanlp_start
        print(f"  人名識別完成，共找到 {len(potential_names)} 個潛在人名詞彙")

        # --- 整合時間戳記與過濾 ---
        print("步驟 2.5/3: 整合時間戳記...")
        final_results = [] # 格式: (timestamp_float, 時間字串, 人名)
        cc_text = self.cc.convert(tc_text)
        
        if res.time_stamps:
            # 建立字元對應表: mapping[full_text_index] = segment_object
            text_map = []
            full_reconstructed_text = ""
            
            for seg in res.time_stamps:
                for char in seg.text:
                    full_reconstructed_text += char
                    text_map.append(seg)
            
            # 針對每一個潛在人名，在全文中搜尋所有出現位置
            # 先按名字長度排序 (長的優先)，避免短名字匹配到長名字的子字串
            sorted_names = sorted(potential_names, key=len, reverse=True)
            
            # 追蹤已被佔用的字元位置，避免重複匹配
            claimed_positions = set()
            
            for name in sorted_names:
                search_start = 0
                while True:
                    # 搜尋下一個出現位置
                    idx = full_reconstructed_text.find(name, search_start)
                    if idx == -1:
                        break
                    
                    # 檢查這個位置是否已被其他（更長的）名字佔用
                    name_positions = set(range(idx, idx + len(name)))
                    if name_positions & claimed_positions:
                        # 有重疊，跳過這個匹配
                        search_start = idx + 1
                        continue
                    
                    # 標記這些位置為已佔用
                    claimed_positions.update(name_positions)
                    
                    # 找到名字，取出對應的時間
                    # 名字可能跨越 segment，所以:
                    # 開始時間 = 第一個字的 segment start
                    # 結束時間 = 最後一個字的 segment end
                    try:
                        start_seg = text_map[idx]
                        end_seg = text_map[idx + len(name) - 1]
                        
                        start_min = int(start_seg.start_time // 60)
                        start_sec = int(start_seg.start_time % 60)
                        start_mse = int((start_seg.start_time % 1) * 1000)
                        end_min = int(end_seg.end_time // 60)
                        end_sec = int(end_seg.end_time % 60)
                        end_mse = int((end_seg.end_time % 1) * 1000)
                        
                        time_str = f"[{start_min:02d}:{start_sec:02d}.{start_mse:03d} - {end_min:02d}:{end_sec:02d}.{end_mse:03d}]"
                        
                        final_results.append((start_seg.start_time, end_seg.end_time, time_str, self.cc.convert(name), idx, idx + len(name)))
                    except Exception as e:
                        print(f"  [Warning] Name '{name}' index error: {e}")

                    # 繼續往後搜尋
                    search_start = idx + 1
            
            # Create full text from map to ensure indices align
            tc_text = full_reconstructed_text
            cc_text = self.cc.convert(tc_text)
            
            # 依照時間順序排序
            final_results.sort(key=lambda x: x[0])
            
        else:
            print("  [Warning] 未偵測到時間戳記，將僅列出人名")
            for name in potential_names:
                final_results.append((0.0, 0.0, "", self.cc.convert(name)))
        
        total_end_time = time.time()
        total_duration = total_end_time - total_start_time
        
        output_info = {
            'asr_duration': asr_duration,
            'hanlp_duration': hanlp_duration,
            'total_duration': total_duration
        }
        
        return final_results, cc_text, output_info

if __name__ == '__main__':

    print("初始化 ASR 與 NER 系統中...")
    engine = ASR_NER_Engine()
    
    # 設定音檔與輸出
    my_audio_files = [
        "split_audio/202512/個案4.mp3"
    ]
    output_dir = "text/202512"
    os.makedirs(output_dir, exist_ok=True)

    print(f"準備處理 {len(my_audio_files)} 個音檔...")

    for i, audio_file in enumerate(my_audio_files):
        print(f"\n[{i+1}/{len(my_audio_files)}] 正在處理: {audio_file}")
        
        # 呼叫 Engine 處理
        try:
             # 注意：這裡示範如何呼叫，但因 Qwen3ASRModel 設計特性，我們可能需要調整 Engine 內部寫法
             # 為了不大幅改動既有邏輯，我們將 Engine.transcribe_and_ner 設計為接收檔案路徑
             final_results, tc_text, output_info = engine.process_file(audio_file)
             
             # Unpack debug info if needed
             asr_duration = output_info.get('asr_duration', 0)
             hanlp_duration = output_info.get('hanlp_duration', 0)
             total_duration = output_info.get('total_duration', 0)
             
             # --- 輸出結果 ---
             print("步驟 3/3: 儲存結果...")
             basename = os.path.splitext(os.path.basename(audio_file))[0]
             output_path = os.path.join(output_dir, f"{basename}_ner.txt")
             
             with open(output_path, "w", encoding="utf-8") as f:
                 f.write(f"檔案: {audio_file}\n")
                 f.write(f"總執行時間: {total_duration:.2f} 秒\n")
                 f.write("=" * 30 + "\n")
                 f.write("發現的人名列表 (含時間戳記):\n")
                 
                 if final_results:
                     for _, time_str, name_tc in final_results:
                         f.write(f"{time_str} {name_tc}\n")
                 else:
                     f.write("(未偵測到人名)\n")
                 
                 f.write("=" * 30 + "\n")
                 f.write("完整轉錄內容 (參考):\n")
                 import textwrap
                 f.write(textwrap.fill(tc_text, width=50))
                 f.write("\n")

             print("-" * 30)
             print(f"處理完成！總耗時: {total_duration:.2f} 秒")
             print(f"結果已儲存至: {output_path}")
             print("-" * 30)

        except Exception as e:
            print(f"處理失敗: {e}")
            import traceback
            traceback.print_exc()

