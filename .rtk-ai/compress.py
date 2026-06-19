import os
import sys
from llmlingua import PromptCompressor

# Pastikan model di-load dengan nama repo HuggingFace yang BENAR
try:
    compressor = PromptCompressor(
        model_name="microsoft/llmlingua-2-bert-base-multilingual-cased-meetingbank", 
        use_llmlingua2=True,
        device_map="cpu"
    )
except Exception as e:
    print(f"Gagal memuat model AI: {e}")
    sys.exit(1)

# Membaca prompt dari file teks
input_file = "raw-prompt.txt"

if not os.path.exists(input_file):
    print(f"❌ Gagal: File '{input_file}' tidak ditemukan!")
    print("Silakan buat file 'raw-prompt.txt' di root proyek dan isi dengan prompt Anda.")
    sys.exit(1)

with open(input_file, "r", encoding="utf-8") as f:
    raw_prompt = f.read().strip()

if not raw_prompt:
    print("❌ Gagal: File 'raw-prompt.txt' masih kosong!")
    sys.exit(1)

print("⚡ Sedang mengompres prompt Anda... Mohon tunggu...")

try:
    results = compressor.compress_prompt([raw_prompt], rate=0.4)
    compressed_text = results['compressed_prompt']

    with open("prompt-diet.txt", "w", encoding="utf-8") as f:
        f.write(compressed_text)

    print("🔥 SUKSES! Prompt hemat token disimpan di 'prompt-diet.txt'")
except Exception as e:
    print(f"❌ Terjadi kesalahan saat kompresi: {e}")