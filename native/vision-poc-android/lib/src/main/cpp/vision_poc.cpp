#include <jni.h>
#include <android/log.h>

#include "llama.h"
#include "mtmd.h"
#include "mtmd-helper.h"
#include "ggml-backend.h"
#include "ggml-cpu.h"

#include <algorithm>
#include <cstring>
#include <fstream>
#include <memory>
#include <sstream>
#include <string>
#include <sys/stat.h>
#include <vector>

namespace {
constexpr const char * TAG = "PumpRcaVisionPoc";
constexpr int32_t N_CTX = 4096;
constexpr int32_t N_BATCH = 512;
constexpr int32_t N_PREDICT = 160;

struct NativeLog {
    std::string text;
};

void native_log(enum ggml_log_level level, const char * text, void * user_data) {
    auto * log = static_cast<NativeLog *>(user_data);
    if (log && text) {
        log->text += text;
        if (log->text.size() > 24000) log->text.erase(0, log->text.size() - 24000);
    }
    __android_log_print(level >= GGML_LOG_LEVEL_ERROR ? ANDROID_LOG_ERROR : ANDROID_LOG_INFO, TAG, "%s", text ? text : "");
}

std::string file_report(const std::string & path) {
    struct stat st{};
    std::ostringstream out;
    out << "path=" << path;
    if (stat(path.c_str(), &st) != 0) return out.str() + " exists=false";
    out << " exists=true size_bytes=" << static_cast<long long>(st.st_size) << " readable=";
    std::ifstream file(path, std::ios::binary);
    char magic[4]{};
    const bool readable = file.good() && static_cast<bool>(file.read(magic, sizeof(magic)));
    out << (readable ? "true" : "false") << " magic=";
    out.write(magic, sizeof(magic));
    return out.str();
}

std::string fail_report(const char * stage, const std::string & path, const NativeLog & log, const std::string & detail) {
    return std::string("POC_ERROR stage=") + stage + " " + file_report(path) + " detail=" + detail + "\nNATIVE_LOG_BEGIN\n" + log.text + "\nNATIVE_LOG_END";
}

struct BackendStatus {
    bool ok = false;
    bool cpu = false;
    std::string names;
};

BackendStatus init_backends() {
    llama_backend_init();
    // The PoC builds GGML_BACKEND_DL=OFF. Register the linked CPU backend
    // explicitly as a hard guarantee, then also run the standard loader.
    if (ggml_backend_reg_by_name("CPU") == nullptr) {
        ggml_backend_register(ggml_backend_cpu_reg());
    }
    ggml_backend_load_all();
    BackendStatus status;
    for (size_t i = 0; i < ggml_backend_reg_count(); ++i) {
        const auto reg = ggml_backend_reg_get(i);
        const char * name = ggml_backend_reg_name(reg);
        if (!name) continue;
        if (!status.names.empty()) status.names += ",";
        status.names += name;
        if (std::strcmp(name, "CPU") == 0) status.cpu = true;
    }
    status.ok = status.cpu && ggml_backend_reg_count() > 0;
    return status;
}

std::string backend_report(const BackendStatus & status) {
    std::ostringstream out;
    out << "BACKEND_INIT_OK=" << (status.ok ? "true" : "false")
        << " CPU_BACKEND_LOADED=" << (status.cpu ? "true" : "false")
        << " BACKEND_REG_COUNT=" << ggml_backend_reg_count()
        << " BACKENDS=" << (status.names.empty() ? "<none>" : status.names);
    return out.str();
}

std::string jstring_to_utf8(JNIEnv * env, jstring value) {
    if (!value) return {};
    const char * raw = env->GetStringUTFChars(value, nullptr);
    std::string result = raw ? raw : "";
    env->ReleaseStringUTFChars(value, raw);
    return result;
}

std::string token_piece(const llama_vocab * vocab, llama_token token) {
    char buffer[512];
    const int32_t n = llama_token_to_piece(vocab, token, buffer, sizeof(buffer), 0, true);
    return n > 0 ? std::string(buffer, static_cast<size_t>(n)) : std::string{};
}

bool decode_text(llama_context * ctx, const std::vector<llama_token> & tokens, llama_pos & position) {
    for (size_t offset = 0; offset < tokens.size(); offset += N_BATCH) {
        const size_t count = std::min<size_t>(N_BATCH, tokens.size() - offset);
        llama_batch batch = llama_batch_init(static_cast<int32_t>(count), 0, 1);
        for (size_t i = 0; i < count; ++i) {
            batch.token[i] = tokens[offset + i];
            batch.pos[i] = position + static_cast<llama_pos>(i);
            batch.n_seq_id[i] = 1;
            batch.seq_id[i][0] = 0;
            batch.logits[i] = (offset + i + 1 == tokens.size()) ? 1 : 0;
        }
        const int result = llama_decode(ctx, batch);
        llama_batch_free(batch);
        if (result != 0) return false;
        position += static_cast<llama_pos>(count);
    }
    return true;
}

std::vector<llama_token> tokenize(const llama_vocab * vocab, const std::string & text) {
    std::vector<llama_token> tokens(2048);
    int32_t n = llama_tokenize(vocab, text.data(), static_cast<int32_t>(text.size()), tokens.data(), static_cast<int32_t>(tokens.size()), true, true);
    if (n < 0) {
        tokens.resize(static_cast<size_t>(-n));
        n = llama_tokenize(vocab, text.data(), static_cast<int32_t>(text.size()), tokens.data(), static_cast<int32_t>(tokens.size()), true, true);
    }
    if (n < 0) return {};
    tokens.resize(static_cast<size_t>(n));
    return tokens;
}
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_example_llama_VisionPocBridge_runVisionPoc(
        JNIEnv * env, jclass,
        jstring jModelPath,
        jstring jMmprojPath,
        jstring jQwen3Path,
        jbyteArray jImageBytes) {
    const std::string model_path = jstring_to_utf8(env, jModelPath);
    const std::string mmproj_path = jstring_to_utf8(env, jMmprojPath);
    const std::string qwen3_path = jstring_to_utf8(env, jQwen3Path);
    if (model_path.empty() || mmproj_path.empty() || qwen3_path.empty() || !jImageBytes) {
        return env->NewStringUTF("POC_ERROR: vision model, mmproj, Qwen3 model and image are required");
    }

    const jsize image_size = env->GetArrayLength(jImageBytes);
    std::vector<unsigned char> image(static_cast<size_t>(image_size));
    env->GetByteArrayRegion(jImageBytes, 0, image_size, reinterpret_cast<jbyte *>(image.data()));
    if (image.empty()) return env->NewStringUTF("POC_ERROR: empty image bytes");

    NativeLog native_log_state;
    llama_log_set(native_log, &native_log_state);
    const BackendStatus backend_status = init_backends();
    const std::string backend_info = backend_report(backend_status);
    native_log_state.text += backend_info + "\n";
    if (!backend_status.ok) {
        const auto result = fail_report("BACKEND_INIT", model_path, native_log_state, backend_info);
        llama_backend_free();
        return env->NewStringUTF(result.c_str());
    }
    llama_model_params model_params = llama_model_default_params();
    model_params.n_gpu_layers = 0;
    llama_model * model = llama_model_load_from_file(model_path.c_str(), model_params);
    if (!model) {
        const auto result = fail_report("VISION_MODEL_LOAD", model_path, native_log_state, backend_info + " llama_model_load_from_file returned null");
        llama_backend_free();
        return env->NewStringUTF(result.c_str());
    }

    native_log_state.text.clear();

    llama_context_params context_params = llama_context_default_params();
    context_params.n_ctx = N_CTX;
    context_params.n_batch = N_BATCH;
    context_params.n_threads = 4;
    context_params.n_threads_batch = 4;
    llama_context * lctx = llama_init_from_model(model, context_params);
    if (!lctx) {
        llama_model_free(model);
        const auto result = fail_report("VISION_CONTEXT_LOAD", model_path, native_log_state, backend_info + " llama_init_from_model returned null");
        llama_backend_free();
        return env->NewStringUTF(result.c_str());
    }

    mtmd_context_params vision_params = mtmd_context_params_default();
    vision_params.use_gpu = false;
    vision_params.n_threads = 4;
    vision_params.print_timings = true;
    mtmd_context * vision = mtmd_init_from_file(mmproj_path.c_str(), model, vision_params);
    if (!vision) {
        llama_free(lctx);
        llama_model_free(model);
        const auto result = fail_report("MMPROJ_LOAD", mmproj_path, native_log_state, backend_info + " mtmd_init_from_file returned null");
        llama_backend_free();
        return env->NewStringUTF(result.c_str());
    }
    if (!mtmd_support_vision(vision)) {
        mtmd_free(vision);
        llama_free(lctx);
        llama_model_free(model);
        const auto result = fail_report("MMPROJ_VISION_CAPABILITY", mmproj_path, native_log_state, backend_info + " mtmd_support_vision returned false");
        llama_backend_free();
        return env->NewStringUTF(result.c_str());
    }

    mtmd_helper_init_opt init_opt = mtmd_helper_init_opt_default();
    mtmd_helper_bitmap_wrapper bitmap_wrapper = mtmd_helper_bitmap_init_from_buf(
        vision, image.data(), image.size(), false, init_opt);
    if (!bitmap_wrapper.bitmap) {
        mtmd_free(vision);
        llama_free(lctx);
        llama_model_free(model);
        return env->NewStringUTF("POC_ERROR: image bytes were not decoded into a bitmap");
    }

    // The image is inserted as an actual media chunk. The returned answer is not derived from the filename or OCR.
    const std::string prompt =
        "<|im_start|>user\n<__media__>\n"
        "Describe only what is visibly present in this image in one or two sentences. "
        "Mention the main objects, scene and any visible damage. Do not infer hidden facts."
        "<|im_end|>\n<|im_start|>assistant\n";
    mtmd_input_text input_text{prompt.data(), prompt.size(), true, true};
    const mtmd_bitmap * bitmaps[] = {bitmap_wrapper.bitmap};
    mtmd_input_chunks * chunks = mtmd_input_chunks_init();
    const int32_t tokenize_result = mtmd_tokenize(vision, chunks, &input_text, bitmaps, 1);
    if (tokenize_result != 0) {
        mtmd_input_chunks_free(chunks);
        mtmd_bitmap_free(bitmap_wrapper.bitmap);
        mtmd_free(vision);
        llama_free(lctx);
        llama_model_free(model);
        return env->NewStringUTF("POC_ERROR: libmtmd could not tokenize the real bitmap");
    }

    llama_pos position = 0;
    const int32_t eval_result = mtmd_helper_eval_chunks(vision, lctx, chunks, 0, 0, N_BATCH, true, &position);
    mtmd_input_chunks_free(chunks);
    mtmd_bitmap_free(bitmap_wrapper.bitmap);
    if (eval_result != 0) {
        mtmd_free(vision);
        llama_free(lctx);
        llama_model_free(model);
        return env->NewStringUTF("POC_ERROR: libmtmd image encode/decode failed");
    }

    const llama_vocab * vocab = llama_model_get_vocab(model);
    llama_sampler * sampler = llama_sampler_init_greedy();
    std::string answer;
    for (int i = 0; i < N_PREDICT; ++i) {
        const llama_token token = llama_sampler_sample(sampler, lctx, -1);
        llama_sampler_accept(sampler, token);
        if (llama_vocab_is_eog(vocab, token)) break;
        answer += token_piece(vocab, token);
        llama_batch next = llama_batch_get_one(const_cast<llama_token *>(&token), 1);
        if (llama_decode(lctx, next) != 0) {
            answer += "\n[POC_ERROR: generation decode failed]";
            break;
        }
        position++;
    }
    llama_sampler_free(sampler);

    // Explicit unload boundary required by the PoC before the later Qwen3 handoff.
    mtmd_free(vision);
    llama_free(lctx);
    llama_model_free(model);
    // Explicit handoff: vision resources are gone before Qwen3 is loaded.
    llama_model_params text_model_params = llama_model_default_params();
    text_model_params.n_gpu_layers = 0;
    llama_model * qwen3 = llama_model_load_from_file(qwen3_path.c_str(), text_model_params);
    if (!qwen3) {
        llama_backend_free();
        return env->NewStringUTF(("VISION_POC_OK\n" + backend_info + "\nVISION_ANSWER=" + answer + "\nHANDOFF_ERROR: Qwen3 GGUF failed to load").c_str());
    }
    llama_context_params text_context_params = llama_context_default_params();
    text_context_params.n_ctx = N_CTX;
    text_context_params.n_batch = N_BATCH;
    text_context_params.n_threads = 4;
    text_context_params.n_threads_batch = 4;
    llama_context * text_ctx = llama_init_from_model(qwen3, text_context_params);
    if (!text_ctx) {
        llama_model_free(qwen3);
        llama_backend_free();
        return env->NewStringUTF(("VISION_POC_OK\n" + backend_info + "\nVISION_ANSWER=" + answer + "\nHANDOFF_ERROR: Qwen3 context failed").c_str());
    }
    const std::string handoff_prompt =
        "<|im_start|>system\nТы выполняешь RCA по насосному оборудованию. Используй visual evidence только как наблюдение, не как доказанную первопричину.<|im_end|>\n"
        "<|im_start|>user\nVISUAL_EVIDENCE_FROM_REAL_IMAGE:\n" + answer +
        "\nСформулируй один короткий следующий шаг проверки для RCA.<|im_end|>\n<|im_start|>assistant\n";
    auto handoff_tokens = tokenize(llama_model_get_vocab(qwen3), handoff_prompt);
    llama_pos handoff_position = 0;
    std::string rca_answer;
    if (!handoff_tokens.empty() && decode_text(text_ctx, handoff_tokens, handoff_position)) {
        llama_sampler * text_sampler = llama_sampler_init_greedy();
        const llama_vocab * text_vocab = llama_model_get_vocab(qwen3);
        for (int i = 0; i < 96; ++i) {
            const llama_token token = llama_sampler_sample(text_sampler, text_ctx, -1);
            llama_sampler_accept(text_sampler, token);
            if (llama_vocab_is_eog(text_vocab, token)) break;
            rca_answer += token_piece(text_vocab, token);
            llama_batch next = llama_batch_get_one(const_cast<llama_token *>(&token), 1);
            if (llama_decode(text_ctx, next) != 0) break;
            handoff_position++;
        }
        llama_sampler_free(text_sampler);
    }
    llama_free(text_ctx);
    llama_model_free(qwen3);
    llama_backend_free();

    const std::string result = "VISION_POC_OK\n" + backend_info + "\nVISION_MODEL_LOADED=true\nMMPROJ_LOADED=true\nMODEL=Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf\nBITMAP=decoded_and_encoded\nVISION_ANSWER=" + answer + "\nVISION_UNLOADED=true\nQWEN3_LOADED=true\nQWEN3_EVIDENCE_HANDOFF=" + rca_answer;
    return env->NewStringUTF(result.c_str());
}
